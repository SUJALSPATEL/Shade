import { Fragment } from 'react';
import { cn } from '@/lib/cn';

/**
 * A small Markdown renderer for the subset the pipeline emits.
 *
 * **Why not a library.** `react-markdown` plus `remark-gfm` is roughly 200 KB
 * of parser to render a document whose grammar is fixed and known: headings,
 * paragraphs, `- ` lists, GFM tables, images, italic captions, and page
 * markers. That is a real dependency with a real bundle cost, for a subset this
 * file covers in one pass.
 *
 * **What that buys, beyond size.** The output is React elements, never
 * `dangerouslySetInnerHTML`. The Markdown comes from a user's own PDF, so
 * treating it as HTML would make every uploaded document a script-injection
 * vector; building nodes means there is no path from document content to
 * executable markup at all. Link and image URLs are additionally scheme-checked,
 * because `[click](javascript:...)` is a live vector even in a React tree.
 *
 * **What it does not do.** No nesting inside list items, no reference links, no
 * footnotes, no inline HTML beyond the page marker. Anything unrecognised
 * degrades to a paragraph of literal text — never to nothing. The raw source is
 * always one click away in the workspace, so the exact bytes remain the ground
 * truth and this view is never the only copy.
 */

/* ── Block parsing ───────────────────────────────────────────────────────── */

type Align = 'left' | 'right';

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; headers: string[]; align: Align[]; rows: string[][] }
  | { kind: 'image'; alt: string; src: string }
  | { kind: 'page'; page: number }
  | { kind: 'code'; text: string }
  | { kind: 'hr' };

const IMAGE_LINE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const PAGE_MARKER = /^<!--\s*page:\s*(\d+)\s*-->$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^```/;
const HR = /^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/;

/** Indexed by `level - 1`; `h6` is the deepest heading the grammar allows. */
const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  // `lineAt` exists because the project compiles with `noUncheckedIndexedAccess`
  // — every `lines[i]` is `string | undefined`, and threading `?? ''` through
  // two dozen call sites obscures the parser. Out-of-range reads here are
  // always at the end of the document, where an empty line is exactly right.
  const lineAt = (at: number): string => lines[at] ?? '';

  while (index < lines.length) {
    const line = lineAt(index);
    const trimmed = line.trim();

    if (trimmed === '') {
      index += 1;
      continue;
    }

    const page = PAGE_MARKER.exec(trimmed);
    if (page) {
      blocks.push({ kind: 'page', page: Number(page[1] ?? 0) });
      index += 1;
      continue;
    }

    if (FENCE.test(trimmed)) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lineAt(index).trim())) {
        body.push(lineAt(index));
        index += 1;
      }
      index += 1; // consume the closing fence (or run off the end)
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        text: (heading[2] ?? '').trim(),
      });
      index += 1;
      continue;
    }

    if (HR.test(trimmed)) {
      blocks.push({ kind: 'hr' });
      index += 1;
      continue;
    }

    const image = IMAGE_LINE.exec(trimmed);
    if (image) {
      blocks.push({ kind: 'image', alt: image[1] ?? '', src: image[2] ?? '' });
      index += 1;
      continue;
    }

    // A table needs its delimiter row on the very next line; a lone `| ... |`
    // is far more likely to be prose than a table.
    if (trimmed.startsWith('|') && isDelimiterRow(lineAt(index + 1))) {
      const headers = splitRow(trimmed);
      const align = parseAlignments(lineAt(index + 1));
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length && lineAt(index).trim().startsWith('|')) {
        rows.push(splitRow(lineAt(index).trim()));
        index += 1;
      }

      blocks.push({ kind: 'table', headers, align, rows });
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      const ordered = ORDERED.test(line);
      const pattern = ordered ? ORDERED : BULLET;
      const items: string[] = [];

      while (index < lines.length) {
        const match = pattern.exec(lineAt(index));
        if (!match) break;
        items.push((match[1] ?? '').trim());
        index += 1;
      }

      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (index < lines.length) {
      const raw = lineAt(index);
      const candidate = raw.trim();
      if (candidate === '') break;
      if (paragraph.length > 0 && startsBlock(candidate, raw)) break;
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

function startsBlock(trimmed: string, raw: string): boolean {
  return (
    PAGE_MARKER.test(trimmed) ||
    FENCE.test(trimmed) ||
    HEADING.test(trimmed) ||
    HR.test(trimmed) ||
    IMAGE_LINE.test(trimmed) ||
    BULLET.test(raw) ||
    ORDERED.test(raw) ||
    trimmed.startsWith('|')
  );
}

/** Strips the outer pipes and splits on unescaped ones, unescaping `\|`. */
function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';

  for (let i = 0; i < body.length; i += 1) {
    const char = body[i] ?? '';
    if (char === '\\' && body[i + 1] === '|') {
      current += '|';
      i += 1;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function isDelimiterRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') && !trimmed.includes('-')) return false;
  const cells = splitRow(trimmed);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

function parseAlignments(line: string): Align[] {
  return splitRow(line.trim()).map((cell) => (cell.endsWith(':') ? 'right' : 'left'));
}

/* ── Inline parsing ──────────────────────────────────────────────────────── */

/**
 * Underscores are deliberately not emphasis markers.
 *
 * `_` is everywhere in this product — `total_revenue`, `chunk_id`,
 * `page_number` — and a renderer that italicises from one underscore to the
 * next turns every snake_case identifier in a paragraph into mangled prose. The
 * generator only ever emits `*…*`, so nothing is lost by requiring it.
 */
const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));

    const token = match[0];
    const id = `${keyPrefix}-i${key}`;
    key += 1;

    if (token.startsWith('**')) {
      nodes.push(<strong key={id}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={id}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={id}>{token.slice(1, -1)}</code>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const href = link?.[2];
      if (link && href && isSafeUrl(href)) {
        nodes.push(
          <a key={id} href={href} target="_blank" rel="noreferrer noopener">
            {link[1]}
          </a>,
        );
      } else {
        // Not a safe link — render the source text rather than dropping it, so
        // a suspicious href is visible instead of silently disappearing.
        nodes.push(token);
      }
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/**
 * Only schemes that cannot execute.
 *
 * A relative path is allowed because the generator's asset references are
 * relative; `javascript:` and `data:` are not, because a link is the one place
 * document content can reach out and run something.
 */
function isSafeUrl(url: string): boolean {
  const lower = url.trim().toLowerCase();
  if (lower.startsWith('//')) return false;
  if (/^(https?:|mailto:|#|\/)/.test(lower)) return true;
  // Anything else — including `javascript:`, `data:` and `vbscript:` — is only
  // acceptable when it has no scheme at all.
  return !/^[a-z][a-z0-9+.-]*:/.test(lower);
}

/* ── The component ───────────────────────────────────────────────────────── */

export function MarkdownView({
  markdown,
  /** Maps a relative asset reference from the Markdown to a fetchable URL. */
  resolveAsset,
  className,
}: {
  markdown: string;
  resolveAsset?: (src: string) => string;
  className?: string;
}) {
  const blocks = parseMarkdown(markdown);

  return (
    <div className={cn('prose-document', className)}>
      {blocks.map((block, index) => (
        <Fragment key={index}>{renderBlock(block, index, resolveAsset)}</Fragment>
      ))}
    </div>
  );
}

function renderBlock(
  block: Block,
  index: number,
  resolveAsset?: (src: string) => string,
): React.ReactNode {
  const key = `b${index}`;

  switch (block.kind) {
    case 'heading': {
      // `level` is the count of leading `#`, which the block regex caps at six;
      // the fallback is only here because the compiler cannot see that.
      const Tag = HEADING_TAGS[block.level - 1] ?? 'h6';
      return <Tag>{renderInline(block.text, key)}</Tag>;
    }

    case 'paragraph':
      return <p>{renderInline(block.text, key)}</p>;

    case 'list': {
      const items = block.items.map((item, itemIndex) => (
        <li key={itemIndex}>{renderInline(item, `${key}-${itemIndex}`)}</li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }

    case 'table':
      return (
        <table>
          <thead>
            <tr>
              {block.headers.map((header, cellIndex) => (
                <th
                  key={cellIndex}
                  style={{ textAlign: block.align[cellIndex] ?? 'left' }}
                >
                  {renderInline(header, `${key}-h${cellIndex}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {/* Rows are padded to the header width: a short row would
                    otherwise produce a table that is ragged in a way the
                    generator's output never is, which reads as a parsing bug. */}
                {block.headers.map((_, cellIndex) => (
                  <td
                    key={cellIndex}
                    style={{ textAlign: block.align[cellIndex] ?? 'left' }}
                  >
                    {renderInline(row[cellIndex] ?? '', `${key}-r${rowIndex}c${cellIndex}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );

    case 'image': {
      const src = resolveAsset ? resolveAsset(block.src) : block.src;
      // A plain <img>: these are SVGs and PNGs produced by the processor, sized
      // by the stylesheet, and `next/image` would need a configured loader for
      // an endpoint that is behind the session cookie.
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={block.alt} loading="lazy" />
      );
    }

    case 'page':
      return <div className="page-marker">Page {block.page}</div>;

    case 'code':
      return (
        <pre>
          <code>{block.text}</code>
        </pre>
      );

    case 'hr':
      return <hr />;

    default:
      return null;
  }
}
