"""Extract processor — pull a typed schema out of a document, field by field.

The pipeline is the parse pipeline truncated: there is no layout, table or image
work, because extraction consumes an already-understood document. In this
milestone that document is the shared fixture; with a real engine the same code
path would consume a stored ``ParseResult`` instead, which is why the stage
sequence here is ``FETCHING → PARSING → STRUCTURE → JSON → PERSISTING`` and not a
full parse.

The canned values mirror ``KNOWN_FIELD_VALUES`` in the shared
``mock/engine.ts`` exactly, including the deliberately low-confidence entries.
That is what makes the empty state honest: a field the caller invented comes back
with ``value: null``, ``confidence: 0`` and no source chunks, rather than a
plausible-looking guess. A real extractor's LLM would do the same when the
document does not support the schema — reporting not-found is the correct
behaviour, not a failure.
"""

from __future__ import annotations

from typing import Any

from ..fixtures import DOCUMENT_AUTHOR, DOCUMENT_TITLE, PAGE_GEOMETRY, to_fixed
from ..models import (
    MIME_JSON,
    ArtifactReport,
    ExtractJobInput,
    ExtractResult,
    ExtractedValue,
    JobDocumentSummary,
    JobMetrics,
    Operation,
    ProcessingOutput,
    ResolvedExtractionSchema,
    SchemaField,
    to_wire_json,
)
from ..storage import WrittenObject
from .base import (
    DocumentProcessor,
    ProcessingContext,
    ProcessorFailure,
    build_document_descriptor,
)

__all__ = ["KNOWN_FIELD_VALUES", "ExtractProcessor"]


#: Canned values keyed by field name, drawn from the fixture document.
#:
#: ``page`` is the page the value was found on and ``chunks`` the regions that
#: support it — both are traceability metadata the UI turns into "show me where
#: this came from" links. Entries with ``value: null`` are schema fields the
#: document genuinely does not answer.
#:
#: Keys are ordered as in the TS source so that a diff between the two files
#: stays readable.
KNOWN_FIELD_VALUES: dict[str, dict[str, Any]] = {
    "company_name": {
        "value": "Northwind Analytics",
        "page": 1,
        "chunks": ["chunk_001"],
        "confidence": 0.97,
    },
    "reporting_period": {
        "value": "FY2025 (year ended 31 December 2025)",
        "page": 1,
        "chunks": ["chunk_002"],
        "confidence": 0.94,
    },
    "total_revenue": {
        "value": 482.6,
        "page": 2,
        "chunks": ["chunk_011", "chunk_012"],
        "confidence": 0.96,
    },
    "revenue_growth_pct": {
        "value": 18.4,
        "page": 2,
        "chunks": ["chunk_011"],
        "confidence": 0.93,
    },
    "operating_margin_pct": {
        "value": 22.1,
        "page": 1,
        "chunks": ["chunk_006"],
        "confidence": 0.91,
    },
    "regions": {
        "value": [
            {"region": "India", "revenue": 148.2, "yoy_change": "+31.9%"},
            {"region": "United States", "revenue": 176.9, "yoy_change": "+14.8%"},
            {"region": "Europe", "revenue": 94.3, "yoy_change": "+14.0%"},
            {"region": "Asia-Pacific", "revenue": 63.2, "yoy_change": "+8.4%"},
        ],
        "page": 2,
        "chunks": ["chunk_012"],
        "confidence": 0.92,
    },
    "institution_name": {"value": None, "page": None, "chunks": [], "confidence": 0},
    "degree_program": {"value": None, "page": None, "chunks": [], "confidence": 0},
    "location": {"value": None, "page": None, "chunks": [], "confidence": 0},
    "start_date": {"value": None, "page": None, "chunks": [], "confidence": 0},
    "end_date": {"value": None, "page": None, "chunks": [], "confidence": 0},
    "party_a": {
        "value": "Northwind Analytics Ltd",
        "page": 1,
        "chunks": ["chunk_001"],
        "confidence": 0.88,
    },
    "party_b": {"value": None, "page": None, "chunks": [], "confidence": 0},
    "effective_date": {
        "value": "2025-01-01",
        "page": 1,
        "chunks": ["chunk_002"],
        "confidence": 0.79,
    },
    "notice_period_days": {
        "value": 90,
        "page": 3,
        "chunks": ["chunk_020"],
        "confidence": 0.81,
    },
    "termination_clauses": {
        "value": [
            "Notice periods and termination provisions for senior staff are "
            "reviewed annually by the remuneration committee."
        ],
        "page": 3,
        "chunks": ["chunk_020"],
        "confidence": 0.84,
    },
    "governing_law": {"value": None, "page": None, "chunks": [], "confidence": 0},
    "headcount": {
        "value": 2480,
        "page": 3,
        "chunks": ["chunk_020"],
        "confidence": 0.95,
    },
    "benefits": {
        "value": [
            "Comprehensive health and dental coverage for employees and dependants",
            "Employer pension contribution of up to 9 percent of base salary",
            "Annual leave entitlement of 25 days plus public holidays",
            "Hybrid working allowance and home office equipment budget",
        ],
        "page": 3,
        "chunks": ["chunk_021"],
        "confidence": 0.9,
    },
}


class ExtractProcessor(DocumentProcessor):
    """Pull a typed schema out of a document, field by field."""

    @property
    def operation(self) -> Operation:
        return "EXTRACT"

    def process(self, ctx: ProcessingContext) -> ProcessingOutput:
        options = ctx.envelope.input
        if not isinstance(options, ExtractJobInput):
            raise ProcessorFailure.of(
                "INTERNAL_ERROR",
                "This job is missing the extraction schema the processor requires.",
                retryable=False,
                detail=f"expected ExtractJobInput, received {type(options).__name__}",
            )

        prefix = ctx.artifact_prefix

        # ── FETCHING / PARSING: the same understanding stages a parse walks,
        # compressed — extraction needs the document read, not reconstructed.
        ctx.stage("ACCEPTED", f"Accepted extract job for {ctx.envelope.document.filename}.")
        ctx.read_raw()
        ctx.stage("FETCHING", f"Fetched {ctx.envelope.document.size_bytes:,} bytes.")
        ctx.assert_not_marked_corrupt("PARSING")
        ctx.stage("PARSING", "Decoded the document and located candidate regions.")
        ctx.stage("LAYOUT", f"Segmented {len(PAGE_GEOMETRY)} pages into regions.")
        ctx.stage("TEXT", "Recovered text for the extraction pass.")

        # ── STRUCTURE: resolve each schema field against the document.
        fields: list[SchemaField] = options.fields
        extraction: dict[str, ExtractedValue] = {}
        found = 0
        for field in fields:
            entry = self._extract_field(field)
            extraction[field.name] = entry
            if entry.value is not None:
                found += 1
        ctx.stage(
            "STRUCTURE",
            f"Resolved {found} of {len(fields)} fields in schema "
            f"{options.schema_name!r}.",
        )

        result = ExtractResult(
            document=build_document_descriptor(
                ctx,
                page_count=len(PAGE_GEOMETRY),
                # The discovered document identity, exactly as the shared engine
                # stamps it — extraction does not reinterpret the document's own
                # title just because it asked a different question of it.
                title=DOCUMENT_TITLE,
                author=DOCUMENT_AUTHOR,
            ),
            schema_=ResolvedExtractionSchema(name=options.schema_name, fields=fields),
            extraction=extraction,
            overall_confidence=self._overall_confidence(fields, extraction),
            metadata=self.metadata(ctx),
        )

        # ── JSON / PERSISTING.
        ctx.stage("JSON", "Serialised the extraction record.")
        written = ctx.writer.write_text(
            f"{prefix}/extract.json", to_wire_json(result), MIME_JSON
        )
        ctx.stage("PERSISTING", f"Wrote {written.storage_key}.")
        ctx.stage("DONE", "Extract complete.")

        return ProcessingOutput(
            artifacts=[_artifact("JSON", written)],
            document=JobDocumentSummary(
                page_count=len(PAGE_GEOMETRY),
                title=DOCUMENT_TITLE,
                author=DOCUMENT_AUTHOR,
                summary=(
                    f"Extracted {found} of {len(fields)} fields from "
                    f"{ctx.envelope.document.filename}."
                ),
            ),
            metrics=JobMetrics(
                # Source regions the extraction actually drew on, deduplicated —
                # the meaningful "how much of the document did this read" figure.
                # Not the field count: a field count is not a chunk count, and the
                # UI labels this badge "chunks".
                chunk_count=len(self._source_chunks(extraction)),
                asset_count=0,
                table_count=0,
                # Extraction produces no Markdown. Reported as zero rather than
                # omitted so the API can read the metric unconditionally.
                markdown_bytes=0,
            ),
            metadata=result.metadata,
            result=result,
        )

    # ── Field resolution ────────────────────────────────────────────────────

    @staticmethod
    def _extract_field(field: SchemaField) -> ExtractedValue:
        """Resolve one schema field, always setting all four keys.

        Constructing with every keyword is deliberate: an unknown field must
        serialise as ``{"value": null, "confidence": 0, "pageNumber": null,
        "sourceChunkIds": []}``, not as an object missing its keys.
        """
        known = KNOWN_FIELD_VALUES.get(field.name)
        if known is None:
            return ExtractedValue(
                value=None, confidence=0, page_number=None, source_chunk_ids=[]
            )
        return ExtractedValue(
            value=known["value"],
            confidence=known["confidence"],
            page_number=known["page"],
            source_chunk_ids=list(known["chunks"]),
        )

    @staticmethod
    def _source_chunks(extraction: dict[str, ExtractedValue]) -> list[str]:
        """Distinct chunk ids the extraction cited, in first-seen order.

        Order is preserved rather than sorted so the list reads in schema order,
        which is the order the UI walks the fields.
        """
        seen: dict[str, None] = {}
        for entry in extraction.values():
            for chunk_id in entry.source_chunk_ids:
                seen[chunk_id] = None
        return list(seen)

    @staticmethod
    def _overall_confidence(
        fields: list[SchemaField], extraction: dict[str, ExtractedValue]
    ) -> float:
        """Mean confidence over the required fields, rounded as TS ``toFixed(4)``.

        A field counts as required unless it is explicitly ``required: false`` —
        matching the TS filter. If *every* field is optional the mean falls back
        to the full field set, so an all-optional schema still produces a
        meaningful number instead of 0. The result is rounded to four decimals
        using ECMAScript's rule, so the worker and the API's inline dispatcher
        report the same figure.
        """
        scored = [f for f in fields if f.required is not False] or list(fields)
        if not scored:
            return 0.0
        total = sum(extraction[field.name].confidence for field in scored)
        return to_fixed(total / len(scored), 4)


def _artifact(artifact_type: str, written: WrittenObject) -> ArtifactReport:
    """Report a written object. ``label`` is omitted — only assets carry one."""
    return ArtifactReport(
        type=artifact_type,
        storage_key=written.storage_key,
        mime_type=written.mime_type,
        size_bytes=written.size_bytes,
    )
