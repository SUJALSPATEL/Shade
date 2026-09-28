/**
 * Domain vocabulary for Shade.
 *
 * Every enum is declared as a frozen const object plus a derived union type
 * rather than a TypeScript `enum`. Const objects are erasable, survive
 * `isolatedModules`, serialise cleanly across the API boundary, and can be
 * mirrored 1:1 by the Python worker without a code-generation step.
 */

/* ── Processing operations ───────────────────────────────────────────────── */

export const OPERATIONS = ['PARSE', 'EXTRACT', 'SPLIT'] as const;
export type Operation = (typeof OPERATIONS)[number];

export const OPERATION_LABELS: Record<Operation, string> = {
  PARSE: 'Parse',
  EXTRACT: 'Extract',
  SPLIT: 'Split',
};

export const OPERATION_BLURBS: Record<Operation, string> = {
  PARSE: 'Convert a document into clean Markdown and structured JSON.',
  EXTRACT: 'Pull a typed schema out of a document, field by field.',
  SPLIT: 'Retrieve the passages that answer a question.',
};

/* ── Job lifecycle ───────────────────────────────────────────────────────── */

export const JOB_STATUSES = [
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Terminal states never transition again; the UI stops polling on them. */
export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}

/**
 * Named processing stages. The worker reports the stage alongside a numeric
 * progress value so the UI can show meaningful feedback instead of a bare bar.
 * Ordered — `STAGE_ORDER.indexOf(stage)` gives a stable sort key.
 */
export const JOB_STAGES = [
  'ACCEPTED',
  'FETCHING',
  'PARSING',
  'LAYOUT',
  'TEXT',
  'TABLES',
  'IMAGES',
  'STRUCTURE',
  'MARKDOWN',
  'JSON',
  'PERSISTING',
  'DONE',
] as const;
export type JobStage = (typeof JOB_STAGES)[number];

export const JOB_STAGE_LABELS: Record<JobStage, string> = {
  ACCEPTED: 'Accepted',
  FETCHING: 'Fetching document',
  PARSING: 'Reading PDF',
  LAYOUT: 'Understanding layout',
  TEXT: 'Extracting text',
  TABLES: 'Extracting tables',
  IMAGES: 'Extracting images',
  STRUCTURE: 'Detecting structure',
  MARKDOWN: 'Generating Markdown',
  JSON: 'Generating JSON',
  PERSISTING: 'Saving artifacts',
  DONE: 'Done',
};

/**
 * The stages each operation actually visits, in order.
 *
 * A Split job never extracts tables and never renders Markdown, so a UI that
 * renders `JOB_STAGES` as a checklist makes every Split look like a Parse that
 * stalled two thirds of the way through. This is the list a progress view
 * should draw; the full `JOB_STAGES` is the vocabulary, not the itinerary.
 *
 * The Python worker emits exactly these sequences — see the `ctx.stage(...)`
 * calls in `services/worker/shade_worker/processors/`. If a processor gains a
 * stage, this map changes in the same commit.
 */
export const OPERATION_STAGES: Record<Operation, readonly JobStage[]> = {
  PARSE: [
    'ACCEPTED',
    'FETCHING',
    'PARSING',
    'LAYOUT',
    'TEXT',
    'TABLES',
    'IMAGES',
    'STRUCTURE',
    'MARKDOWN',
    'JSON',
    'PERSISTING',
    'DONE',
  ],
  EXTRACT: [
    'ACCEPTED',
    'FETCHING',
    'PARSING',
    'LAYOUT',
    'TEXT',
    'STRUCTURE',
    'JSON',
    'PERSISTING',
    'DONE',
  ],
  SPLIT: ['ACCEPTED', 'FETCHING', 'PARSING', 'TEXT', 'STRUCTURE', 'JSON', 'PERSISTING', 'DONE'],
};

/* ── Documents ───────────────────────────────────────────────────────────── */

export const DOCUMENT_STATUSES = [
  'UPLOADING',
  'UPLOADED',
  'QUEUED',
  'PROCESSING',
  'READY',
  'FAILED',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/* ── Artifacts ───────────────────────────────────────────────────────────── */

export const ARTIFACT_TYPES = ['MARKDOWN', 'JSON', 'ASSET'] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/* ── Chunks ──────────────────────────────────────────────────────────────── */

/**
 * Semantic role of a detected region. The Markdown generator maps these onto
 * Markdown constructs, so the set is deliberately small and structural rather
 * than a full layout taxonomy.
 */
export const CHUNK_TYPES = [
  'heading',
  'paragraph',
  'list',
  'table',
  'figure',
  'caption',
  'formula',
  'header',
  'footer',
  'page_number',
] as const;
export type ChunkType = (typeof CHUNK_TYPES)[number];

/* ── Activity feed ───────────────────────────────────────────────────────── */

export const ACTIVITY_TYPES = [
  'PROJECT_CREATED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_PARSED',
  'DOCUMENT_EXTRACTED',
  'DOCUMENT_SPLIT',
  'JOB_FAILED',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/* ── Schema field types (Extract) ────────────────────────────────────────── */

export const SCHEMA_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'date',
  'array<string>',
  'array<object>',
] as const;
export type SchemaFieldType = (typeof SCHEMA_FIELD_TYPES)[number];

/* ── Auth ────────────────────────────────────────────────────────────────── */

/**
 * A request is served by exactly one principal kind. Anonymous principals are
 * real, server-issued sessions with a usage quota — not a client-side flag —
 * so the pre-auth limit cannot be bypassed by clearing localStorage.
 */
export const PRINCIPAL_KINDS = ['USER', 'ANONYMOUS'] as const;
export type PrincipalKind = (typeof PRINCIPAL_KINDS)[number];

/* ── Storage ─────────────────────────────────────────────────────────────── */

export const STORAGE_DRIVERS = ['local', 's3'] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];
