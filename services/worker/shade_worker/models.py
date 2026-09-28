"""Pydantic mirrors of the TypeScript domain types and job protocol.

This module is a 1:1 port of `packages/shared/src/types.ts`,
`packages/shared/src/constants.ts` and `packages/shared/src/job-protocol.ts`.
It is the only place in the worker that knows the wire shape, and it exists so a
schema change in the control plane surfaces as a validation error at the worker's
edge instead of as a mysterious `undefined` deep inside a processor.

Why two base classes
--------------------
The shared types are *not* consistently cased, and that is deliberate on the API
side:

* ``DocumentChunk``, ``SplitMatch`` and the ``Structured*`` tree are **snake_case**
  (``chunk_id``, ``page_number``, ``bounding_box``) because they are the payload
  contract consumed by the retrieval/storage layers.
* ``DocumentDescriptor``, ``AssetDescriptor``, ``ProcessorMetadata``, the job
  envelope and every callback payload are **camelCase** (``pageCount``,
  ``storageKey``, ``durationMs``, ``jobId``) because they cross the HTTP boundary.

So ``CamelModel`` applies a ``to_camel`` alias generator and ``SnakeModel`` does
not. Serialise with :func:`to_wire`, which always dumps by alias, so the JSON the
worker emits matches what the API's TypeScript types declare.

Serialisation policy
--------------------
``to_wire`` uses ``exclude_unset=True``. That is what makes the difference
between "the TS object had this key set to ``null``" and "the TS object omitted
the optional key entirely" survive the trip through Python:

* ``ExtractedValue(value=None)`` is always constructed with all four keys, so it
  serialises as ``{"value": null, "confidence": 0, "pageNumber": null,
  "sourceChunkIds": []}`` — exactly the shape ``runExtract`` produces for a field
  the document does not support.
* ``DocumentChunk`` omits ``heading_level`` / ``group_id`` unless the caller
  passed them, matching the conditional spreads in ``buildChunks``.

Every model is built with explicit keyword arguments below, never by re-validating
another model's dump, so ``fields_set`` always reflects intent.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Literal, Mapping, Sequence

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

# ── Constants (mirrors constants.ts) ────────────────────────────────────────

OPERATIONS: tuple[str, ...] = ("PARSE", "EXTRACT", "SPLIT")
Operation = Literal["PARSE", "EXTRACT", "SPLIT"]

OPERATION_LABELS: Mapping[str, str] = {
    "PARSE": "Parse",
    "EXTRACT": "Extract",
    "SPLIT": "Split",
}

JOB_STATUSES: tuple[str, ...] = (
    "QUEUED",
    "PROCESSING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
)
JobStatus = Literal["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]

TERMINAL_JOB_STATUSES: tuple[str, ...] = ("COMPLETED", "FAILED", "CANCELLED")

# Ordered: index into this tuple is the stable sort key for progress reporting.
JOB_STAGES: tuple[str, ...] = (
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
)
JobStage = Literal[
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

JOB_STAGE_LABELS: Mapping[str, str] = {
    "ACCEPTED": "Accepted",
    "FETCHING": "Fetching document",
    "PARSING": "Reading PDF",
    "LAYOUT": "Understanding layout",
    "TEXT": "Extracting text",
    "TABLES": "Extracting tables",
    "IMAGES": "Extracting images",
    "STRUCTURE": "Detecting structure",
    "MARKDOWN": "Generating Markdown",
    "JSON": "Generating JSON",
    "PERSISTING": "Saving artifacts",
    "DONE": "Done",
}

CHUNK_TYPES: tuple[str, ...] = (
    "heading",
    "paragraph",
    "list",
    "table",
    "figure",
    "caption",
    "formula",
    "header",
    "footer",
    "page_number",
)
ChunkType = Literal[
    "heading",
    "paragraph",
    "list",
    "table",
    "figure",
    "caption",
    "formula",
    "header",
    "footer",
    "page_number",
]

ARTIFACT_TYPES: tuple[str, ...] = ("MARKDOWN", "JSON", "ASSET")
ArtifactType = Literal["MARKDOWN", "JSON", "ASSET"]

SCHEMA_FIELD_TYPES: tuple[str, ...] = (
    "string",
    "number",
    "boolean",
    "date",
    "array<string>",
    "array<object>",
)
SchemaFieldType = Literal[
    "string",
    "number",
    "boolean",
    "date",
    "array<string>",
    "array<object>",
]

DOCUMENT_STATUSES: tuple[str, ...] = (
    "UPLOADING",
    "UPLOADED",
    "QUEUED",
    "PROCESSING",
    "READY",
    "FAILED",
)
DocumentStatus = Literal[
    "UPLOADING", "UPLOADED", "QUEUED", "PROCESSING", "READY", "FAILED"
]

JobErrorCode = Literal[
    "UNSUPPORTED_FORMAT",
    "FILE_TOO_LARGE",
    "CORRUPT_DOCUMENT",
    "ENCRYPTED_DOCUMENT",
    "NO_TEXT_LAYER",
    "PROCESSOR_TIMEOUT",
    "PROCESSOR_ERROR",
    "STORAGE_ERROR",
    "INTERNAL_ERROR",
]

JOB_PROTOCOL_VERSION = 1
DEFAULT_SPLIT_LIMIT = 8

MIME_MARKDOWN = "text/markdown"
MIME_JSON = "application/json"
MIME_SVG = "image/svg+xml"


# ── Base models ─────────────────────────────────────────────────────────────


class CamelModel(BaseModel):
    """Base for payloads whose wire keys are camelCase (the HTTP boundary)."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
    )


class SnakeModel(BaseModel):
    """Base for payloads whose wire keys are snake_case (chunks, structure)."""

    model_config = ConfigDict(
        populate_by_name=True,
        extra="ignore",
    )


def to_wire(model: BaseModel) -> dict[str, Any]:
    """Serialise a model to its JSON-ready, camelCase-aliased wire form.

    ``exclude_unset`` keeps "explicitly null" and "absent" distinct, which the
    shared types depend on (see the module docstring). ``mode="json"`` makes the
    result safe to hand straight to :func:`json.dumps`.
    """
    return model.model_dump(by_alias=True, exclude_unset=True, mode="json")


def to_wire_json(model: BaseModel) -> str:
    """Same as :func:`to_wire` but already encoded, for direct storage writes."""
    return model.model_dump_json(by_alias=True, exclude_unset=True)


# ── Geometry and chunks (snake_case) ────────────────────────────────────────


class BoundingBox(BaseModel):
    """PDF points relative to the page origin (top-left), per the shared type.

    Coordinates are ``int | float`` rather than plain ``float`` so a value the
    fixture declares as ``64`` serialises as ``64``, not ``64.0``. TypeScript has
    a single ``number``; preserving the literal form keeps worker output
    byte-comparable with the API's own mock engine.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    x: int | float
    y: int | float
    width: int | float
    height: int | float


class DocumentChunk(SnakeModel):
    """A detected region of a page.

    Snake_case on purpose: this is the payload the retrieval layer and the
    preview overlay consume, and it is mirrored by
    ``packages/shared/src/types.ts#DocumentChunk``.
    """

    chunk_id: str
    text: str
    page_number: int
    bounding_box: BoundingBox
    type: ChunkType
    confidence: float
    group_id: str | None = None
    heading_level: int | None = None


# ── Structured document (snake_case) ────────────────────────────────────────


class StructuredTable(SnakeModel):
    id: str
    page_number: int
    caption: str | None = None
    headers: list[str]
    rows: list[list[str]]
    #: Per-column alignment, right-aligning numeric columns in Markdown.
    align: list[Literal["left", "right"]]


class StructuredSection(SnakeModel):
    id: str
    level: int
    heading: str
    page_number: int
    paragraphs: list[str]
    lists: list[list[str]]
    table_refs: list[str]
    asset_refs: list[str]


class StructuredDocument(SnakeModel):
    """Secondary representation: the document as a typed node tree."""

    title: str | None = None
    page_count: int
    sections: list[StructuredSection]
    tables: list[StructuredTable]
    assets: list[str]


# ── Descriptors and metadata (camelCase) ────────────────────────────────────


class DocumentDescriptor(CamelModel):
    id: str
    filename: str
    mime_type: str
    size_bytes: int
    page_count: int
    title: str | None = None
    author: str | None = None
    created_at: str


class AssetDescriptor(CamelModel):
    """Metadata for a figure asset referenced from the generated Markdown."""

    name: str
    storage_key: str
    mime_type: str
    page_number: int
    width: int
    height: int
    caption: str | None = None


class ProcessorMetadata(CamelModel):
    engine: str
    version: str
    duration_ms: int
    processed_at: str
    #: True while the output comes from the deterministic mock rather than a
    #: real engine — the API surfaces this so nobody mistakes fixtures for truth.
    mocked: bool


# ── Parse result ────────────────────────────────────────────────────────────


class ParseResult(CamelModel):
    """Canonical output of a Parse job.

    ``markdown`` is intentionally absent: it is the primary representation and
    lives in its own storage artifact so the two views can be cached and
    versioned independently (mirrors the note in ``types.ts``).
    """

    document: DocumentDescriptor
    chunks: list[DocumentChunk]
    #: Python attribute is ``json_`` because ``json`` shadows a deprecated
    #: ``BaseModel`` method; the explicit alias keeps the wire key as ``json``.
    json_: StructuredDocument = Field(alias="json")
    assets: list[AssetDescriptor]
    metadata: ProcessorMetadata


# ── Extract ─────────────────────────────────────────────────────────────────


class SchemaField(CamelModel):
    """One field of an extraction schema. ``type`` shadows a builtin, as in TS."""

    name: str
    type: SchemaFieldType
    description: str | None = None
    required: bool | None = None
    #: Nested fields — only meaningful for ``array<object>``.
    fields: list["SchemaField"] | None = None


class ResolvedExtractionSchema(CamelModel):
    """Mirrors ``ResolvedExtractionSchema`` in job-protocol.ts."""

    name: str
    fields: list[SchemaField]


class ExtractedValue(CamelModel):
    #: ``Any`` because a value is whatever the schema asked for: string, number,
    #: boolean, date, or a list of objects.
    value: Any = None
    confidence: float
    page_number: int | None = None
    source_chunk_ids: list[str]


class ExtractResult(CamelModel):
    document: DocumentDescriptor
    #: ``schema_`` in Python (``schema`` shadows a deprecated ``BaseModel``
    #: method); aliased back to ``schema`` on the wire.
    schema_: ResolvedExtractionSchema = Field(alias="schema")
    extraction: dict[str, ExtractedValue]
    #: 0–1, averaged across required fields.
    overall_confidence: float
    metadata: ProcessorMetadata


# ── Split ───────────────────────────────────────────────────────────────────


class SplitMatch(SnakeModel):
    """A retrieved passage. Snake_case, matching ``SplitMatch`` in types.ts."""

    chunk_id: str
    page_number: int
    text: str
    score: float
    bounding_box: BoundingBox
    type: ChunkType
    #: Short explanation rendered in the UI next to the match.
    rationale: str


class SplitResult(CamelModel):
    document: DocumentDescriptor
    query: str
    matches: list[SplitMatch]
    metadata: ProcessorMetadata


# ── Job envelope and operation inputs (camelCase) ───────────────────────────


class ParseJobInput(CamelModel):
    extract_images: bool
    keep_furniture: bool


class ExtractJobInput(CamelModel):
    schema_name: str
    fields: list[SchemaField]


class SplitJobInput(CamelModel):
    query: str
    limit: int = DEFAULT_SPLIT_LIMIT


DEFAULT_PARSE_INPUT = ParseJobInput(extract_images=True, keep_furniture=False)


class EnvelopeDocument(CamelModel):
    """The raw upload's metadata. The bytes never travel through the queue."""

    filename: str
    mime_type: str
    size_bytes: int
    #: Key of the raw upload inside the shared object store.
    storage_key: str


class CallbackTarget(CamelModel):
    base_url: str
    #: Presented as ``X-Worker-Token`` on every internal callback.
    token: str


class JobEnvelope(CamelModel):
    """What the API pushes onto the queue.

    The union on ``input`` is resolved by pydantic's smart mode: the three input
    shapes have disjoint required keys, so an operation-specific payload is
    matched unambiguously and a malformed one fails validation — which is what
    lets the runtime dead-letter instead of guessing.
    """

    protocol_version: int = JOB_PROTOCOL_VERSION
    job_id: str
    document_id: str
    operation: Operation
    input: ParseJobInput | ExtractJobInput | SplitJobInput
    document: EnvelopeDocument
    callback: CallbackTarget
    #: Attempt counter, incremented by the API on redelivery. 1-based.
    attempt: int = 1
    enqueued_at: str


# ── Worker → API callbacks (camelCase) ──────────────────────────────────────


class JobProgressRequest(CamelModel):
    progress: int
    stage: JobStage
    #: Optional human-readable note surfaced in the UI's processing log.
    message: str | None = None


class ArtifactReport(CamelModel):
    """Where an artifact landed. The API records metadata, never the bytes."""

    type: ArtifactType
    storage_key: str
    mime_type: str
    size_bytes: int
    label: str | None = None


class JobError(CamelModel):
    code: JobErrorCode
    message: str
    #: Whether re-running the job has a reasonable chance of succeeding.
    retryable: bool
    detail: str | None = None


class JobDocumentSummary(CamelModel):
    """Document-level fields the processor discovered."""

    page_count: int
    title: str | None = None
    author: str | None = None
    summary: str | None = None


class JobMetrics(CamelModel):
    """Summary figures recorded on the job row so list views need no artifact.

    Note what is absent: there is no ``chunks`` field. Chunk text is document
    content, and document content belongs in the JSON artifact in object
    storage — not in a relational row and not on the completion callback. The
    counts below are the whole of what the job row needs to render a badge.
    """

    chunk_count: int
    asset_count: int
    table_count: int
    markdown_bytes: int


class JobMetadata(CamelModel):
    engine: str
    version: str
    duration_ms: int
    mocked: bool


class JobCompleteRequest(CamelModel):
    artifacts: list[ArtifactReport]
    document: JobDocumentSummary
    metrics: JobMetrics
    metadata: JobMetadata


class JobFailRequest(CamelModel):
    error: JobError


# ── Processor-facing shapes ─────────────────────────────────────────────────

#: Signature of the progress callback handed to processors.
ProgressCallback = Callable[[JobStage, int, "str | None"], None]

#: Either processor output — the runtime narrows via ``isinstance``.
ProcessorOutput = ParseResult | ExtractResult | SplitResult


@dataclass(frozen=True, slots=True)
class ProcessingOutput:
    """What a processor hands back to the runtime.

    A processor never talks to Redis or HTTP. It returns this, and the runtime
    turns it into a ``JobCompleteRequest`` — which is what keeps the callback
    transport swappable without touching processor code.
    """

    artifacts: list[ArtifactReport]
    document: JobDocumentSummary
    metrics: JobMetrics
    metadata: ProcessorMetadata
    #: Full result, used by the runtime for structured logging and, later, for
    #: an audit trail. Not sent over the callback API.
    result: ProcessorOutput | None = None


__all__ = [name for name in dir() if not name.startswith("_")]
