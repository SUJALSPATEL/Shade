"""Parse processor — the full document-understanding pipeline, mocked.

The real pipeline (fetch → decode → layout → text → tables → images → structure
→ markdown → json → persist) is walked stage by stage with genuine progress
reporting, so the UI, the queue and the storage layer are all exercised exactly
as they will be with a real engine. What is mocked is only the *content*: the
regions, the text, the figure and the structure all come from
``shade_worker.fixtures``, which is a port of the shared TS fixture.

Swapping in a real engine means replacing the bodies between ``FETCHING`` and
``STRUCTURE``. The ``MARKDOWN``, ``JSON`` and ``PERSISTING`` stages are already
engine-independent — ``markdown.render_markdown`` consumes the structure, not the
raw chunks — so a real engine inherits correct Markdown for free as long as it
produces a ``StructuredDocument``.

``input.extractImages`` and ``input.keepFurniture`` are accepted and echoed in the
input validation, but the mock ignores them: the shared TS engine always emits
the same fixture regardless, and diverging here would break the "same document
either plane" guarantee. A real engine reads both.
"""

from __future__ import annotations

from ..fixtures import (
    ASSET_DIR,
    DOCUMENT_AUTHOR,
    DOCUMENT_SUMMARY,
    DOCUMENT_TITLE,
    FIGURE_ASSET_NAME,
    FIGURE_CAPTION,
    PAGE_GEOMETRY,
    build_chunks,
    build_figure_svg,
    build_structured_document,
)
from ..markdown import markdown_byte_length, render_markdown
from ..models import (
    MIME_JSON,
    MIME_MARKDOWN,
    MIME_SVG,
    ArtifactReport,
    AssetDescriptor,
    DocumentChunk,
    JobDocumentSummary,
    JobMetrics,
    Operation,
    ParseJobInput,
    ParseResult,
    ProcessingOutput,
    to_wire_json,
)
from ..storage import WrittenObject
from .base import DocumentProcessor, ProcessingContext, ProcessorFailure, build_document_descriptor

__all__ = ["ParseProcessor"]

#: Mime type of the figure the mock emits.
_SVG_MIME = MIME_SVG


class ParseProcessor(DocumentProcessor):
    """Convert a document into clean Markdown and structured JSON."""

    @property
    def operation(self) -> Operation:
        return "PARSE"

    def process(self, ctx: ProcessingContext) -> ProcessingOutput:
        document = ctx.envelope.document
        options = ctx.envelope.input
        if not isinstance(options, ParseJobInput):
            # The envelope validated as a job; reaching here means the API paired
            # a PARSE operation with a non-parse input, which is a contract bug
            # rather than a document problem.
            raise ProcessorFailure.of(
                "INTERNAL_ERROR",
                "This job is missing the parse options the processor requires.",
                retryable=False,
                detail=f"expected ParseJobInput, received {type(options).__name__}",
            )

        prefix = ctx.artifact_prefix

        # ── FETCHING: the bytes. The mock never reads them, but the read is
        # attempted so the storage adapter and its authorisation are exercised
        # on every job rather than only in production.
        ctx.stage("ACCEPTED", f"Accepted parse job for {document.filename}.")
        raw = ctx.read_raw()
        ctx.stage(
            "FETCHING",
            f"Fetched {document.size_bytes:,} bytes of {document.mime_type}."
            if raw is None
            else f"Fetched {len(raw):,} bytes of {document.mime_type}.",
        )

        # ── PARSING: decode the container. This is where a real engine discovers
        # that a PDF is encrypted or damaged.
        ctx.assert_not_marked_corrupt("PARSING")
        ctx.stage("PARSING", "Decoded the PDF object graph and page tree.")

        # ── LAYOUT / TEXT / TABLES / IMAGES: the content-understanding stages.
        ctx.stage("LAYOUT", f"Segmented {len(PAGE_GEOMETRY)} pages into regions.")
        chunks: list[DocumentChunk] = build_chunks()
        ctx.stage("TEXT", f"Recovered text for {len(chunks)} regions.")
        structured = build_structured_document()
        ctx.stage(
            "TABLES",
            f"Recovered {len(structured.tables)} table with {len(structured.tables[0].rows)} rows.",
        )
        svg = build_figure_svg()
        ctx.stage("IMAGES", f"Extracted 1 figure asset ({FIGURE_ASSET_NAME}).")

        # ── STRUCTURE: regions into a section tree. Everything downstream
        # consumes this, which is why it is the last engine-specific stage.
        ctx.stage(
            "STRUCTURE",
            f"Assembled {len(structured.sections)} sections from the region tree.",
        )

        # ── MARKDOWN: the primary output, generated from the structure.
        markdown = render_markdown(
            structured,
            # Relative to document.md's own directory, so the image link still
            # resolves when the two artifacts are downloaded together.
            asset_paths={FIGURE_ASSET_NAME: f"{ASSET_DIR}/{FIGURE_ASSET_NAME}"},
            asset_captions={FIGURE_ASSET_NAME: FIGURE_CAPTION},
        )
        markdown_bytes = markdown_byte_length(markdown)
        ctx.stage("MARKDOWN", f"Rendered {markdown_bytes:,} bytes of Markdown.")

        # ── JSON: the machine-oriented view of the same structure.
        result = ParseResult(
            document=build_document_descriptor(
                ctx,
                page_count=len(PAGE_GEOMETRY),
                title=DOCUMENT_TITLE,
                author=DOCUMENT_AUTHOR,
            ),
            chunks=chunks,
            json_=structured,
            assets=[
                AssetDescriptor(
                    name=FIGURE_ASSET_NAME,
                    # Document-scoped so a redelivery overwrites the same object;
                    # the Markdown's relative link is the stable contract.
                    storage_key=f"{prefix}/{ASSET_DIR}/{FIGURE_ASSET_NAME}",
                    mime_type=_SVG_MIME,
                    page_number=3,
                    width=480,
                    height=210,
                    caption=FIGURE_CAPTION,
                )
            ],
            metadata=self.metadata(ctx),
        )
        ctx.stage("JSON", "Serialised the structured document tree.")

        # ── PERSISTING: write every artifact, then describe it.
        markdown_object = ctx.writer.write_text(
            f"{prefix}/document.md", markdown, MIME_MARKDOWN
        )
        json_object = ctx.writer.write_text(
            f"{prefix}/document.json", to_wire_json(result), MIME_JSON
        )
        asset_object = ctx.writer.write_text(
            f"{prefix}/{ASSET_DIR}/{FIGURE_ASSET_NAME}", svg, _SVG_MIME
        )
        asset_artifacts = [
            _artifact("ASSET", asset_object, label=FIGURE_ASSET_NAME)
        ]
        artifacts = [
            _artifact("MARKDOWN", markdown_object),
            _artifact("JSON", json_object),
            *asset_artifacts,
        ]
        ctx.stage(
            "PERSISTING", f"Wrote {len(artifacts)} artifacts under {prefix}/."
        )

        ctx.stage("DONE", "Parse complete.")

        return ProcessingOutput(
            artifacts=artifacts,
            document=JobDocumentSummary(
                page_count=len(PAGE_GEOMETRY),
                title=DOCUMENT_TITLE,
                author=DOCUMENT_AUTHOR,
                summary=DOCUMENT_SUMMARY,
            ),
            metrics=JobMetrics(
                chunk_count=len(chunks),
                asset_count=len(asset_artifacts),
                table_count=len(structured.tables),
                markdown_bytes=markdown_bytes,
                # Parse only: the API keeps these on the job row so a later
                # retrieval search needs no artifact fetch.
                chunks=chunks,
            ),
            metadata=result.metadata,
            result=result,
        )


def _artifact(
    artifact_type: str, written: WrittenObject, *, label: str | None = None
) -> ArtifactReport:
    """Turn a storage write into the report the API records.

    ``label`` is passed only for assets, so the non-asset reports omit the key
    entirely rather than sending ``label: null`` — matching the optional field in
    the shared ``ArtifactReport`` type.
    """
    kwargs: dict[str, object] = {
        "type": artifact_type,
        "storage_key": written.storage_key,
        "mime_type": written.mime_type,
        "size_bytes": written.size_bytes,
    }
    if label is not None:
        kwargs["label"] = label
    return ArtifactReport(**kwargs)  # type: ignore[arg-type]
