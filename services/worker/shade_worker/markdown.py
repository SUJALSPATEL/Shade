"""Markdown generation — a port of ``packages/shared/src/mock/markdown.ts``.

This is the product's primary output, so it is generated from the *structured
representation* rather than by concatenating raw chunk text. That is the whole
point of the pipeline: semantic constructs in (headings, paragraphs, lists,
tables, captions, assets), clean Markdown out — no layout noise, no duplicated
text, no PDF internals.

Page boundaries are preserved as HTML comments. They are invisible when the
Markdown is rendered but give an agent a way to cite "page 2" and to map a
passage back to the source document.

The renderer is deliberately free of I/O: it takes the structured document and a
filename → path map, and returns a string. A real engine that produces a
different *structure* still gets identical Markdown behaviour for free.
"""

from __future__ import annotations

from typing import Mapping, Sequence

from .models import StructuredDocument, StructuredTable

__all__ = ["markdown_byte_length", "render_markdown"]


def render_markdown(
    document: StructuredDocument,
    asset_paths: Mapping[str, str] | None = None,
    asset_captions: Mapping[str, str] | None = None,
) -> str:
    """Render ``document`` to GitHub-Flavoured Markdown.

    ``asset_paths`` maps an asset *filename* (as referenced by the structured
    document) to the path that should appear inside the Markdown. The worker
    passes a path relative to the Markdown artifact's own directory, so the link
    resolves wherever the pair is downloaded together. ``asset_captions`` maps
    the same filename to its caption text, emitted as an italic line under the
    image.
    """
    paths = asset_paths or {}
    captions = asset_captions or {}

    lines: list[str] = []
    emitted_asset_names: set[str] = set()

    if document.title:
        lines.append(f"# {document.title}")
        lines.append("")

    table_by_id: dict[str, StructuredTable] = {t.id: t for t in document.tables}
    tables_emitted: set[str] = set()

    current_page = 0

    for section in document.sections:
        if section.page_number != current_page:
            current_page = section.page_number
            lines.append(f"<!-- page: {current_page} -->")
            lines.append("")

        lines.append(f"{'#' * min(section.level + 1, 6)} {section.heading}")
        lines.append("")

        for paragraph in section.paragraphs:
            lines.append(paragraph)
            lines.append("")

        for items in section.lists:
            for item in items:
                lines.append(f"- {item}")
            lines.append("")

        # Assets are emitted where the section references them, followed by their
        # caption, so a reader (human or agent) gets figure-then-description.
        for asset_name in section.asset_refs:
            path = paths.get(asset_name, asset_name)
            caption = captions.get(asset_name)
            lines.append(f"![{caption if caption is not None else asset_name}]({path})")
            lines.append("")
            if caption:
                lines.append(f"*{caption}*")
                lines.append("")
            emitted_asset_names.add(asset_name)

        for table_id in section.table_refs:
            table = table_by_id.get(table_id)
            if table is None or table_id in tables_emitted:
                continue
            tables_emitted.add(table_id)
            if table.caption:
                lines.append(f"*{table.caption}*")
                lines.append("")
            lines.extend(render_table(table.headers, table.rows, table.align))
            lines.append("")

    # Safety net: any table or asset the section tree forgot still makes it into
    # the output. Losing content silently would be worse than a slightly
    # out-of-place block.
    for table in document.tables:
        if table.id in tables_emitted:
            continue
        if table.caption:
            lines.append(f"*{table.caption}*")
            lines.append("")
        lines.extend(render_table(table.headers, table.rows, table.align))
        lines.append("")

    for asset_name in document.assets:
        if asset_name in emitted_asset_names:
            continue
        path = paths.get(asset_name, asset_name)
        caption = captions.get(asset_name)
        lines.append(f"![{caption if caption is not None else asset_name}]({path})")
        lines.append("")
        if caption:
            lines.append(f"*{caption}*")
            lines.append("")

    return "\n".join(normalize_blank_lines(lines)) + "\n"


def render_table(
    headers: Sequence[str],
    rows: Sequence[Sequence[str]],
    align: Sequence[str],
) -> list[str]:
    """Render a GFM table, right-aligning columns flagged ``right``."""

    def escape(cell: str) -> str:
        return cell.replace("|", "\\|").strip()

    def marker(index: int) -> str:
        # A short ``align`` array leaves later columns left-aligned, matching the
        # TS renderer's `undefined` handling.
        return "---:" if index < len(align) and align[index] == "right" else "---"

    out: list[str] = []
    out.append(f"| {' | '.join(escape(h) for h in headers)} |")
    out.append(f"| {' | '.join(marker(i) for i in range(len(headers)))} |")
    for row in rows:
        # Pad short rows so a malformed source table cannot produce invalid GFM.
        cells = [escape(row[i]) if i < len(row) else "" for i in range(len(headers))]
        out.append(f"| {' | '.join(cells)} |")
    return out


def normalize_blank_lines(lines: Sequence[str]) -> list[str]:
    """Collapses runs of blank lines and trims trailing empty lines."""
    out: list[str] = []
    for line in lines:
        if line == "" and out and out[-1] == "":
            continue
        out.append(line)
    while out and out[-1] == "":
        out.pop()
    return out


def markdown_byte_length(markdown: str) -> int:
    """UTF-8 byte count, used for the ``markdownBytes`` job metric.

    Matching the storage layer's ``utf8`` encoding here keeps the reported figure
    consistent with what a download will actually weigh. ``len(str)`` would be
    wrong for any document containing a character outside the BMP's ASCII range —
    the fixture alone contains ``·`` and ``—``.
    """
    return len(markdown.encode("utf-8"))
