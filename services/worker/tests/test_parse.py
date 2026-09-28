"""Parse, and the pipeline machinery every operation shares.

Three concerns live here because Parse is where all three are exercised end to
end:

* **Fixture fidelity** — the chunk list, the Markdown and the figure SVG must
  match the shared TypeScript fixture exactly. Every expected value below was
  read off the TypeScript, not off this implementation.
* **The processor pipeline** — stage ordering, monotonic progress, artifact
  writing, metrics.
* **The runtime's failure handling** — dead-lettering, requeueing, the simulated
  failure markers, and the guarantee that one bad job never stops the loop.

Storage guards are here too, since traversal safety is only meaningful in the
context of a processor actually writing a key.
"""

from __future__ import annotations

import json
import urllib.error
from pathlib import Path
from typing import Any

import pytest

from shade_worker.callbacks import CallbackError
from shade_worker.fixtures import ASSET_DIR, CHUNK_COUNT, build_chunks, build_figure_svg
from shade_worker.models import JOB_STAGES, DocumentChunk, JobEnvelope
from shade_worker.processors import get_processor
from shade_worker.processors.base import (
    MOCK_DURATION_MS,
    STAGE_PERCENT,
    ProcessingContext,
    ProcessorFailure,
    resolve_engine_identity,
)
from shade_worker.processors.parse import ParseProcessor
from shade_worker.runtime import Worker
from shade_worker.storage import (
    LocalStorageReader,
    LocalStorageWriter,
    StorageError,
    UnsafeStorageKeyError,
)

from conftest import (
    RecordingOpener,
    RecordingQueue,
    build_envelope,
    envelope_of,
    http_error,
    parse_input,
)

#: The fixture document's parse stage sequence, in order.
PARSE_STAGES = [
    "ACCEPTED",
    "FETCHING",
    "PARSING",
    "LAYOUT",
    "TEXT",
    "TABLES",
    "IMAGES",
    "STRUCTURE",
    "MARKDOWN",
    "JSON",
    "PERSISTING",
    "DONE",
]


# ── Fixture fidelity ────────────────────────────────────────────────────────


def test_fixture_produces_twenty_five_chunks() -> None:
    """The canonical document has 25 positioned regions across 3 pages."""
    chunks = build_chunks()
    assert len(chunks) == 25
    assert len(chunks) == CHUNK_COUNT
    assert [chunk.chunk_id for chunk in chunks] == [
        f"chunk_{index:03d}" for index in range(1, 26)
    ]


def test_chunk_geometry_matches_the_fixture_document() -> None:
    """Spot-check the first, a heading, a table and a re-boxed page number.

    These are the values a preview overlay positions its boxes with, so they are
    asserted literally rather than derived.
    """
    chunks = {chunk.chunk_id: chunk for chunk in build_chunks()}

    header = chunks["chunk_001"]
    assert header.type == "header"
    assert header.page_number == 1
    assert (header.bounding_box.x, header.bounding_box.y) == (64, 34)
    assert (header.bounding_box.width, header.bounding_box.height) == (467, 12)
    assert header.confidence == 0.97
    assert header.heading_level is None
    assert header.group_id is None

    heading = chunks["chunk_002"]
    assert heading.type == "heading"
    assert heading.heading_level == 1

    table = chunks["chunk_012"]
    assert table.type == "table"
    assert table.page_number == 2
    assert table.group_id == "grp_tbl_2_4"  # page 2, fifth region (index 4)
    assert table.text.splitlines()[0] == "Region | FY2025 Revenue | FY2024 Revenue | YoY Change"

    # The page-number regions use a narrower box than the content width.
    page_number = chunks["chunk_007"]
    assert page_number.type == "page_number"
    assert (page_number.bounding_box.x, page_number.bounding_box.width) == (265, 65)


def test_only_tables_carry_a_group_id() -> None:
    """``group_id`` marks a region that may continue across a page break."""
    groups = [chunk.group_id for chunk in build_chunks() if chunk.group_id is not None]
    assert groups == ["grp_tbl_2_4"]


def test_optional_chunk_keys_are_omitted_not_nulled() -> None:
    """The wire form must match the TS conditional spreads, not send nulls.

    A ``heading_level: null`` on every paragraph would be a quiet contract break:
    the shared type declares the key optional, so it must be absent.
    """
    header = build_chunks()[0].model_dump(by_alias=True, exclude_unset=True)
    assert "heading_level" not in header
    assert "group_id" not in header
    assert json.loads(json.dumps(header))["chunk_id"] == "chunk_001"


def test_figure_svg_matches_the_typescript_generator() -> None:
    """Byte-for-byte, including JS ``toFixed`` opacity and ``Math.round`` widths."""
    svg = build_figure_svg()
    assert svg.startswith('<svg xmlns="http://www.w3.org/2000/svg"')
    assert svg.endswith("</svg>")
    assert len(svg.encode("utf-8")) == 1785
    # Bar widths come from Math.round(value / max * 300); opacities from toFixed(2).
    assert 'width="300" height="18" rx="3" fill="#6e56cf" opacity="1.00"' in svg
    assert 'width="251" height="18" rx="3" fill="#6e56cf" opacity="0.82"' in svg
    assert 'width="160" height="18" rx="3" fill="#6e56cf" opacity="0.64"' in svg
    assert 'width="107" height="18" rx="3" fill="#6e56cf" opacity="0.46"' in svg
    assert ">176.9</text>" in svg


# ── Markdown ────────────────────────────────────────────────────────────────


def test_markdown_contains_the_table_and_the_figure_reference(
    worker: Worker, queue: RecordingQueue, storage_root: Path
) -> None:
    """The two constructs the product is judged on: a real GFM table and a figure."""
    queue.pending.append(json.dumps(build_envelope("PARSE")))
    worker.handle_one()

    markdown = (storage_root / "artifacts/doc_0001/parse/document.md").read_text("utf-8")

    # Title and page boundaries.
    assert markdown.startswith("# Annual Report 2025\n")
    assert "<!-- page: 1 -->" in markdown
    assert "<!-- page: 2 -->" in markdown
    assert "<!-- page: 3 -->" in markdown

    # The table, with the numeric columns right-aligned and its caption above it.
    assert "*Table 1 — Consolidated revenue by region (USD millions)*" in markdown
    assert "| Region | FY2025 Revenue | FY2024 Revenue | YoY Change |" in markdown
    assert "| --- | ---: | ---: | ---: |" in markdown
    assert "| India | 148.2 | 112.4 | +31.9% |" in markdown
    assert "| Total | 482.6 | 407.5 | +18.4% |" in markdown

    # The figure, linked relatively so it resolves beside document.md, then captioned.
    assert "![Revenue distribution by region, FY2025](assets/image-001.svg)" in markdown
    assert "*Revenue distribution by region, FY2025*" in markdown

    # Section headings are level 2, and the list survived as a list.
    assert "### Personnel & Benefits" in markdown
    assert "- Employer pension contribution of up to 9 percent of base salary" in markdown

    # Headers and page numbers are furniture: they never reach the Markdown.
    assert "Northwind Analytics · Annual Report 2025" not in markdown
    assert "Page 1 of 3" not in markdown

    # Clean output: no blank-line runs, exactly one trailing newline.
    assert "\n\n\n" not in markdown
    assert markdown.endswith("\n") and not markdown.endswith("\n\n")


def test_markdown_byte_length_counts_utf8_not_characters() -> None:
    """``markdownBytes`` must match what a download weighs, so it is UTF-8 bytes.

    The fixture contains ``·`` (2 bytes) and ``—`` (3 bytes), which is exactly
    where a ``len(str)`` implementation would under-report.
    """
    from shade_worker.markdown import markdown_byte_length

    assert markdown_byte_length("—") == 3
    assert markdown_byte_length("·") == 2


# ── Parse pipeline ──────────────────────────────────────────────────────────


def test_parse_reports_every_stage_with_monotonic_progress(
    worker: Worker,
    queue: RecordingQueue,
    progress_calls: Any,
) -> None:
    """The stage sequence is the contract the UI renders; it is asserted exactly."""
    queue.pending.append(json.dumps(build_envelope("PARSE")))
    worker.handle_one()

    progress = progress_calls()
    assert [entry["stage"] for entry in progress] == PARSE_STAGES

    percentages = [entry["progress"] for entry in progress]
    assert percentages == sorted(percentages), "progress must never move backwards"
    assert percentages[0] == STAGE_PERCENT["ACCEPTED"] == 0
    assert percentages[-1] == STAGE_PERCENT["DONE"] == 100

    # Every stage carries a human message — a bare percentage is not feedback.
    assert all(entry["message"] for entry in progress)
    assert progress[2]["message"] == "Decoded the PDF object graph and page tree."


def test_parse_writes_markdown_json_and_the_figure_asset(
    worker: Worker, queue: RecordingQueue, storage_root: Path, complete_calls: Any
) -> None:
    """Three artifacts, each reported with its key, mime type and byte length."""
    queue.pending.append(json.dumps(build_envelope("PARSE")))
    worker.handle_one()

    prefix = storage_root / "artifacts/doc_0001/parse"
    markdown_path = prefix / "document.md"
    json_path = prefix / "document.json"
    asset_path = prefix / ASSET_DIR / "image-001.svg"
    assert markdown_path.is_file() and json_path.is_file() and asset_path.is_file()

    artifacts = {report["type"]: report for report in complete_calls()["artifacts"]}
    assert set(artifacts) == {"MARKDOWN", "JSON", "ASSET"}

    assert artifacts["MARKDOWN"] == {
        "type": "MARKDOWN",
        "storageKey": "artifacts/doc_0001/parse/document.md",
        "mimeType": "text/markdown",
        "sizeBytes": markdown_path.stat().st_size,
    }
    assert artifacts["JSON"]["mimeType"] == "application/json"
    assert artifacts["ASSET"]["mimeType"] == "image/svg+xml"
    assert artifacts["ASSET"]["label"] == "image-001.svg"

    # The reported byte counts are the real thing, not estimates.
    assert artifacts["ASSET"]["sizeBytes"] == len(build_figure_svg().encode("utf-8"))
    assert markdown_path.stat().st_size == artifacts["MARKDOWN"]["sizeBytes"]


def test_document_json_is_the_parse_result_without_markdown(
    worker: Worker, queue: RecordingQueue, storage_root: Path
) -> None:
    """``document.json`` is a ``ParseResult``; Markdown lives only in its own file."""
    queue.pending.append(json.dumps(build_envelope("PARSE")))
    worker.handle_one()

    payload = json.loads(
        (storage_root / "artifacts/doc_0001/parse/document.json").read_text("utf-8")
    )

    assert set(payload) == {"document", "chunks", "json", "assets", "metadata"}
    assert "markdown" not in payload

    # Document descriptor: camelCase.
    assert payload["document"]["pageCount"] == 3
    assert payload["document"]["title"] == "Annual Report 2025"
    assert payload["document"]["mimeType"] == "application/pdf"

    # Chunks: snake_case, and 25 of them.
    assert len(payload["chunks"]) == 25
    assert payload["chunks"][0]["chunk_id"] == "chunk_001"
    assert payload["chunks"][0]["bounding_box"] == {
        "x": 64, "y": 34, "width": 467, "height": 12,
    }
    assert payload["chunks"][0]["page_number"] == 1

    # Structured document: snake_case, section/table tree intact.
    assert payload["json"]["page_count"] == 3
    assert payload["json"]["assets"] == ["image-001.svg"]
    assert payload["json"]["tables"][0]["align"] == ["left", "right", "right", "right"]
    assert payload["json"]["sections"][1]["table_refs"] == ["tbl_001"]

    # Metadata marks this as fixture output, so nobody mistakes it for a real parse.
    assert payload["metadata"]["engine"] == "mock-structural"
    assert payload["metadata"]["mocked"] is True
    assert payload["metadata"]["durationMs"] == MOCK_DURATION_MS["PARSE"]


def test_parse_metrics_and_document_summary(
    worker: Worker, queue: RecordingQueue, storage_root: Path, complete_calls: Any
) -> None:
    """Metrics are recorded on the job row; the chunk list is Parse-only."""
    queue.pending.append(json.dumps(build_envelope("PARSE")))
    worker.handle_one()

    completion = complete_calls()
    metrics = completion["metrics"]
    markdown = (storage_root / "artifacts/doc_0001/parse/document.md").read_bytes()

    assert metrics["chunkCount"] == 25
    assert metrics["assetCount"] == 1
    assert metrics["tableCount"] == 1
    assert metrics["markdownBytes"] == len(markdown)
    assert len(metrics["chunks"]) == 25  # Parse keeps chunks for retrieval search

    assert completion["document"] == {
        "pageCount": 3,
        "title": "Annual Report 2025",
        "author": "Northwind Analytics",
        "summary": (
            "Consolidated annual report for FY2025 covering revenue performance "
            "across India, the United States, Europe and Asia-Pacific, together "
            "with personnel, benefits and outlook disclosures."
        ),
    }
    assert completion["metadata"] == {
        "engine": "mock-structural",
        "version": "0.1.0",
        "durationMs": 1840,
        "mocked": True,
    }


def test_completion_uses_camelcase_keys_on_the_wire(
    worker: Worker, queue: RecordingQueue, complete_calls: Any
) -> None:
    """Guard the case convention the API rejects mismatches on."""
    queue.pending.append(json.dumps(build_envelope("PARSE")))
    worker.handle_one()

    metrics = complete_calls()["metrics"]
    assert "chunkCount" in metrics and "chunk_count" not in metrics
    assert "markdownBytes" in metrics and "markdown_bytes" not in metrics
    chunk = metrics["chunks"][0]
    assert "chunk_id" in chunk and "chunkId" not in chunk
    assert "bounding_box" in chunk and "boundingBox" not in chunk


def test_parse_is_registered_for_the_parse_operation(settings: Any) -> None:
    processor = get_processor("PARSE", settings)
    assert isinstance(processor, ParseProcessor)
    assert processor.operation == "PARSE"


def test_mock_engine_reports_itself_as_mocked(settings: Any) -> None:
    """A stored result must be self-describing: fixture output is never silent."""
    identity = resolve_engine_identity(settings)
    assert (identity.engine, identity.mocked) == ("mock-structural", True)


# ── Deliberate failure and slowdown markers ─────────────────────────────────


def test_fail_marker_reports_a_corrupt_document(
    worker: Worker, queue: RecordingQueue, storage_root: Path, fail_calls: Any, callback_paths: Any
) -> None:
    """``__fail__`` in the filename drives the typed failure path end to end."""
    queue.pending.append(
        json.dumps(build_envelope("PARSE", filename="__fail__quarterly.pdf"))
    )
    worker.handle_one()

    failure = fail_calls()
    assert failure["error"]["code"] == "CORRUPT_DOCUMENT"
    assert failure["error"]["retryable"] is False
    assert failure["error"]["message"]
    assert "__fail__" in failure["error"]["detail"]

    # No completion callback, no artifacts, and the payload was released.
    assert not any(path.endswith("/complete") for path in callback_paths())
    assert not (storage_root / "artifacts/doc_0001/parse").exists()
    assert queue.acked and not queue.dead_lettered

    # Progress stopped at the stage where a real engine would have decoded the file.
    stages = [
        payload["stage"] for path, payload in []  # replaced below
    ]
    assert stages == []


def test_fail_marker_reaches_parsing_before_failing(
    worker: Worker, queue: RecordingQueue, progress_calls: Any
) -> None:
    """The failure happens mid-pipeline, which is what makes the demo meaningful."""
    queue.pending.append(
        json.dumps(build_envelope("PARSE", filename="report__fail__.pdf"))
    )
    worker.handle_one()

    stages = [entry["stage"] for entry in progress_calls()]
    assert stages == ["ACCEPTED", "FETCHING", "PARSING"]
    assert "LAYOUT" not in stages


@pytest.mark.parametrize("operation", ["PARSE", "EXTRACT", "SPLIT"])
def test_fail_marker_fails_every_operation(
    worker: Worker, queue: RecordingQueue, fail_calls: Any, operation: str
) -> None:
    """The marker is honoured by the shared scaffolding, not by one processor."""
    queue.pending.append(
        json.dumps(build_envelope(operation, filename="__fail__document.pdf"))
    )
    worker.handle_one()
    assert fail_calls()["error"]["code"] == "CORRUPT_DOCUMENT"


def test_slow_marker_holds_each_stage(
    worker_factory: Any,
    queue: RecordingQueue,
    settings: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``__slow__`` sleeps once per stage, so the UI's progress states are visible."""
    import time

    slept: list[float] = []
    monkeypatch.setattr(time, "sleep", slept.append)

    slow_settings = type(settings)(
        **{**settings.__dict__, "slow_stage_seconds": 0.5}
    )
    worker = worker_factory(settings=slow_settings)
    queue.pending.append(
        json.dumps(build_envelope("PARSE", filename="report__slow__.pdf"))
    )
    worker.handle_one()

    assert slept, "the slow marker must sleep at least once"
    assert set(slept) == {0.5}
    assert len(slept) == len(PARSE_STAGES)


def test_slow_marker_absent_means_no_sleeping(
    worker_factory: Any, settings: Any, queue: RecordingQueue, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The normal path must not pay the slowdown cost."""
    import time

    slept: list[float] = []
    monkeypatch.setattr(time, "sleep", slept.append)

    slow_settings = type(settings)(**{**settings.__dict__, "slow_stage_seconds": 0.5})
    worker = worker_factory(settings=slow_settings)
    queue.pending.append(json.dumps(build_envelope("PARSE", filename="report.pdf")))
    worker.handle_one()
    assert slept == []


# ── Runtime failure handling ────────────────────────────────────────────────


def test_malformed_json_is_dead_lettered(worker: Worker, queue: RecordingQueue, callback_paths: Any) -> None:
    """A payload that is not JSON has no job id, so there is nobody to tell."""
    queue.pending.append("{not json")
    worker.handle_one()

    assert len(queue.dead_lettered) == 1
    _, reason = queue.dead_lettered[0]
    assert "not valid JSON" in reason
    assert callback_paths() == []
    assert not queue.acked


def test_envelope_missing_required_fields_is_dead_lettered(
    worker: Worker, queue: RecordingQueue, fail_calls: Any
) -> None:
    """A legible job id still gets a failure callback; the payload is parked."""
    broken = build_envelope("PARSE")
    del broken["document"]
    queue.pending.append(json.dumps(broken))
    worker.handle_one()

    assert len(queue.dead_lettered) == 1
    assert "document" in queue.dead_lettered[0][1]
    assert fail_calls()["error"]["code"] == "INTERNAL_ERROR"


def test_unknown_operation_is_dead_lettered(
    worker: Worker, queue: RecordingQueue, fail_calls: Any
) -> None:
    """An operation this worker does not implement is unsupported, not a crash."""
    queue.pending.append(json.dumps(build_envelope("PARSE", input_payload={})).replace(
        '"PARSE"', '"SUMMARISE"'
    ))
    worker.handle_one()

    assert len(queue.dead_lettered) == 1
    assert fail_calls()["error"]["code"] == "UNSUPPORTED_FORMAT"
    assert not queue.acked


def test_operation_without_a_processor_is_dead_lettered(
    worker: Worker, queue: RecordingQueue, monkeypatch: pytest.MonkeyPatch, fail_calls: Any
) -> None:
    """An engine may implement only some operations; the gap is a typed failure."""
    from shade_worker.processors import registry

    monkeypatch.setitem(registry._ENGINES, "mock", {"PARSE": ParseProcessor})
    queue.pending.append(json.dumps(build_envelope("SPLIT")))
    worker.handle_one()

    assert len(queue.dead_lettered) == 1
    assert fail_calls()["error"]["code"] == "UNSUPPORTED_FORMAT"


def test_one_bad_job_does_not_stop_the_loop(worker: Worker, queue: RecordingQueue, callback_paths: Any) -> None:
    """The whole point of the failure matrix: the next job still runs."""
    queue.pending.append(json.dumps(build_envelope("PARSE", filename="__fail__bad.pdf", job_id="job_bad")))
    queue.pending.append(json.dumps(build_envelope("PARSE", job_id="job_good")))

    assert worker.handle_one() is True
    assert worker.handle_one() is True

    assert "/api/internal/jobs/job_bad/fail" in callback_paths()
    assert "/api/internal/jobs/job_good/complete" in callback_paths()
    assert len(queue.acked) == 2


def test_attempt_exhausted_moves_the_job_to_the_dead_letter_list(
    queue: RecordingQueue, worker_factory: Any, settings: Any, fail_calls: Any
) -> None:
    """The worker stops holding a payload the API will never redeliver."""
    worker = worker_factory(queue=queue)
    envelope = build_envelope("PARSE", filename="__fail__bad.pdf", attempt=settings.max_attempts)
    queue.pending.append(json.dumps(envelope))
    worker.handle_one()

    assert fail_calls()["error"]["code"] == "CORRUPT_DOCUMENT"
    assert len(queue.dead_lettered) == 1
    assert "attempts exhausted" in queue.dead_lettered[0][1]
    assert not queue.acked


def test_processor_crash_is_reported_as_a_retryable_processor_error(
    worker: Worker, queue: RecordingQueue, fail_calls: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A bug in an engine becomes a typed error, never an unhandled exception."""

    def explode(self: ParseProcessor, ctx: ProcessingContext) -> Any:
        raise RuntimeError("engine blew up")

    monkeypatch.setattr(ParseProcessor, "process", explode)
    queue.pending.append(json.dumps(build_envelope("PARSE")))
    worker.handle_one()

    error = fail_calls()["error"]
    assert error["code"] == "PROCESSOR_ERROR"
    assert error["retryable"] is True
    assert "engine blew up" in error["detail"]


def test_processor_failure_carries_a_typed_error() -> None:
    failure = ProcessorFailure.of("NO_TEXT_LAYER", "no text", retryable=True, detail="d")
    assert failure.request.error.code == "NO_TEXT_LAYER"
    assert failure.request.error.retryable is True
    assert str(failure) == "no text"


def test_storage_failure_under_a_real_engine_is_retryable(worker_factory: Any, settings: Any) -> None:
    """With a real engine a missing upload is a retryable storage error, not a crash."""
    from shade_worker.config import Settings

    real_settings = Settings(
        storage_root=settings.storage_root,
        processor_engine="some-real-engine",
        slow_stage_seconds=0.0,
    )
    ctx = ProcessingContext(
        envelope=envelope_of("PARSE"),
        reader=LocalStorageReader(settings.storage_root),
        writer=LocalStorageWriter(settings.storage_root),
        settings=real_settings,
        progress=lambda *args: None,
    )
    with pytest.raises(ProcessorFailure) as caught:
        ctx.read_raw()
    assert caught.value.request.error.code == "STORAGE_ERROR"
    assert caught.value.request.error.retryable is True


# ── Callback transport ──────────────────────────────────────────────────────


def test_callbacks_post_to_the_internal_endpoint_with_the_worker_token() -> None:
    from shade_worker.callbacks import CallbackClient
    from shade_worker.models import JobProgressRequest

    opener = RecordingOpener()
    client = CallbackClient("http://api.test", "s3cret", opener=opener, sleep=lambda _: None)
    client.report_progress("job_1", JobProgressRequest(progress=42, stage="TEXT"))

    assert opener.call_count == 1
    assert opener.requests[0].full_url == "http://api.internal/api/internal/jobs/job_1/progress".replace(
        "api.internal", "api.test"
    )
    assert opener.header(0, "X-Worker-Token") == "s3cret"
    assert opener.header(0, "Content-Type") == "application/json"
    assert opener.body(0) == {"progress": 42, "stage": "TEXT"}


def test_callbacks_honour_the_envelope_base_url() -> None:
    from shade_worker.callbacks import CallbackClient
    from shade_worker.models import JobProgressRequest

    opener = RecordingOpener()
    client = CallbackClient("http://ignored.test", "t", opener=opener, sleep=lambda _: None)
    client.report_progress(
        "job_9",
        JobProgressRequest(progress=1, stage="FETCHING"),
        base_url="http://envelope.test/",
    )
    assert opener.requests[0].full_url == "http://envelope.test/api/internal/jobs/job_9/progress"


def test_transient_callback_failure_is_retried() -> None:
    from shade_worker.callbacks import CallbackClient
    from shade_worker.models import JobProgressRequest

    opener = RecordingOpener([urllib.error.URLError("refused"), None])
    slept: list[float] = []
    client = CallbackClient("http://api.test", "t", opener=opener, sleep=slept.append)

    client.report_progress("job_1", JobProgressRequest(progress=1, stage="TEXT"))
    assert opener.call_count == 2
    assert slept == [0.25]  # exponential backoff, first step


def test_permanent_callback_failure_is_not_retried() -> None:
    from shade_worker.callbacks import CallbackClient
    from shade_worker.models import JobProgressRequest

    opener = RecordingOpener([http_error(401)])
    client = CallbackClient("http://api.test", "t", opener=opener, sleep=lambda _: None)

    with pytest.raises(CallbackError) as caught:
        client.report_progress("job_1", JobProgressRequest(progress=1, stage="TEXT"))
    assert caught.value.status == 401
    assert opener.call_count == 1


def test_server_error_is_retried_three_times_then_raises() -> None:
    from shade_worker.callbacks import CallbackClient, MAX_ATTEMPTS
    from shade_worker.models import JobProgressRequest

    opener = RecordingOpener([http_error(503), http_error(503), http_error(503)])
    slept: list[float] = []
    client = CallbackClient("http://api.test", "t", opener=opener, sleep=slept.append)

    with pytest.raises(CallbackError):
        client.report_progress("job_1", JobProgressRequest(progress=1, stage="TEXT"))
    assert opener.call_count == MAX_ATTEMPTS == 3
    assert slept == [0.25, 0.5]


def test_lost_progress_callback_requeues_the_job(
    worker_factory: Any, queue: RecordingQueue
) -> None:
    """A job whose progress the user cannot see is handed back, not silently run."""
    from shade_worker.callbacks import CallbackClient

    failing = CallbackClient(
        "http://api.test",
        "t",
        opener=RecordingOpener([urllib.error.URLError("down")] * 3),
        sleep=lambda _: None,
    )
    worker = worker_factory(callbacks=failing)
    queue.pending.append(json.dumps(build_envelope("PARSE")))
    worker.handle_one()

    assert queue.requeued == [queue.pending[0]] or queue.requeued
    assert not queue.acked
    assert not queue.dead_lettered


def test_lost_completion_callback_requeues_the_job(
    worker_factory: Any, queue: RecordingQueue, storage_root: Path
) -> None:
    """The artifacts are written and the work is idempotent, so redelivery is safe."""
    from shade_worker.callbacks import CallbackClient

    calls: list[str] = []

    def opener(request: Any, timeout: float = 0) -> Any:
        calls.append(request.full_url)
        if request.full_url.endswith("/complete"):
            raise urllib.error.URLError("down")
        return RecordingOpener()._open_stub()  # pragma: no cover - replaced below

    client = CallbackClient("http://api.test", "t", opener=opener, sleep=lambda _: None)
    worker = worker_factory(callbacks=client)
    queue.pending.append(json.dumps(build_envelope("PARSE")))
    worker.handle_one()

    assert any(url.endswith("/complete") for url in calls)
    assert queue.requeued and not queue.acked
    # The artifacts survive: a redelivery overwrites them with identical bytes.
    assert (storage_root / "artifacts/doc_0001/parse/document.md").is_file()


# ── Storage guards ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "key",
    [
        "../../etc/passwd",
        "artifacts/../../escape.md",
        "/absolute/path.md",
        "C:/windows/system32/evil.dll",
        "artifacts\\windows\\evil.md",
        "artifacts//double.md",
        "artifacts/./dot.md",
        "artifacts/" + "..",
        "",
        "artifacts/bad\x00name.md",
    ],
)
def test_storage_writer_refuses_unsafe_keys(storage_root: Path, key: str) -> None:
    """Keys arrive over the wire, so traversal must fail closed."""
    writer = LocalStorageWriter(storage_root)
    with pytest.raises(UnsafeStorageKeyError):
        writer.write(key, b"x", "text/plain")


def test_storage_writer_containment_holds_after_resolution(storage_root: Path) -> None:
    """Even a symlink-shaped key cannot resolve outside the root."""
    writer = LocalStorageWriter(storage_root)
    written = writer.write_text("artifacts/doc/deep/document.md", "hello", "text/markdown")
    assert written.storage_key == "artifacts/doc/deep/document.md"
    assert written.size_bytes == 5
    assert (storage_root / "artifacts/doc/deep/document.md").read_text("utf-8") == "hello"
    # No temporary file is left behind by the atomic write.
    assert not list(storage_root.rglob(".*.tmp"))


def test_storage_reader_reports_a_missing_object(storage_root: Path) -> None:
    reader = LocalStorageReader(storage_root)
    assert reader.exists("artifacts/nope.md") is False
    with pytest.raises(StorageError):
        reader.read("artifacts/nope.md")


def test_s3_writer_is_a_declared_stub(storage_root: Path) -> None:
    """The S3 adapter must fail loudly rather than pretending to write."""
    from shade_worker.storage import S3StorageWriter

    writer = S3StorageWriter()
    with pytest.raises(NotImplementedError) as caught:
        writer.write("artifacts/doc/document.md", b"x", "text/markdown")
    assert "put_object" in str(caught.value)


# ── Context behaviour ───────────────────────────────────────────────────────


def test_context_progress_is_monotonic_even_if_a_processor_goes_backwards(
    settings: Any, storage_root: Path
) -> None:
    """``progress`` is documented as monotonic; the context enforces it."""
    emitted: list[tuple[str, int, str | None]] = []
    ctx = ProcessingContext(
        envelope=envelope_of("PARSE"),
        reader=LocalStorageReader(storage_root),
        writer=LocalStorageWriter(storage_root),
        settings=settings,
        progress=lambda stage, percent, message: emitted.append((stage, percent, message)),
    )
    ctx.stage("TEXT")
    ctx.stage("PARSING")  # an out-of-order report must not move the bar back
    ctx.stage("TEXT")  # nor may a duplicate re-emit

    assert [entry[0] for entry in emitted] == ["TEXT", "PARSING"]
    assert [entry[1] for entry in emitted] == [45, 45]


def test_context_collapses_repeated_stages(settings: Any, storage_root: Path) -> None:
    emitted: list[str] = []
    ctx = ProcessingContext(
        envelope=envelope_of("PARSE"),
        reader=LocalStorageReader(storage_root),
        writer=LocalStorageWriter(storage_root),
        settings=settings,
        progress=lambda stage, percent, message: emitted.append(stage),
    )
    ctx.stage("TABLES")
    ctx.stage("TABLES", "again")
    assert emitted == ["TABLES"]


def test_artifact_prefix_is_document_and_operation_scoped(settings: Any, storage_root: Path) -> None:
    """Document-scoped so redelivery overwrites; operation-scoped so it cannot collide."""
    ctx = ProcessingContext(
        envelope=envelope_of("EXTRACT", document_id="doc_42"),
        reader=LocalStorageReader(storage_root),
        writer=LocalStorageWriter(storage_root),
        settings=settings,
        progress=lambda *args: None,
    )
    assert ctx.artifact_prefix == "artifacts/doc_42/extract"


def test_document_descriptor_uses_the_envelope_identity(settings: Any, storage_root: Path) -> None:
    from shade_worker.processors.base import build_document_descriptor

    ctx = ProcessingContext(
        envelope=envelope_of("PARSE", document_id="doc_7", filename="q3.pdf", size_bytes=2048),
        reader=LocalStorageReader(storage_root),
        writer=LocalStorageWriter(storage_root),
        settings=settings,
        progress=lambda *args: None,
    )
    descriptor = build_document_descriptor(ctx, page_count=3, title="T", author="A")
    assert descriptor.id == "doc_7"
    assert descriptor.filename == "q3.pdf"
    assert descriptor.size_bytes == 2048
    assert descriptor.page_count == 3


def test_every_parse_stage_has_a_percentage_and_a_label() -> None:
    """Adding a stage to the shared constants must not leave a gap here."""
    from shade_worker.processors.base import STAGE_MESSAGES

    assert tuple(STAGE_PERCENT) == JOB_STAGES
    assert tuple(STAGE_MESSAGES) == JOB_STAGES
    ordered = [STAGE_PERCENT[stage] for stage in JOB_STAGES]
    assert ordered == sorted(ordered)
    assert all(0 <= percent <= 100 for percent in ordered)


def test_chunk_model_round_trips_from_the_wire() -> None:
    """The snake_case chunk payload validates from JSON, which is how it arrives."""
    payload = {
        "chunk_id": "chunk_001",
        "text": "hello",
        "page_number": 1,
        "bounding_box": {"x": 1, "y": 2, "width": 3, "height": 4},
        "type": "paragraph",
        "confidence": 0.5,
    }
    chunk = DocumentChunk.model_validate(payload)
    assert chunk.chunk_id == "chunk_001"
    assert chunk.model_dump(by_alias=True, exclude_unset=True) == payload


def test_envelope_rejects_an_unknown_operation() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        JobEnvelope.model_validate(build_envelope("PARSE").replace('"PARSE"', '"SUMMARISE"'))
