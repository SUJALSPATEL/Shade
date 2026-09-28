"""Extract and Split — the two operations Parse's test file does not reach.

Parse carries its own module because it exercises the whole pipeline, the
storage guards and the runtime's failure matrix. These two are narrower: each is
a *shorter* pipeline over the same scaffolding, and what is worth pinning is the
part that differs — the stage sequence, the artifact each writes, and the
honesty of the empty state.

That last one is the real subject of this file. Extraction's most important
behaviour is not that it finds ``total_revenue``; it is that a field the document
does not answer comes back as ``value: null, confidence: 0`` with no source
chunks, rather than as a plausible-looking guess. Likewise Split's most important
behaviour is that an unrelated query returns *nothing* rather than the
least-bad passage. Both are the difference between a system that reports
not-found and one that fabricates, and both are easy to break by accident.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from shade_worker.fixtures import DOCUMENT_TITLE
from shade_worker.models import (
    JOB_STAGES,
    JobEnvelope,
    SchemaField,
    to_wire,
)
from shade_worker.processors import get_processor
from shade_worker.processors.base import ProcessingContext, ProcessorFailure
from shade_worker.processors.extract import KNOWN_FIELD_VALUES, ExtractProcessor
from shade_worker.processors.split import SplitProcessor, retrieve
from shade_worker.storage import LocalStorageReader, LocalStorageWriter

from conftest import RecordingQueue, build_envelope

#: Stages an extract job reports, in order — the parse pipeline truncated after
#: TEXT, because extraction consumes an understood document rather than
#: reconstructing one.
EXTRACT_STAGES = [
    "ACCEPTED",
    "FETCHING",
    "PARSING",
    "LAYOUT",
    "TEXT",
    "STRUCTURE",
    "JSON",
    "PERSISTING",
    "DONE",
]

#: Split skips the layout work entirely: retrieval needs the chunk index, not a
#: page reconstruction. No LAYOUT, no TABLES, no IMAGES, no MARKDOWN.
SPLIT_STAGES = [
    "ACCEPTED",
    "FETCHING",
    "PARSING",
    "TEXT",
    "STRUCTURE",
    "JSON",
    "PERSISTING",
    "DONE",
]


def run(worker: Any, queue: RecordingQueue, operation: str, **kwargs: Any) -> None:
    """Enqueue one job for ``operation`` and let the worker run it to completion."""
    queue.pending.append(json.dumps(build_envelope(operation, **kwargs)))
    worker.handle_one()


# ── Extract ─────────────────────────────────────────────────────────────────


def test_extract_is_registered_for_the_extract_operation(settings: Any) -> None:
    processor = get_processor("EXTRACT", settings)
    assert isinstance(processor, ExtractProcessor)
    assert processor.operation == "EXTRACT"


def test_extract_reports_the_truncated_stage_sequence(
    worker: Any, queue: RecordingQueue, progress_calls: Any
) -> None:
    """The stage list is the contract the UI renders, so it is asserted exactly."""
    run(worker, queue, "EXTRACT")

    progress = progress_calls()
    assert [entry["stage"] for entry in progress] == EXTRACT_STAGES
    percentages = [entry["progress"] for entry in progress]
    assert percentages == sorted(percentages)
    assert percentages[0] == 0 and percentages[-1] == 100


def test_extract_writes_one_json_artifact(
    worker: Any, queue: RecordingQueue, storage_root: Path, complete_calls: Any
) -> None:
    """Extraction has no Markdown and no assets — one artifact, reported once."""
    run(worker, queue, "EXTRACT")

    path = storage_root / "artifacts/doc_0001/extract/extract.json"
    assert path.is_file()

    artifacts = complete_calls()["artifacts"]
    assert artifacts == [
        {
            "type": "JSON",
            "storageKey": "artifacts/doc_0001/extract/extract.json",
            "mimeType": "application/json",
            "sizeBytes": path.stat().st_size,
        }
    ]


def test_extract_resolves_a_known_field_with_its_sources(
    worker: Any, queue: RecordingQueue, storage_root: Path
) -> None:
    """A found value carries the page and the regions that support it.

    Traceability is the point: the UI turns ``sourceChunkIds`` into "show me
    where this came from" links, so a value without them would be unusable.
    """
    run(worker, queue, "EXTRACT")

    payload = json.loads(
        (storage_root / "artifacts/doc_0001/extract/extract.json").read_text("utf-8")
    )
    revenue = payload["extraction"]["total_revenue"]
    assert revenue["value"] == 482.6
    assert revenue["confidence"] == 0.96
    assert revenue["pageNumber"] == 2
    assert revenue["sourceChunkIds"] == ["chunk_011", "chunk_012"]
    # A number arrives as a number, not as a string that looks like one.
    assert isinstance(revenue["value"], float)


def test_extract_returns_null_rather_than_guessing(
    worker: Any, queue: RecordingQueue, storage_root: Path
) -> None:
    """A field the document does not answer is reported as not found.

    The conftest schema deliberately includes ``invented_field``, which no
    document could support. The correct output is an explicit null — *all four*
    keys present, so a client can read ``confidence`` unconditionally — not an
    omitted key, and not a plausible-looking string.
    """
    run(worker, queue, "EXTRACT")

    payload = json.loads(
        (storage_root / "artifacts/doc_0001/extract/extract.json").read_text("utf-8")
    )
    missing = payload["extraction"]["invented_field"]
    assert missing == {
        "value": None,
        "confidence": 0,
        "pageNumber": None,
        "sourceChunkIds": [],
    }


def test_extract_overall_confidence_is_the_mean_over_required_fields(
    worker: Any, queue: RecordingQueue, storage_root: Path
) -> None:
    """The conftest schema's four fields average to 0.7175.

    0.97 (company_name), 0.94 (reporting_period), 0.96 (total_revenue) and 0 for
    ``invented_field``. The unknown field is *counted*, at zero: dropping fields
    the document could not answer would let a schema that found nothing report
    perfect confidence, which is exactly backwards.
    """
    run(worker, queue, "EXTRACT")

    payload = json.loads(
        (storage_root / "artifacts/doc_0001/extract/extract.json").read_text("utf-8")
    )
    assert payload["overallConfidence"] == pytest.approx(0.7175, abs=1e-4)
    assert payload["schema"]["name"] == "Financial summary"
    assert len(payload["schema"]["fields"]) == 4


def test_extract_optional_fields_fall_back_to_the_full_field_set(
    worker: Any, queue: RecordingQueue, storage_root: Path
) -> None:
    """An all-optional schema still produces a meaningful number, not 0.

    ``required: False`` is the only way a field opts out; absent means required,
    matching the TS filter. With no required fields the mean is taken over
    everything rather than over the empty set — otherwise a perfectly good
    extraction would report 0.0 confidence.
    """
    fields = [
        SchemaField(name="company_name", type="string", required=False),
        SchemaField(name="total_revenue", type="number", required=False),
    ]
    queue.pending.append(
        json.dumps(
            build_envelope(
                "EXTRACT",
                input_payload={
                    "schemaName": "Optional only",
                    "fields": [to_wire(field) for field in fields],
                },
            )
        )
    )
    worker.handle_one()

    payload = json.loads(
        (storage_root / "artifacts/doc_0001/extract/extract.json").read_text("utf-8")
    )
    assert payload["overallConfidence"] == pytest.approx((0.97 + 0.96) / 2, abs=1e-4)


def test_extract_metrics_count_source_regions_not_fields(
    worker: Any, queue: RecordingQueue, complete_calls: Any
) -> None:
    """The badge says "chunks", so the number has to be chunks.

    The four schema fields cite chunk_001, chunk_002, chunk_011 and chunk_012 —
    four *distinct* regions across three fields plus one miss. A field count
    would report 4 by coincidence and a naive sum would report 5; only the
    distinct set is the honest "how much of the document did this read" figure.
    """
    run(worker, queue, "EXTRACT")

    metrics = complete_calls()["metrics"]
    assert metrics["chunkCount"] == 4  # chunk_001, chunk_002, chunk_011, chunk_012
    assert metrics["assetCount"] == 0
    assert metrics["tableCount"] == 0
    # Extraction produces no Markdown; zero rather than omitted, so the API can
    # read the metric unconditionally.
    assert metrics["markdownBytes"] == 0
    assert "chunks" not in metrics


def test_every_known_field_value_is_internally_consistent() -> None:
    """A canned value must carry sources and a confidence, or none of it.

    This is a guard on the fixture table itself: an entry that reports a value
    with no page or no chunks would produce a result the UI cannot link, and an
    entry with a confidence but no value would be a found-nothing that scores.
    """
    for name, entry in KNOWN_FIELD_VALUES.items():
        has_value = entry["value"] is not None
        assert has_value == bool(entry["chunks"]), name
        assert has_value == (entry["page"] is not None), name
        assert 0 <= entry["confidence"] <= 1, name
        if not has_value:
            assert entry["confidence"] == 0, name


# ── Split ───────────────────────────────────────────────────────────────────


def test_split_is_registered_for_the_split_operation(settings: Any) -> None:
    processor = get_processor("SPLIT", settings)
    assert isinstance(processor, SplitProcessor)
    assert processor.operation == "SPLIT"


def test_split_reports_its_own_stage_sequence(
    worker: Any, queue: RecordingQueue, progress_calls: Any
) -> None:
    run(worker, queue, "SPLIT")

    progress = progress_calls()
    assert [entry["stage"] for entry in progress] == SPLIT_STAGES
    assert "LAYOUT" not in [entry["stage"] for entry in progress]
    percentages = [entry["progress"] for entry in progress]
    assert percentages == sorted(percentages) and percentages[-1] == 100


def test_split_writes_one_json_artifact(
    worker: Any, queue: RecordingQueue, storage_root: Path, complete_calls: Any
) -> None:
    run(worker, queue, "SPLIT")

    path = storage_root / "artifacts/doc_0001/split/split.json"
    assert path.is_file()
    assert complete_calls()["artifacts"][0]["storageKey"] == "artifacts/doc_0001/split/split.json"

    payload = json.loads(path.read_text("utf-8"))
    assert payload["query"] == "Find the section about employee benefits."
    assert set(payload) == {"document", "query", "matches", "metadata"}


def test_split_matches_carry_geometry_and_a_rationale(
    worker: Any, queue: RecordingQueue, storage_root: Path
) -> None:
    """A match is a *region*: the preview overlay needs the box to draw it.

    The rationale is what makes the ranking inspectable — a score alone tells the
    user nothing about why a passage was returned.
    """
    run(worker, queue, "SPLIT")

    payload = json.loads(
        (storage_root / "artifacts/doc_0001/split/split.json").read_text("utf-8")
    )
    assert payload["matches"], "the benefits query has an answer in the fixture"

    top = payload["matches"][0]
    assert set(top) == {
        "chunk_id",
        "page_number",
        "text",
        "score",
        "bounding_box",
        "type",
        "rationale",
    }
    assert top["page_number"] == 3
    assert set(top["bounding_box"]) == {"x", "y", "width", "height"}
    assert top["rationale"]

    scores = [match["score"] for match in payload["matches"]]
    assert scores == sorted(scores, reverse=True)


def test_split_returns_nothing_for_an_unrelated_query() -> None:
    """The most important behaviour in the retriever: no match means no match.

    A system that always returns its best-scoring passage, however bad, is a
    system that fabricates an answer. The score floor exists so that an unrelated
    query comes back empty and the UI can say so.
    """
    assert retrieve("quantum chromodynamics lattice gauge theory", limit=8) == []
    assert retrieve("zzzzz", limit=8) == []


def test_split_honours_the_limit_after_ranking() -> None:
    """``limit`` truncates the ranked list; it must not change the ranking."""
    everything = retrieve("revenue region", limit=25)
    top_two = retrieve("revenue region", limit=2)

    assert len(everything) > 2, "the fixture should support a wider net"
    assert top_two == everything[:2]


def test_split_never_returns_furniture() -> None:
    """Headers, footers and page numbers are not answers.

    They repeat on every page, so a lexical retriever would rank them highly for
    almost any query. Excluding them by type is what keeps a result a passage
    rather than a page ornament.
    """
    matches = retrieve("northwind analytics page", limit=25)
    assert all(match.type not in {"header", "footer", "page_number"} for match in matches)


def test_split_metrics_count_returned_passages(
    worker: Any, queue: RecordingQueue, complete_calls: Any
) -> None:
    run(worker, queue, "SPLIT")

    metrics = complete_calls()["metrics"]
    assert metrics["chunkCount"] == len(retrieve("Find the section about employee benefits."))
    assert metrics["assetCount"] == 0
    assert metrics["markdownBytes"] == 0


def test_split_document_summary_quotes_the_query(
    worker: Any, queue: RecordingQueue, complete_calls: Any
) -> None:
    """The summary is what a history row shows, so it names the question asked."""
    run(worker, queue, "SPLIT")

    document = complete_calls()["document"]
    assert document["pageCount"] == 3
    assert document["title"] == DOCUMENT_TITLE
    assert "employee benefits" in document["summary"]


# ── Shared across all three operations ──────────────────────────────────────


@pytest.mark.parametrize("operation", ["PARSE", "EXTRACT", "SPLIT"])
def test_every_operation_writes_under_its_own_artifact_prefix(
    worker: Any, queue: RecordingQueue, storage_root: Path, operation: str
) -> None:
    """Document-scoped, operation-segmented — so a re-run overwrites in place.

    The operation segment is what keeps a parse's Markdown from colliding with an
    extraction's JSON on the same document; the document scope is what makes
    redelivery idempotent rather than accumulating a directory per attempt.
    """
    run(worker, queue, operation)

    written = sorted(
        path.relative_to(storage_root).as_posix()
        for path in (storage_root / "artifacts").rglob("*")
        if path.is_file()
    )
    assert written, f"{operation} produced no artifacts"
    assert all(
        key.startswith(f"artifacts/doc_0001/{operation.lower()}/") for key in written
    ), written


@pytest.mark.parametrize("operation", ["PARSE", "EXTRACT", "SPLIT"])
def test_every_operation_reports_a_done_stage_last(
    worker: Any, queue: RecordingQueue, progress_calls: Any, operation: str
) -> None:
    """Whichever pipeline runs, the user's last signal is 100% and a human note."""
    run(worker, queue, operation)

    progress = progress_calls()
    assert progress[-1]["stage"] == "DONE"
    assert progress[-1]["progress"] == 100
    assert progress[-1]["message"]
    assert all(entry["stage"] in JOB_STAGES for entry in progress)


@pytest.mark.parametrize(
    ("operation", "payload"),
    [
        # An EXTRACT job carrying split's input shape, and vice versa.
        ("EXTRACT", {"query": "employee benefits", "limit": 1}),
        ("SPLIT", {"schemaName": "s", "fields": []}),
    ],
)
def test_operation_rejects_an_input_for_another_operation(
    settings: Any, operation: str, payload: dict[str, Any]
) -> None:
    """A mismatched payload is a contract bug, not a document problem.

    The envelope's input union validates either shape, so nothing upstream
    catches this — which is exactly why the processor must. It is reported as a
    non-retryable ``INTERNAL_ERROR``: retrying would fail identically, and
    blaming the user's file for the API's mistake would be worse than useless.
    """
    processor = get_processor(operation, settings)
    envelope = JobEnvelope.model_validate(
        build_envelope(operation, job_id="job_mismatch", input_payload=payload)
    )
    ctx = ProcessingContext(
        envelope=envelope,
        reader=LocalStorageReader(settings.storage_root),
        writer=LocalStorageWriter(settings.storage_root),
        settings=settings,
        progress=lambda *args: None,
    )

    with pytest.raises(ProcessorFailure) as caught:
        processor.process(ctx)

    assert caught.value.request.error.code == "INTERNAL_ERROR"
    assert caught.value.request.error.retryable is False
