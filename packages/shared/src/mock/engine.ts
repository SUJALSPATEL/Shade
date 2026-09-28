import { SCHEMA_FIELD_TYPES } from '../constants.js';
import type {
  DocumentChunk,
  DocumentDescriptor,
  ExtractResult,
  ExtractionRecord,
  ExtractionSchema,
  ExtractedValue,
  ParseResult,
  ProcessorMetadata,
  SchemaField,
  SplitMatch,
  SplitResult,
} from '../types.js';
import {
  DOCUMENT_AUTHOR,
  DOCUMENT_SUMMARY,
  DOCUMENT_TITLE,
  FIGURE_ASSET_NAME,
  FIGURE_CAPTION,
  PAGE_GEOMETRY,
  PAGE_HEIGHT,
  buildChunks,
  buildFigureSvg,
  buildStructuredDocument,
} from './fixture-document.js';
import { markdownByteLength, renderMarkdown } from './markdown.js';

/**
 * The mocked processing engine.
 *
 * It implements the same contract a real engine will: given a document
 * descriptor, produce a `ParseResult` / `ExtractResult` / `SplitResult` plus
 * the Markdown and asset bytes that belong in object storage. Nothing here
 * touches I/O, so the same functions run inside the API process (the `inline`
 * dev dispatcher) and inside the Python worker's mirrored implementation.
 *
 * Output is fully deterministic — same input, same bytes — which is what makes
 * it safe to cache, diff and assert on in tests.
 */

const ENGINE = 'mock-structural';
const VERSION = '0.1.0';

function metadata(startedAtMs: number, nowMs: number): ProcessorMetadata {
  return {
    engine: ENGINE,
    version: VERSION,
    durationMs: Math.max(1, nowMs - startedAtMs),
    processedAt: new Date(nowMs).toISOString(),
    mocked: true,
  };
}

export interface MarkdownArtifact {
  content: string;
  bytes: number;
}

export interface AssetArtifact {
  name: string;
  mimeType: string;
  content: string;
  bytes: number;
  caption: string | null;
  pageNumber: number;
  width: number;
  height: number;
}

export interface ParseOutput {
  result: ParseResult;
  markdown: MarkdownArtifact;
  assets: AssetArtifact[];
}

/* ── Parse ───────────────────────────────────────────────────────────────── */

export function runParse(
  document: DocumentDescriptor,
  options: { nowMs?: number; startedAtMs?: number } = {},
): ParseOutput {
  const startedAtMs = options.startedAtMs ?? Date.now();
  // A small, fixed cost keeps durations plausible without making tests slow.
  const nowMs = options.nowMs ?? startedAtMs + 1_840;

  const structured = buildStructuredDocument();
  const chunks = buildChunks();
  const svg = buildFigureSvg();

  const assetPaths: Record<string, string> = {
    [FIGURE_ASSET_NAME]: `assets/${FIGURE_ASSET_NAME}`,
  };
  const markdown = renderMarkdown({
    document: structured,
    assetPaths,
    assetCaptions: { [FIGURE_ASSET_NAME]: FIGURE_CAPTION },
  });

  const assets: AssetArtifact[] = [
    {
      name: FIGURE_ASSET_NAME,
      mimeType: 'image/svg+xml',
      content: svg,
      bytes: markdownByteLength(svg),
      caption: FIGURE_CAPTION,
      pageNumber: 3,
      width: 480,
      height: 210,
    },
  ];

  const result: ParseResult = {
    document: { ...document, pageCount: PAGE_GEOMETRY.length, title: DOCUMENT_TITLE, author: DOCUMENT_AUTHOR },
    chunks,
    json: structured,
    assets: assets.map((asset) => ({
      name: asset.name,
      // The concrete storage key is assigned by the caller, which owns the
      // document id; the processor only names the asset.
      storageKey: `assets/${asset.name}`,
      mimeType: asset.mimeType,
      pageNumber: asset.pageNumber,
      width: asset.width,
      height: asset.height,
      caption: asset.caption,
    })),
    metadata: metadata(startedAtMs, nowMs),
  };

  return {
    result,
    markdown: { content: markdown, bytes: markdownByteLength(markdown) },
    assets,
  };
}

/* ── Preset extraction schemas ───────────────────────────────────────────── */

export interface PresetSchema {
  id: string;
  name: string;
  description: string;
  fields: SchemaField[];
}

/**
 * Starter schemas surfaced in the Extract schema builder. They are the fastest
 * path to a meaningful extraction result for a first-time user, and they double
 * as documentation of the supported field vocabulary.
 */
export const PRESET_SCHEMAS: PresetSchema[] = [
  {
    id: 'financial_summary',
    name: 'Financial summary',
    description: 'Headline revenue figures and year-over-year movement.',
    fields: [
      { name: 'company_name', type: 'string', description: 'Reporting entity', required: true },
      { name: 'reporting_period', type: 'string', description: 'Fiscal period covered', required: true },
      { name: 'total_revenue', type: 'number', description: 'Consolidated revenue', required: true },
      { name: 'revenue_growth_pct', type: 'number', description: 'Year-over-year change', required: false },
      { name: 'operating_margin_pct', type: 'number', description: 'Operating margin', required: false },
      { name: 'regions', type: 'array<object>', description: 'Revenue broken out by region', required: false },
    ],
  },
  {
    id: 'education_history',
    name: 'Education history',
    description: 'Degrees and institutions, as used for candidate documents.',
    fields: [
      { name: 'institution_name', type: 'string', required: true },
      { name: 'degree_program', type: 'string', required: true },
      { name: 'location', type: 'string', required: false },
      { name: 'start_date', type: 'date', required: false },
      { name: 'end_date', type: 'date', required: false },
    ],
  },
  {
    id: 'contract_terms',
    name: 'Contract terms',
    description: 'Parties, term and termination provisions.',
    fields: [
      { name: 'party_a', type: 'string', required: true },
      { name: 'party_b', type: 'string', required: true },
      { name: 'effective_date', type: 'date', required: false },
      { name: 'notice_period_days', type: 'number', required: false },
      { name: 'termination_clauses', type: 'array<string>', required: false },
      { name: 'governing_law', type: 'string', required: false },
    ],
  },
];

export function buildSchemaFromPreset(preset: PresetSchema): ExtractionSchema {
  const now = new Date(0).toISOString();
  return {
    id: `sch_${preset.id}`,
    name: preset.name,
    description: preset.description,
    fields: preset.fields,
    createdAt: now,
    updatedAt: now,
  };
}

/* ── Extract ─────────────────────────────────────────────────────────────── */

/**
 * Canned values keyed by field name, drawn from the fixture document. A field
 * the caller invented simply comes back with `value: null` and a low
 * confidence — which is exactly how a real extractor behaves on a schema the
 * document does not support, and keeps the empty state honest.
 */
const KNOWN_FIELD_VALUES: Record<
  string,
  { value: unknown; page: number | null; chunks: string[]; confidence: number }
> = {
  company_name: { value: 'Northwind Analytics', page: 1, chunks: ['chunk_001'], confidence: 0.97 },
  reporting_period: { value: 'FY2025 (year ended 31 December 2025)', page: 1, chunks: ['chunk_002'], confidence: 0.94 },
  total_revenue: { value: 482.6, page: 2, chunks: ['chunk_011', 'chunk_012'], confidence: 0.96 },
  revenue_growth_pct: { value: 18.4, page: 2, chunks: ['chunk_011'], confidence: 0.93 },
  operating_margin_pct: { value: 22.1, page: 1, chunks: ['chunk_006'], confidence: 0.91 },
  regions: {
    value: [
      { region: 'India', revenue: 148.2, yoy_change: '+31.9%' },
      { region: 'United States', revenue: 176.9, yoy_change: '+14.8%' },
      { region: 'Europe', revenue: 94.3, yoy_change: '+14.0%' },
      { region: 'Asia-Pacific', revenue: 63.2, yoy_change: '+8.4%' },
    ],
    page: 2,
    chunks: ['chunk_012'],
    confidence: 0.92,
  },
  institution_name: { value: null, page: null, chunks: [], confidence: 0 },
  degree_program: { value: null, page: null, chunks: [], confidence: 0 },
  location: { value: null, page: null, chunks: [], confidence: 0 },
  start_date: { value: null, page: null, chunks: [], confidence: 0 },
  end_date: { value: null, page: null, chunks: [], confidence: 0 },
  party_a: { value: 'Northwind Analytics Ltd', page: 1, chunks: ['chunk_001'], confidence: 0.88 },
  party_b: { value: null, page: null, chunks: [], confidence: 0 },
  effective_date: { value: '2025-01-01', page: 1, chunks: ['chunk_002'], confidence: 0.79 },
  notice_period_days: { value: 90, page: 3, chunks: ['chunk_020'], confidence: 0.81 },
  termination_clauses: {
    value: [
      'Notice periods and termination provisions for senior staff are reviewed annually by the remuneration committee.',
    ],
    page: 3,
    chunks: ['chunk_020'],
    confidence: 0.84,
  },
  governing_law: { value: null, page: null, chunks: [], confidence: 0 },
  headcount: { value: 2480, page: 3, chunks: ['chunk_020'], confidence: 0.95 },
  benefits: {
    value: [
      'Comprehensive health and dental coverage for employees and dependants',
      'Employer pension contribution of up to 9 percent of base salary',
      'Annual leave entitlement of 25 days plus public holidays',
      'Hybrid working allowance and home office equipment budget',
    ],
    page: 3,
    chunks: ['chunk_021'],
    confidence: 0.9,
  },
};

export function runExtract(
  document: DocumentDescriptor,
  schema: { name: string; fields: SchemaField[] },
  options: { nowMs?: number; startedAtMs?: number } = {},
): ExtractResult {
  const startedAtMs = options.startedAtMs ?? Date.now();
  const nowMs = options.nowMs ?? startedAtMs + 2_610;

  const extraction: ExtractionRecord = {};
  for (const field of schema.fields) {
    const known = KNOWN_FIELD_VALUES[field.name];
    if (known) {
      const entry: ExtractedValue = {
        value: known.value,
        confidence: known.confidence,
        pageNumber: known.page,
        sourceChunkIds: known.chunks,
      };
      extraction[field.name] = entry;
    } else {
      // Unknown field: report it as not-found rather than inventing a value.
      extraction[field.name] = {
        value: null,
        confidence: 0,
        pageNumber: null,
        sourceChunkIds: [],
      };
    }
  }

  const required = schema.fields.filter((f) => f.required !== false);
  const scored = required.length > 0 ? required : schema.fields;
  const overallConfidence =
    scored.length === 0
      ? 0
      : scored.reduce((sum, field) => {
          const entry = extraction[field.name] as ExtractedValue | undefined;
          return sum + (entry?.confidence ?? 0);
        }, 0) / scored.length;

  return {
    document: { ...document, pageCount: PAGE_GEOMETRY.length, title: DOCUMENT_TITLE, author: DOCUMENT_AUTHOR },
    schema,
    extraction,
    overallConfidence: Number(overallConfidence.toFixed(4)),
    metadata: metadata(startedAtMs, nowMs),
  };
}

/* ── Split / retrieval ───────────────────────────────────────────────────── */

/**
 * A deliberately simple lexical retriever.
 *
 * It exists so the Split surface is genuinely driven by the query rather than
 * returning a fixed list, and so the `Retriever` seam is real. Replacing it
 * with embeddings + hybrid search + reranking is an implementation swap behind
 * `retrieve()`, not a UI change.
 */

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are',
  'was', 'were', 'be', 'with', 'that', 'this', 'it', 'as', 'at', 'by', 'from',
  'find', 'show', 'me', 'about', 'related', 'regarding', 'what', 'which', 'how',
]);

/** Domain synonyms so a natural-language query hits the right passage. */
const SYNONYMS: Record<string, string[]> = {
  benefits: ['benefits', 'pension', 'dental', 'health', 'leave', 'allowance', 'remuneration'],
  employee: ['employee', 'employees', 'staff', 'headcount', 'personnel', 'workforce'],
  termination: ['termination', 'notice', 'provisions', 'clauses'],
  revenue: ['revenue', 'income', 'sales', 'turnover'],
  risk: ['risk', 'uncertainty', 'macroeconomic'],
  growth: ['growth', 'increase', 'expansion', 'grew'],
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s%.-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function expand(tokens: string[]): Set<string> {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const [canonical, family] of Object.entries(SYNONYMS)) {
      if (token === canonical || family.includes(token)) {
        expanded.add(canonical);
        for (const member of family) expanded.add(member);
      }
    }
  }
  return expanded;
}

/** Chunk types that carry prose worth retrieving. */
const RETRIEVABLE_TYPES = new Set(['paragraph', 'list', 'table', 'caption', 'heading']);

export interface RetrieveOptions {
  limit?: number;
  /** Minimum score below which a chunk is considered noise. */
  minScore?: number;
}

export function retrieve(query: string, options: RetrieveOptions = {}): SplitMatch[] {
  return rankChunks(buildChunks(), query, options);
}

/**
 * Ranks a caller-supplied set of chunks.
 *
 * Separate from `retrieve` so the same scorer serves both the mock engine (over
 * its fixture chunks) and the API's interactive `/api/split` endpoint (over a
 * real document's Parse artifact). One scoring function, two sources of chunks —
 * which is what stops the interactive path from quietly answering from the
 * fixture while claiming to answer from the user's document.
 */
export function rankChunks(
  chunks: DocumentChunk[],
  query: string,
  options: RetrieveOptions = {},
): SplitMatch[] {
  const limit = options.limit ?? 8;
  const minScore = options.minScore ?? 0.12;
  const queryTokens = expand(tokenize(query));

  const matches: SplitMatch[] = [];

  for (const chunk of chunks) {
    if (!RETRIEVABLE_TYPES.has(chunk.type)) continue;

    const chunkTokens = tokenize(chunk.text);
    if (chunkTokens.length === 0) continue;

    const chunkSet = new Set(chunkTokens);
    let overlap = 0;
    for (const token of queryTokens) {
      if (chunkSet.has(token)) overlap += 1;
    }
    if (overlap === 0) continue;

    // Normalise by the query length so long queries do not out-rank short,
    // precise ones, then weight by the processor's own confidence.
    const coverage = overlap / Math.max(4, queryTokens.size);
    const score = Math.min(1, coverage * 1.6) * chunk.confidence;

    if (score < minScore) continue;

    matches.push({
      chunk_id: chunk.chunk_id,
      page_number: chunk.page_number,
      text: chunk.text,
      score: Number(score.toFixed(4)),
      bounding_box: chunk.bounding_box,
      type: chunk.type,
      rationale: buildRationale(chunk.type, overlap, queryTokens, chunkSet),
    });
  }

  return matches.sort((a, b) => b.score - a.score || a.chunk_id.localeCompare(b.chunk_id)).slice(0, limit);
}

function buildRationale(
  type: string,
  overlap: number,
  queryTokens: Set<string>,
  chunkSet: Set<string>,
): string {
  const shared = [...queryTokens].filter((token) => chunkSet.has(token)).slice(0, 4);
  const terms = shared.length > 0 ? shared.join(', ') : 'related terms';
  return `Matched ${overlap} term${overlap === 1 ? '' : 's'} (${terms}) in a ${type} region.`;
}

export function runSplit(
  document: DocumentDescriptor,
  query: string,
  options: { limit?: number; nowMs?: number; startedAtMs?: number } = {},
): SplitResult {
  const startedAtMs = options.startedAtMs ?? Date.now();
  const nowMs = options.nowMs ?? startedAtMs + 420;
  const matches = retrieve(query, { limit: options.limit ?? 8 });

  return {
    document: { ...document, pageCount: PAGE_GEOMETRY.length, title: DOCUMENT_TITLE, author: DOCUMENT_AUTHOR },
    query,
    matches,
    metadata: metadata(startedAtMs, nowMs),
  };
}

/* ── Shared helpers ──────────────────────────────────────────────────────── */

export const SUGGESTED_SPLIT_QUERIES = [
  'Find the section about employee benefits.',
  'Find chunks related to termination clauses.',
  'What was the revenue growth in India?',
  'Which regions performed best?',
  'What are the principal risks?',
] as const;

export { PAGE_GEOMETRY };

/* `DOCUMENT_SUMMARY`, `DOCUMENT_TITLE`, `PAGE_HEIGHT`, `FIGURE_ASSET_NAME` and
 * `SCHEMA_FIELD_TYPES` are deliberately *not* re-exported here — they already
 * come from `fixture-document.ts`, and re-exporting them from two modules that
 * `mock/index.ts` star-exports would make the names ambiguous and strip them
 * from the public surface entirely. */
