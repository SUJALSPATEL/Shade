import type {
  ActivityType,
  ArtifactType,
  ChunkType,
  DocumentStatus,
  JobStage,
  JobStatus,
  Operation,
  PrincipalKind,
  SchemaFieldType,
} from './constants.js';

/** ISO-8601 timestamp string as it appears on the wire. */
export type IsoDateTime = string;

/** Every persisted entity uses a prefixed opaque id, e.g. `doc_01H...`. */
export type EntityId = string;

/* ── Identity ────────────────────────────────────────────────────────────── */

export interface User {
  id: EntityId;
  email: string;
  name: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** The authenticated-or-anonymous actor attached to a request. */
export interface Principal {
  kind: PrincipalKind;
  /** Present when `kind === 'USER'`. */
  userId: EntityId | null;
  /** Session row id — always present, for both kinds. */
  sessionId: EntityId;
  email: string | null;
  name: string | null;
  /**
   * Processing jobs this principal may still run. `null` means unlimited
   * (authenticated accounts are metered by plan, not by this counter).
   */
  jobsRemaining: number | null;
}

/* ── Projects ────────────────────────────────────────────────────────────── */

export interface Project {
  id: EntityId;
  userId: EntityId;
  name: string;
  summary: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Denormalised counts for list views — never the documents themselves. */
  documentCount?: number;
  lastActivityAt?: IsoDateTime | null;
}

/* ── Documents ───────────────────────────────────────────────────────────── */

export interface DocumentSummary {
  id: EntityId;
  projectId: EntityId | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  status: DocumentStatus;
  /** One-paragraph, human-readable description produced by the processor. */
  summary: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * A document plus its most recent job, which is what list and detail views
 * actually need. Keeping this as one shape avoids an N+1 fetch in the UI.
 */
export interface DocumentWithJob extends DocumentSummary {
  latestJob: ProcessingJob | null;
}

/* ── Jobs ────────────────────────────────────────────────────────────────── */

export interface ProcessingJob {
  id: EntityId;
  documentId: EntityId;
  operation: Operation;
  status: JobStatus;
  /** 0–100. Monotonic within a job. */
  progress: number;
  stage: JobStage | null;
  error: JobError | null;
  createdAt: IsoDateTime;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
}

export interface JobError {
  code: JobErrorCode;
  message: string;
  /** Whether re-running the job has a reasonable chance of succeeding. */
  retryable: boolean;
  detail?: string;
}

export const JOB_ERROR_CODES = [
  'UNSUPPORTED_FORMAT',
  'FILE_TOO_LARGE',
  'CORRUPT_DOCUMENT',
  'ENCRYPTED_DOCUMENT',
  'NO_TEXT_LAYER',
  'PROCESSOR_TIMEOUT',
  'PROCESSOR_ERROR',
  'STORAGE_ERROR',
  'INTERNAL_ERROR',
] as const;
export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];

/* ── Artifacts ───────────────────────────────────────────────────────────── */

/**
 * Metadata only. The bytes live in object storage and are reached through
 * `storageKey` — never through PostgreSQL and never through this object.
 */
export interface Artifact {
  id: EntityId;
  documentId: EntityId;
  jobId: EntityId | null;
  type: ArtifactType;
  /** Storage-namespaced key, e.g. `artifacts/doc_abc/parse.md`. */
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  /** For `ASSET` artifacts, the filename referenced from Markdown. */
  label: string | null;
  createdAt: IsoDateTime;
}

/**
 * An artifact as exposed to clients.
 *
 * `storageKey` is dropped rather than blanked: the API never tells a browser
 * where bytes live, and a type that cannot represent the key is a stronger
 * guarantee than a convention that it stays empty.
 */
export type PublicArtifact = Omit<Artifact, 'storageKey'>;

/**
 * Per-dependency health.
 *
 * `skipped` is a first-class state, not a synonym for `ok`: it means the
 * configured drivers do not use this dependency at all (no Redis under the
 * inline queue), which is a different claim from "checked and fine".
 */
export type HealthCheckStatus = 'ok' | 'error' | 'skipped';

/* ── Chunks ──────────────────────────────────────────────────────────────── */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A detected region of a page. Coordinates are in PDF points relative to the
 * page origin (top-left), which is what both the preview overlay and the
 * future export-to-PDF path expect.
 */
export interface DocumentChunk {
  chunk_id: string;
  text: string;
  page_number: number;
  bounding_box: BoundingBox;
  type: ChunkType;
  /** 0–1. Drives the low-confidence highlighting in the preview. */
  confidence: number;
  /** Chunks that continue a table/list across a page break share a group. */
  group_id?: string;
  heading_level?: number;
}

/* ── Parse result ────────────────────────────────────────────────────────── */

export interface DocumentDescriptor {
  id: EntityId;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  title: string | null;
  author: string | null;
  createdAt: IsoDateTime;
}

export interface AssetDescriptor {
  /** Filename as referenced from the generated Markdown. */
  name: string;
  storageKey: string;
  mimeType: string;
  pageNumber: number;
  width: number;
  height: number;
  caption: string | null;
}

export interface ProcessorMetadata {
  engine: string;
  version: string;
  durationMs: number;
  processedAt: IsoDateTime;
  /** Present when the engine is a mock and the output is fixture data. */
  mocked: boolean;
}

/**
 * The canonical output of a Parse job.
 *
 * `markdown` is the primary representation; `json` is the secondary,
 * machine-oriented view of the same structure. Note that `markdown` is *not*
 * persisted inside this object — it is written to its own storage artifact so
 * the two representations can be fetched, cached and versioned independently.
 */
export interface ParseResult {
  document: DocumentDescriptor;
  chunks: DocumentChunk[];
  json: StructuredDocument;
  assets: AssetDescriptor[];
  metadata: ProcessorMetadata;
}

/** Secondary representation: the document as a typed node tree. */
export interface StructuredDocument {
  title: string | null;
  page_count: number;
  sections: StructuredSection[];
  tables: StructuredTable[];
  assets: string[];
}

export interface StructuredSection {
  id: string;
  level: number;
  heading: string;
  page_number: number;
  paragraphs: string[];
  lists: string[][];
  table_refs: string[];
  asset_refs: string[];
}

export interface StructuredTable {
  id: string;
  page_number: number;
  caption: string | null;
  headers: string[];
  rows: string[][];
  /** Right-align numeric columns when rendering Markdown tables. */
  align: Array<'left' | 'right'>;
}

/* ── Extract result ──────────────────────────────────────────────────────── */

export interface SchemaField {
  /** Snake_case key used in the extraction output. */
  name: string;
  type: SchemaFieldType;
  description?: string;
  required?: boolean;
  /** Nested fields — only meaningful for `array<object>`. */
  fields?: SchemaField[];
}

export interface ExtractionSchema {
  id: EntityId;
  name: string;
  description: string | null;
  fields: SchemaField[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ExtractedValue<T = unknown> {
  value: T | null;
  /** 0–1. */
  confidence: number;
  /** Page the value was found on, for traceability back to the document. */
  pageNumber: number | null;
  /** Chunk ids supporting the value — links the field to the preview. */
  sourceChunkIds: string[];
}

/**
 * Field name → extracted value. Nested schemas nest the record.
 *
 * Declared as an interface rather than a `Record<...>` alias because the
 * recursive shape is rejected as a circular type alias; interfaces resolve it.
 */
export interface ExtractionRecord {
  [fieldName: string]: ExtractedValue | ExtractionRecord | ExtractedValue[];
}

export interface ExtractResult {
  document: DocumentDescriptor;
  schema: { name: string; fields: SchemaField[] };
  extraction: ExtractionRecord;
  /** 0–1, averaged across required fields. */
  overallConfidence: number;
  metadata: ProcessorMetadata;
}

/* ── Split result ────────────────────────────────────────────────────────── */

export interface SplitMatch {
  chunk_id: string;
  page_number: number;
  text: string;
  /** 0–1. */
  score: number;
  bounding_box: BoundingBox;
  type: ChunkType;
  /** Short explanation of why this chunk matched — rendered in the UI. */
  rationale: string;
}

export interface SplitResult {
  document: DocumentDescriptor;
  query: string;
  matches: SplitMatch[];
  metadata: ProcessorMetadata;
}

/* ── Activity ────────────────────────────────────────────────────────────── */

export interface Activity {
  id: EntityId;
  userId: EntityId | null;
  projectId: EntityId | null;
  documentId: EntityId | null;
  jobId: EntityId | null;
  type: ActivityType;
  /** Denormalised at write time so the feed renders without joins. */
  message: string;
  createdAt: IsoDateTime;
}

/* ── Union of every processor output ─────────────────────────────────────── */

export type ProcessingResult = ParseResult | ExtractResult | SplitResult;

export type ProcessingResultFor<O extends Operation> = O extends 'PARSE'
  ? ParseResult
  : O extends 'EXTRACT'
    ? ExtractResult
    : SplitResult;
