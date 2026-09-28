"""The processor interface — the seam a real engine drops into.

Why this module exists
----------------------
Everything else in the worker (queue, callbacks, storage, runtime) is plumbing
that is identical for every operation and every engine. The only thing that
varies — parse vs extract vs split, mock fixture vs OCR + layout model + LLM — is
what happens *between* reserving a job and reporting its artifacts. That is
exactly the surface this module defines:

.. code-block:: python

    class MyParseProcessor(DocumentProcessor):
        @property
        def operation(self) -> Operation:
            return "PARSE"

        def process(self, ctx: ProcessingContext) -> ProcessingOutput:
            raw = ctx.read_raw()          # the uploaded bytes
            ctx.stage("PARSING")          # -> POST /progress
            ...                            # your engine goes here
            written = ctx.writer.write("artifacts/…/document.md", md, "text/markdown")
            ctx.stage("DONE")
            return ProcessingOutput(artifacts=[…], document=…, metrics=…, metadata=…)

Register it in ``processors/registry.py`` under an engine name, set
``PROCESSOR_ENGINE`` to that name, and nothing else in the worker changes. A
processor never touches Redis, never constructs an HTTP request, and never learns
a job id beyond what the context hands it.

The pipeline stages
-------------------
``JOB_STAGES`` in the shared constants is not decoration — it is the shape of a
document-understanding pipeline, and each stage names the component that would do
the work in a real engine:

``FETCHING``
    Stream the raw upload out of object storage. Real engine: unchanged; only the
    byte source moves from local disk to S3.
``PARSING``
    Decode the container: PDF object graph, xref, page tree, embedded fonts.
    Real engine: ``pdfium``/``pypdf`` for text PDFs, ``pikepdf`` for repair, a
    rasteriser for scans. The point at which ``CORRUPT_DOCUMENT`` and
    ``ENCRYPTED_DOCUMENT`` are detected.
``LAYOUT``
    Detect regions and reading order on each page. Real engine: a layout model
    (LayoutLM-family, DocTR, or a classical XY-cut) emitting typed boxes. This is
    where ``DocumentChunk.bounding_box`` and ``ChunkType`` come from.
``TEXT``
    Per-region text with styles. Real engine: PDF text layer where present, OCR
    otherwise; ``NO_TEXT_LAYER`` is raised here when neither yields text.
``TABLES``
    Recover cell structure. Real engine: a table-structure model, plus the
    spanning-cell logic that fills ``StructuredTable.align``.
``IMAGES``
    Extract figures, charts and logos and rasterise them to standalone assets.
    Real engine: image XObject extraction plus region cropping; here it is the
    single deterministic SVG in ``fixtures.build_figure_svg``.
``STRUCTURE``
    Assemble regions into the section tree: heading levels, list grouping,
    caption attachment, page-spanning continuation via ``group_id``. Real engine:
    a rule pass over the layout output, optionally an LLM for hierarchy repair.
``MARKDOWN``
    Render the structure. Real engine: unchanged — ``markdown.render_markdown``
    is engine-independent by construction, because it consumes the structure and
    not the raw chunks.
``JSON``
    Emit the machine-oriented view (``ParseResult``).
``PERSISTING``
    Write artifacts through the storage writer and collect their keys.
``DONE``
    100% and the completion callback.

Extract and Split reuse the same scaffolding with a shorter path: they consume
the *result* of a parse (in this milestone, the same fixture) rather than
re-deriving it, so their stage sequence starts at ``PARSING`` and ends at
``PERSISTING``.
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Callable, Mapping

from ..config import Settings
from ..fixtures import build_metadata, iso_timestamp
from ..models import (
    JOB_STAGE_LABELS,
    DocumentDescriptor,
    JobEnvelope,
    JobError,
    JobErrorCode,
    JobFailRequest,
    JobStage,
    Operation,
    ProcessorMetadata,
    ProcessingOutput,
    ProgressCallback,
)
from ..storage import StorageError, StorageReader, StorageWriter

__all__ = [
    "DocumentProcessor",
    "FAIL_MARKER",
    "MOCK_DURATION_MS",
    "MOCK_ENGINE",
    "ProcessorFailure",
    "ProcessingContext",
    "SLOW_MARKER",
    "STAGE_PERCENT",
    "build_document_descriptor",
    "resolve_engine_identity",
]

logger = logging.getLogger(__name__)

#: The engine name that resolves to the deterministic fixture processors.
MOCK_ENGINE = "mock"

#: Name reported in ``metadata.engine`` while the fixture engine is active.
#: Matches `ENGINE` in the shared `mock/engine.ts` so the API's inline dispatcher
#: and this worker are indistinguishable in stored results.
MOCK_ENGINE_NAME = "mock-structural"

#: Fixed per-operation durations the mock reports. Mirrors the small fixed costs
#: in engine.ts: plausible timings that keep tests fast and output deterministic.
MOCK_DURATION_MS: Mapping[str, int] = {
    "PARSE": 1_840,
    "EXTRACT": 2_610,
    "SPLIT": 420,
}

#: Progress percentage for each stage. Strictly increasing, so a stage never
#: moves the bar backwards; ``ACCEPTED`` and ``DONE`` are the endpoints.
STAGE_PERCENT: Mapping[JobStage, int] = {
    "ACCEPTED": 0,
    "FETCHING": 5,
    "PARSING": 15,
    "LAYOUT": 30,
    "TEXT": 45,
    "TABLES": 58,
    "IMAGES": 68,
    "STRUCTURE": 78,
    "MARKDOWN": 86,
    "JSON": 92,
    "PERSISTING": 96,
    "DONE": 100,
}

#: Default human message per stage, used when a processor supplies none.
STAGE_MESSAGES: Mapping[JobStage, str] = {
    stage: label for stage, label in JOB_STAGE_LABELS.items()
}

#: Filename markers. Both are demo affordances — see the README — and both are
#: matched case-sensitively against the uploaded filename.
FAIL_MARKER = "__fail__"
SLOW_MARKER = "__slow__"


# ── Failure ─────────────────────────────────────────────────────────────────


class ProcessorFailure(Exception):
    """A processing failure with a reportable, typed error.

    Carries the ``JobFailRequest`` the runtime should post, rather than letting
    processors call the callback client themselves. That keeps processors
    transport-free and makes the failure path trivially testable.
    """

    def __init__(self, request: JobFailRequest) -> None:
        super().__init__(request.error.message)
        self.request = request

    @classmethod
    def of(
        cls,
        code: JobErrorCode,
        message: str,
        *,
        retryable: bool,
        detail: str | None = None,
    ) -> "ProcessorFailure":
        kwargs: dict[str, object] = {
            "code": code,
            "message": message,
            "retryable": retryable,
        }
        if detail is not None:
            kwargs["detail"] = detail
        return cls(JobFailRequest(error=JobError(**kwargs)))  # type: ignore[arg-type]


# ── Engine identity ─────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class EngineIdentity:
    """How the current engine describes itself in result metadata."""

    engine: str
    version: str
    mocked: bool


def resolve_engine_identity(settings: Settings) -> EngineIdentity:
    """Map ``PROCESSOR_ENGINE`` onto the ``metadata`` block of a result.

    The mock reports its own name (``mock-structural``) and ``mocked: true`` so
    that a stored result is self-describing: nobody can mistake fixture output
    for a real extraction six months from now. Any other engine name is reported
    verbatim with ``mocked: false``.
    """
    if settings.processor_engine == MOCK_ENGINE:
        return EngineIdentity(
            engine=MOCK_ENGINE_NAME, version=settings.processor_version, mocked=True
        )
    return EngineIdentity(
        engine=settings.processor_engine, version=settings.processor_version, mocked=False
    )


def build_document_descriptor(
    ctx: "ProcessingContext",
    *,
    page_count: int,
    title: str | None,
    author: str | None,
) -> DocumentDescriptor:
    """The ``DocumentDescriptor`` embedded in every processing result.

    ``createdAt`` is *not* on the envelope, so the worker stamps the moment it
    started processing. That is honest (it is the worker's timestamp, not a claim
    about the upload) and the API's own stored descriptor remains authoritative.
    """
    envelope = ctx.envelope
    return DocumentDescriptor(
        id=envelope.document_id,
        filename=envelope.document.filename,
        mime_type=envelope.document.mime_type,
        size_bytes=envelope.document.size_bytes,
        page_count=page_count,
        title=title,
        author=author,
        created_at=ctx.started_at_iso(),
    )


# ── Context ─────────────────────────────────────────────────────────────────


@dataclass
class ProcessingContext:
    """Everything a processor is allowed to touch.

    Deliberately narrow. A processor gets:

    * the ``envelope`` — its job id, document id, operation input and document
      metadata, and nothing else about the rest of the system;
    * a storage ``reader`` (fetch the raw upload) and ``writer`` (persist
      artifacts), both protocols, so the backing store is not its business;
    * a ``progress`` callback that posts a stage transition to the API;
    * ``now_ms``, an injectable clock so tests are deterministic.

    It does *not* get a Redis client, an HTTP client, or a database handle. That
    is the whole architectural point: swapping the queue or the callback
    transport must never require editing a processor.
    """

    envelope: JobEnvelope
    reader: StorageReader
    writer: StorageWriter
    settings: Settings
    progress: ProgressCallback
    now_ms: Callable[[], int] = lambda: int(time.time() * 1000)

    #: Highest percentage emitted so far. Progress is documented as monotonic
    #: within a job, so the context enforces it rather than trusting callers.
    _last_percent: int = -1
    _last_stage: JobStage | None = None

    #: Epoch milliseconds the runtime recorded just before calling ``process``.
    #: Excluded from ``__init__`` because it is runtime-owned, not caller-owned.
    started_at_ms: int = field(default=0, init=False)

    # ── Progress ────────────────────────────────────────────────────────────

    def stage(self, stage: JobStage, message: str | None = None) -> int:
        """Report a stage transition and return the percentage emitted.

        Percentages are clamped to be non-decreasing, and repeated calls for the
        same stage are collapsed — a processor that emits ``PARSING`` twice does
        not spam the UI with duplicate entries.

        If the envelope's filename carries the ``__slow__`` marker, this sleeps
        for ``WORKER_SLOW_STAGE_SECONDS`` *after* emitting, so an observer sees
        each stage actually hold for a moment.
        """
        percent = max(STAGE_PERCENT[stage], self._last_percent)
        if stage == self._last_stage and percent == self._last_percent:
            return percent
        self._last_percent = percent
        self._last_stage = stage
        self.progress(stage, percent, message if message is not None else STAGE_MESSAGES[stage])
        self._maybe_slow_down()
        return percent

    def _maybe_slow_down(self) -> None:
        if has_slow_marker(self.envelope.document.filename) and self.settings.slow_stage_seconds > 0:
            time.sleep(self.settings.slow_stage_seconds)

    # ── Failure markers ─────────────────────────────────────────────────────

    @property
    def marked_corrupt(self) -> bool:
        """Whether the filename carries the ``__fail__`` marker."""
        return has_fail_marker(self.envelope.document.filename)

    def assert_not_marked_corrupt(self, stage: JobStage = "PARSING") -> None:
        """Raise the simulated corruption failure when the marker is present.

        Called by each processor once it has reached the stage where a real
        engine would have finished decoding the container — early enough that the
        UI sees the failure *during* processing, which is the point of the demo.
        """
        if not self.marked_corrupt:
            return
        raise ProcessorFailure.of(
            "CORRUPT_DOCUMENT",
            "The document could not be read: its file structure is damaged. "
            "Re-uploading the original file is likely to fix this.",
            retryable=False,
            detail=(
                f"Simulated failure: the filename {self.envelope.document.filename!r} "
                f"contains the {FAIL_MARKER} marker; raised at stage {stage}."
            ),
        )

    # ── Storage ─────────────────────────────────────────────────────────────

    @property
    def artifact_prefix(self) -> str:
        """Key prefix for every artifact this job writes.

        Namespaced by ``artifacts/<documentId>/<operation>``. Document-scoped
        rather than job-scoped so that re-running a job overwrites its artifacts
        in place — which is what makes redelivery idempotent — while the
        operation segment keeps a parse's output from colliding with an
        extraction's on the same document.
        """
        operation = self.envelope.operation.lower()
        return f"artifacts/{self.envelope.document_id}/{operation}"

    def read_raw(self) -> bytes | None:
        """Fetch the uploaded document's bytes.

        Returns ``None`` only under the mock engine, where the fixture is the
        source of truth and the bytes are never read. Under a real engine a
        missing or unreadable object is a hard ``STORAGE_ERROR``: the job is
        retryable, because the object may simply not have replicated yet.
        """
        key = self.envelope.document.storage_key
        try:
            return self.reader.read(key)
        except StorageError as exc:
            if self.settings.processor_engine == MOCK_ENGINE:
                logger.debug(
                    "storage.mock_read_skipped job_id=%s key=%s reason=%s",
                    self.envelope.job_id,
                    key,
                    exc,
                )
                return None
            raise ProcessorFailure.of(
                "STORAGE_ERROR",
                "The uploaded document could not be read from storage.",
                retryable=True,
                detail=f"{key}: {exc}",
            ) from exc

    # ── Time ────────────────────────────────────────────────────────────────

    def now(self) -> int:
        """Current epoch milliseconds from the injected clock."""
        return self.now_ms()

    def started_at_iso(self) -> str:
        """The processing start as an ISO-8601 UTC string."""
        return iso_timestamp(self.started_at_ms or self.now())

    def duration_ms_for(self, operation: Operation) -> int:
        """Processing duration to report.

        The mock reports a small fixed cost per operation so results stay
        deterministic and comparable across runs. A real engine returns whatever
        the wall clock says, because a real duration is diagnostic information
        worth having.
        """
        if self.settings.processor_engine == MOCK_ENGINE:
            return MOCK_DURATION_MS[operation]
        return max(1, self.now() - (self.started_at_ms or self.now()))


# ── Filename markers ────────────────────────────────────────────────────────


def has_fail_marker(filename: str) -> bool:
    """Whether ``filename`` asks the worker to simulate a corrupt document."""
    return FAIL_MARKER in filename


def has_slow_marker(filename: str) -> bool:
    """Whether ``filename`` asks the worker to hold each stage briefly."""
    return SLOW_MARKER in filename


# ── The ABC ─────────────────────────────────────────────────────────────────


class DocumentProcessor(ABC):
    """Base class for every processing operation.

    A subclass supplies exactly two things:

    * :attr:`operation` — which of ``PARSE`` / ``EXTRACT`` / ``SPLIT`` it serves,
      used by the registry and echoed in logs;
    * :meth:`process` — the work itself, returning a
      :class:`~shade_worker.models.ProcessingOutput`.

    Everything else is provided: progress reporting, storage, failure typing, and
    the completion callback are the runtime's job. Implementations must be
    **idempotent** (see the ``queue`` module docstring) and should be
    **deterministic** given the same envelope — that is what makes a redelivery
    safe and an artifact diff meaningful.
    """

    @property
    @abstractmethod
    def operation(self) -> Operation:
        """The operation this processor serves."""

    @abstractmethod
    def process(self, ctx: ProcessingContext) -> ProcessingOutput:
        """Run the operation and return its artifacts, metrics and metadata.

        Implementations report progress with :meth:`ProcessingContext.stage`,
        which is the only way the user learns anything is happening, and raise
        :class:`ProcessorFailure` for any condition the user should see as a typed
        job error. Any other exception is caught by the runtime and reported as
        ``PROCESSOR_ERROR``.
        """

    # ── Helpers shared by the mock processors ───────────────────────────────

    def metadata(self, ctx: ProcessingContext) -> ProcessorMetadata:
        """Build the ``metadata`` block for this operation's result."""
        identity = resolve_engine_identity(ctx.settings)
        started_at_ms = ctx.started_at_ms or ctx.now()
        return build_metadata(
            engine=identity.engine,
            version=identity.version,
            started_at_ms=started_at_ms,
            duration_ms=ctx.duration_ms_for(self.operation),
            mocked=identity.mocked,
        )

    def __repr__(self) -> str:
        return f"<{type(self).__name__} operation={self.operation}>"
