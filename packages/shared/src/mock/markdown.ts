import type { StructuredDocument } from '../types.js';

/**
 * Markdown generation.
 *
 * This is the product's primary output, so it is generated from the *structured
 * representation* rather than by concatenating raw chunk text. That is the
 * whole point of the pipeline: semantic constructs in (headings, paragraphs,
 * lists, tables, captions, assets), clean Markdown out — no layout noise, no
 * duplicated text, no PDF internals.
 *
 * Page boundaries are preserved as HTML comments. They are invisible when the
 * Markdown is rendered but give an agent a way to cite "page 2" and to map a
 * passage back to the source document.
 */

export interface MarkdownRenderInput {
  document: StructuredDocument;
  /** filename → asset path as it should appear inside the Markdown. */
  assetPaths: Record<string, string>;
  /** Section id → caption text for figure captions. */
  assetCaptions?: Record<string, string>;
}

export function renderMarkdown(input: MarkdownRenderInput): string {
  const { document, assetPaths, assetCaptions = {} } = input;
  const lines: string[] = [];
  const emittedAssetNames = new Set<string>();

  if (document.title) {
    lines.push(`# ${document.title}`, '');
  }

  const tableById = new Map(document.tables.map((t) => [t.id, t]));
  const tablesEmitted = new Set<string>();

  let currentPage = 0;

  for (const section of document.sections) {
    if (section.page_number !== currentPage) {
      currentPage = section.page_number;
      lines.push(`<!-- page: ${currentPage} -->`, '');
    }

    lines.push(`${'#'.repeat(Math.min(section.level + 1, 6))} ${section.heading}`, '');

    for (const paragraph of section.paragraphs) {
      lines.push(paragraph, '');
    }

    for (const list of section.lists) {
      for (const item of list) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }

    // Assets are emitted where the section references them, followed by their
    // caption, so a reader (human or agent) gets figure-then-description.
    for (const assetName of section.asset_refs) {
      const path = assetPaths[assetName] ?? assetName;
      const caption = assetCaptions[assetName];
      lines.push(`![${caption ?? assetName}](${path})`, '');
      if (caption) {
        lines.push(`*${caption}*`, '');
      }
      emittedAssetNames.add(assetName);
    }

    for (const tableId of section.table_refs) {
      const table = tableById.get(tableId);
      if (!table || tablesEmitted.has(tableId)) continue;
      tablesEmitted.add(tableId);
      if (table.caption) {
        lines.push(`*${table.caption}*`, '');
      }
      lines.push(...renderTable(table.headers, table.rows, table.align), '');
    }
  }

  // Safety net: any table or asset the section tree forgot still makes it into
  // the output. Losing content silently would be worse than a slightly
  // out-of-place block.
  for (const table of document.tables) {
    if (tablesEmitted.has(table.id)) continue;
    if (table.caption) lines.push(`*${table.caption}*`, '');
    lines.push(...renderTable(table.headers, table.rows, table.align), '');
  }
  for (const assetName of document.assets) {
    if (emittedAssetNames.has(assetName)) continue;
    const path = assetPaths[assetName] ?? assetName;
    const caption = assetCaptions[assetName];
    lines.push(`![${caption ?? assetName}](${path})`, '');
    if (caption) lines.push(`*${caption}*`, '');
  }

  return `${normalizeBlankLines(lines).join('\n')}\n`;
}

function renderTable(
  headers: string[],
  rows: string[][],
  align: Array<'left' | 'right'>,
): string[] {
  const escape = (cell: string) => cell.replace(/\|/g, '\\|').trim();
  const out: string[] = [];

  out.push(`| ${headers.map(escape).join(' | ')} |`);
  out.push(`| ${headers.map((_, i) => (align[i] === 'right' ? '---:' : '---')).join(' | ')} |`);
  for (const row of rows) {
    // Pad short rows so a malformed source table cannot produce invalid GFM.
    const cells = headers.map((_, i) => escape(row[i] ?? ''));
    out.push(`| ${cells.join(' | ')} |`);
  }
  return out;
}

/** Collapses runs of blank lines and trims a trailing empty line. */
function normalizeBlankLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line === '' && out[out.length - 1] === '') continue;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

/**
 * Rough byte count used for the job metrics recorded on completion. Matching
 * the storage layer's `utf8` encoding here keeps the reported `markdownBytes`
 * consistent with what a download will actually weigh.
 */
export function markdownByteLength(markdown: string): number {
  return new TextEncoder().encode(markdown).length;
}
