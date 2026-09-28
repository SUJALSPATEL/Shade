"""Split processor — retrieve the passages that answer a question.

A deliberately simple lexical retriever, ported line for line from ``retrieve()``
in the shared ``mock/engine.ts``.

It exists so the Split surface is genuinely driven by the query rather than
returning a fixed list, and so the ``Retriever`` seam is real. Replacing it with
embeddings + hybrid search + reranking is an implementation swap behind
:func:`retrieve`, not a UI change — which is the entire reason the split logic
lives in a processor rather than in the API.

Fidelity notes
--------------
Two details of the TypeScript are load-bearing and are reproduced rather than
"improved":

* **Iteration order.** ``expand`` returns a JS ``Set``, and the rationale string
  takes the first four shared terms *in query-token order*. Python's builtin
  ``set`` has no insertion-order guarantee, so :class:`OrderedSet` is used
  instead. Without it the rationale text would vary between runs.
* **Rounding.** Scores are rounded to four decimals *before* sorting, using
  ECMAScript's rounding rule (:func:`~shade_worker.fixtures.to_fixed`), so ties
  and ordering match the API's own dispatcher exactly.

Scoring is ``min(1, coverage * 1.6) * chunk.confidence`` where
``coverage = overlap / max(4, |query terms|)``. Normalising by the query length —
with a floor of 4 — stops a long query from out-ranking a short, precise one,
and the confidence multiplier lets the processor's own uncertainty propagate into
the ranking instead of being discarded at the last step.
"""

from __future__ import annotations

import re
from typing import Iterable, Iterator, Mapping, Sequence

from ..fixtures import (
    DOCUMENT_AUTHOR,
    DOCUMENT_TITLE,
    PAGE_GEOMETRY,
    build_chunks,
    to_fixed,
)
from ..models import (
    MIME_JSON,
    ArtifactReport,
    DocumentChunk,
    JobDocumentSummary,
    JobMetrics,
    Operation,
    ProcessingOutput,
    SplitJobInput,
    SplitMatch,
    SplitResult,
    to_wire_json,
)
from ..storage import WrittenObject
from .base import (
    DocumentProcessor,
    ProcessingContext,
    ProcessorFailure,
    build_document_descriptor,
)

__all__ = ["OrderedSet", "SplitProcessor", "expand", "retrieve", "tokenize"]

#: Maximum matches returned when the job does not say.
DEFAULT_LIMIT = 8

#: Minimum score below which a chunk is considered noise.
MIN_SCORE = 0.12

STOP_WORDS: frozenset[str] = frozenset(
    {
        "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are",
        "was", "were", "be", "with", "that", "this", "it", "as", "at", "by", "from",
        "find", "show", "me", "about", "related", "regarding", "what", "which", "how",
    }
)

#: Domain synonyms so a natural-language query hits the right passage.
#: Declaration order matters: it determines the order terms are added to the
#: expanded query set, and therefore the order they appear in a rationale.
SYNONYMS: dict[str, tuple[str, ...]] = {
    "benefits": ("benefits", "pension", "dental", "health", "leave", "allowance", "remuneration"),
    "employee": ("employee", "employees", "staff", "headcount", "personnel", "workforce"),
    "termination": ("termination", "notice", "provisions", "clauses"),
    "revenue": ("revenue", "income", "sales", "turnover"),
    "risk": ("risk", "uncertainty", "macroeconomic"),
    "growth": ("growth", "increase", "expansion", "grew"),
}

#: Chunk types that carry prose worth retrieving. Headers, page numbers and
#: figures are excluded: they match queries by accident and never answer one.
RETRIEVABLE_TYPES: frozenset[str] = frozenset(
    {"paragraph", "list", "table", "caption", "heading"}
)

#: Characters that survive tokenisation: alphanumerics, whitespace and the
#: punctuation that appears inside figures and percentages (``31.9%``, ``+8.4%``).
_TOKEN_KEEP = re.compile(r"[^a-z0-9\s%.-]")
_WHITESPACE = re.compile(r"\s+")


class OrderedSet:
    """A set that iterates in insertion order, mirroring the JS ``Set``.

    Needed because the rationale string is part of the product's visible output:
    ``build_rationale`` takes the first four shared terms in query-token order,
    so set iteration order is behaviour, not an implementation detail.
    """

    __slots__ = ("_items",)

    def __init__(self, items: Iterable[str] = ()) -> None:
        self._items: dict[str, None] = dict.fromkeys(items)

    def add(self, item: str) -> None:
        # Re-adding an existing key keeps its original position, as JS Set does.
        self._items[item] = None

    def __contains__(self, item: object) -> bool:
        return item in self._items

    def __iter__(self) -> Iterator[str]:
        return iter(self._items)

    def __len__(self) -> int:
        return len(self._items)

    def __repr__(self) -> str:
        return f"OrderedSet({list(self._items)!r})"


# ── Retrieval ───────────────────────────────────────────────────────────────


def tokenize(text: str) -> list[str]:
    """Lowercase, strip punctuation, drop stop words and one-character tokens."""
    normalised = _TOKEN_KEEP.sub(" ", text.lower())
    return [
        token
        for token in _WHITESPACE.split(normalised)
        if len(token) > 1 and token not in STOP_WORDS
    ]


def expand(tokens: Sequence[str]) -> OrderedSet:
    """Add every synonym family a token touches to the term set.

    A token matches a family if it *is* the canonical name or *is* one of its
    members; matching pulls in the whole family, so ``pension`` reaches
    ``benefits``, ``leave`` and the rest.
    """
    expanded = OrderedSet(tokens)
    for token in tokens:
        for canonical, family in SYNONYMS.items():
            if token == canonical or token in family:
                expanded.add(canonical)
                for member in family:
                    expanded.add(member)
    return expanded


def retrieve(
    query: str,
    *,
    limit: int = DEFAULT_LIMIT,
    min_score: float = MIN_SCORE,
) -> list[SplitMatch]:
    """Rank the fixture's retrievable chunks against ``query``.

    Returns matches sorted by score descending, then ``chunk_id`` ascending so
    the order is total and stable. The limit is applied *after* sorting.
    """
    query_tokens = expand(tokenize(query))
    matches: list[SplitMatch] = []

    for chunk in build_chunks():
        if chunk.type not in RETRIEVABLE_TYPES:
            continue

        chunk_tokens = tokenize(chunk.text)
        if not chunk_tokens:
            continue

        chunk_set = OrderedSet(chunk_tokens)
        overlap = sum(1 for token in query_tokens if token in chunk_set)
        if overlap == 0:
            continue

        # Normalise by the query length so long queries do not out-rank short,
        # precise ones, then weight by the processor's own confidence.
        coverage = overlap / max(4, len(query_tokens))
        score = min(1.0, coverage * 1.6) * chunk.confidence

        if score < min_score:
            continue

        matches.append(
            SplitMatch(
                chunk_id=chunk.chunk_id,
                page_number=chunk.page_number,
                text=chunk.text,
                # Rounded before sorting, as in the TS: the stored score is what
                # the sort sees, so ordering and the displayed number agree.
                score=to_fixed(score, 4),
                bounding_box=chunk.bounding_box,
                type=chunk.type,
                rationale=build_rationale(
                    chunk.type, overlap, query_tokens, chunk_set
                ),
            )
        )

    matches.sort(key=lambda match: (-match.score, match.chunk_id))
    return matches[:limit]


def build_rationale(
    chunk_type: str,
    overlap: int,
    query_tokens: OrderedSet,
    chunk_set: OrderedSet,
) -> str:
    """Explain, in one short sentence, why this chunk matched.

    Names up to four shared terms so the user can see the match is lexical and
    judge it themselves, rather than being asked to trust a bare number.
    """
    shared = [token for token in query_tokens if token in chunk_set][:4]
    terms = ", ".join(shared) if shared else "related terms"
    plural = "" if overlap == 1 else "s"
    return f"Matched {overlap} term{plural} ({terms}) in a {chunk_type} region."


# ── Processor ───────────────────────────────────────────────────────────────


class SplitProcessor(DocumentProcessor):
    """Retrieve the passages that answer a question."""

    @property
    def operation(self) -> Operation:
        return "SPLIT"

    def process(self, ctx: ProcessingContext) -> ProcessingOutput:
        options = ctx.envelope.input
        if not isinstance(options, SplitJobInput):
            raise ProcessorFailure.of(
                "INTERNAL_ERROR",
                "This job is missing the query the processor requires.",
                retryable=False,
                detail=f"expected SplitJobInput, received {type(options).__name__}",
            )

        prefix = ctx.artifact_prefix

        # Retrieval needs the chunk index, not a layout reconstruction, so the
        # stage sequence skips LAYOUT/TABLES/IMAGES entirely.
        ctx.stage("ACCEPTED", f"Accepted split job for {ctx.envelope.document.filename}.")
        ctx.read_raw()
        ctx.stage("FETCHING", f"Fetched {ctx.envelope.document.size_bytes:,} bytes.")
        ctx.assert_not_marked_corrupt("PARSING")
        ctx.stage("PARSING", "Decoded the document and located candidate regions.")
        ctx.stage("TEXT", "Recovered text for the retrieval index.")

        matches = retrieve(options.query, limit=options.limit)
        ctx.stage(
            "STRUCTURE",
            f"Ranked {len(matches)} passages for the query "
            f"{self._preview(options.query)}.",
        )

        result = SplitResult(
            document=build_document_descriptor(
                ctx,
                page_count=len(PAGE_GEOMETRY),
                title=DOCUMENT_TITLE,
                author=DOCUMENT_AUTHOR,
            ),
            query=options.query,
            matches=matches,
            metadata=self.metadata(ctx),
        )

        ctx.stage("JSON", "Serialised the ranked passages.")
        written = ctx.writer.write_text(
            f"{prefix}/split.json", to_wire_json(result), MIME_JSON
        )
        ctx.stage("PERSISTING", f"Wrote {written.storage_key}.")
        ctx.stage("DONE", "Split complete.")

        return ProcessingOutput(
            artifacts=[_artifact("JSON", written)],
            document=JobDocumentSummary(
                page_count=len(PAGE_GEOMETRY),
                title=DOCUMENT_TITLE,
                author=DOCUMENT_AUTHOR,
                summary=(
                    f"Retrieved {len(matches)} passages matching "
                    f"{self._preview(options.query)}."
                ),
            ),
            metrics=JobMetrics(
                # Passages above the score floor — the honest "how many places in
                # the document answer this" figure for the job badge.
                chunk_count=len(matches),
                asset_count=0,
                table_count=0,
                # Split produces no Markdown. Reported as zero rather than omitted
                # so the API can read the metric unconditionally.
                markdown_bytes=0,
            ),
            metadata=result.metadata,
            result=result,
        )

    @staticmethod
    def _preview(query: str, limit: int = 60) -> str:
        """A single-line, quoted, truncated form of the query for log/UI text."""
        collapsed = " ".join(query.split())
        if len(collapsed) <= limit:
            return repr(collapsed)
        return repr(collapsed[: limit - 1] + "…")


def _artifact(artifact_type: str, written: WrittenObject) -> ArtifactReport:
    """Report a written object. ``label`` is omitted — only assets carry one."""
    return ArtifactReport(
        type=artifact_type,
        storage_key=written.storage_key,
        mime_type=written.mime_type,
        size_bytes=written.size_bytes,
    )


def retrievable_chunks() -> Iterator[DocumentChunk]:
    """Chunks the retriever considers, in chunk_id order.

    Exposed for the architecture's future benefit: when the API needs to build a
    retrieval index from the stored ``metrics.chunks``, this is the filter it
    should apply, and keeping it here means the two planes cannot drift.
    """
    for chunk in build_chunks():
        if chunk.type in RETRIEVABLE_TYPES:
            yield chunk


def synonym_families() -> Mapping[str, tuple[str, ...]]:
    """Read-only view of the synonym map, for the web app's query hints."""
    return SYNONYMS
