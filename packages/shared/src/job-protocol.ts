/**
 * The wire protocol between the control plane (Node API) and the processing
 * plane (Python worker).
 *
 * Transport is Redis lists, but nothing below assumes Redis: `JobEnvelope` is
 * a plain JSON document that could travel over SQS, RabbitMQ or an HTTP pull
 * without changing the worker's processor code.
 *
 * Contract rules:
 *  - The API never sends file bytes through the queue. It sends a storage key.
 *  - The worker never writes to PostgreSQL. It writes artifacts to object
 *    storage and reports back over the internal callback API.
 *  - All payloads are JSON-serialisable and versioned by `protocolVersion`.
 */

import type { JobStage, Operation } from './constants.js';
import type { ExtractionSchema, JobError, SchemaField } from './types.js';

export const JOB_PROTOCOL_VERSION = 1;

/** Operation-specific inputs carried on the envelope. */
export interface ParseJobInput {
  /** Emit per-page images for figures and charts. */
  extractImages: boolean;
  /** Keep running headers/footers as chunks or drop them. */
  keepFurniture: boolean;
}

export interface ExtractJobInput {
  schemaName: string;
  fields: SchemaField[];
}

export interface SplitJobInput {
  query: string;
  /** Maximum matches the worker should return. */
  limit: number;
}

export type JobInput = ParseJobInput | ExtractJobInput | SplitJobInput;

export const DEFAULT_PARSE_INPUT: ParseJobInput = {
  extractImages: true,
  keepFurniture: false,
};

export const DEFAULT_SPLIT_LIMIT = 8;

/**
 * What the API pushes onto the queue.
 *
 * `callback` carries the internal endpoints the worker reports to. The worker
 * holds no database credentials and no knowledge of the API's routing — it is
 * handed everything it needs, per job.
 */
export interface JobEnvelope {
  protocolVersion: typeof JOB_PROTOCOL_VERSION;
  jobId: string;
  documentId: string;
  operation: Operation;
  input: JobInput;
  document: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    /** Key of the raw upload inside the shared object store. */
    storageKey: string;
  };
  callback: {
    baseUrl: string;
    /** Presented as `X-Worker-Token` on every internal callback. */
    token: string;
  };
  /** Attempt counter, incremented by the API on redelivery. 1-based. */
  attempt: number;
  enqueuedAt: string;
}

/* ── Worker → API callbacks ──────────────────────────────────────────────── */

export interface JobProgressRequest {
  progress: number;
  stage: JobStage;
  /** Optional human-readable note, surfaced in the UI's processing log. */
  message?: string;
}

/**
 * Artifacts are written to object storage by the worker; this reports where
 * they landed so the API can record metadata without touching the bytes.
 */
export interface ArtifactReport {
  type: 'MARKDOWN' | 'JSON' | 'ASSET';
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  label?: string | null;
}

export interface JobCompleteRequest {
  artifacts: ArtifactReport[];
  /** Document-level fields the processor discovered. */
  document: {
    pageCount: number;
    title?: string | null;
    author?: string | null;
    summary?: string | null;
  };
  /**
   * Summary figures recorded on the job row so list views never need to read
   * an artifact just to show a badge.
   *
   * A worker may also put the full `chunks` array on the wire — the request
   * schema accepts it — but it is deliberately *not* part of this type, because
   * `completeJob` drops it. Chunk text belongs to the JSON artifact; persisting
   * it here would duplicate document content into a relational row.
   */
  metrics: {
    chunkCount: number;
    assetCount: number;
    tableCount: number;
    markdownBytes: number;
  };
  metadata: {
    engine: string;
    version: string;
    durationMs: number;
    mocked: boolean;
  };
}

export interface JobFailRequest {
  /**
   * The code is a plain string on the wire, not `JobErrorCode`.
   *
   * A worker newer than this API may report a code that does not exist here
   * yet, and rejecting the whole failure report over an unrecognised token
   * would throw away the error that actually matters. `failJob` normalises it
   * to a known `JobErrorCode` before anything is persisted, so the stored
   * `JobError` is always well-typed.
   */
  error: Omit<JobError, 'code'> & { code: string };
}

/* ── Model surface the worker implements ─────────────────────────────────── */

/**
 * Mirrors the `schema` input on an Extract job so the worker can validate the
 * payload it received before spending time on the document.
 */
export interface ResolvedExtractionSchema extends Pick<ExtractionSchema, 'name' | 'fields'> {}
