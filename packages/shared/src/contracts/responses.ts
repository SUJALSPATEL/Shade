import type {
  Activity,
  Artifact,
  DocumentSummary,
  DocumentWithJob,
  ExtractResult,
  HealthCheckStatus,
  ParseResult,
  Principal,
  ProcessingJob,
  Project,
  PublicArtifact,
  SplitResult,
  User,
} from '../types.js';
import type { ApiErrorResponse } from '../errors.js';

/**
 * Response envelopes.
 *
 * Every successful response is either a bare resource, a `{ data }` list, or a
 * `{ data, nextCursor }` page. Successes never carry an `error` key and errors
 * never carry `data`, so a client can discriminate on one property.
 */

export type ApiResponse<T> = T | ApiErrorResponse;

export interface ListResponse<T> {
  data: T[];
  /** Opaque cursor for the next page; `null` when the list is exhausted. */
  nextCursor: string | null;
}

export interface ItemResponse<T> {
  data: T;
}

/** Pagination is cursor-based so inserts never shift a page under the reader. */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
  /** Total matching rows, when cheap to compute. */
  total?: number;
}

/* ── Auth ────────────────────────────────────────────────────────────────── */

export interface SessionResponse {
  principal: Principal;
  user: User | null;
  /** Anonymous sessions are issued a quota; users are not metered here. */
  jobsRemaining: number | null;
  /**
   * Documents created anonymously in this browser session that were claimed by
   * the account on sign-in. Lets the UI say "we moved 1 document into your
   * workspace" instead of silently changing the user's project list.
   */
  claimedDocumentCount?: number;
}

/* ── Uploads ─────────────────────────────────────────────────────────────── */

export interface PresignUploadResponse {
  ticketId: string;
  /** Where to PUT the bytes. Same-origin path or absolute URL. */
  uploadUrl: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
  /** Echoed back on document creation; the server re-validates ownership. */
  storageKey: string;
  expiresAt: string;
  maxBytes: number;
}

/* ── Documents ───────────────────────────────────────────────────────────── */

export interface DocumentDetailResponse {
  document: DocumentWithJob;
  project: Pick<Project, 'id' | 'name'> | null;
  jobs: ProcessingJob[];
  artifacts: PublicArtifact[];
}

export interface CreateDocumentResponse {
  document: DocumentWithJob;
  job: ProcessingJob | null;
}

/* ── Jobs ────────────────────────────────────────────────────────────────── */

export interface JobStatusResponse {
  job: ProcessingJob;
  document: Pick<DocumentSummary, 'id' | 'filename' | 'status' | 'pageCount' | 'summary'>;
  /**
   * Present only once the job has COMPLETED. Included inline so the workspace
   * renders its result in the same round trip that observes completion,
   * instead of firing a follow-up request.
   */
  result: ParseResult | ExtractResult | SplitResult | null;
}

/* ── Artifacts ───────────────────────────────────────────────────────────── */

export interface MarkdownArtifactResponse {
  documentId: string;
  filename: string;
  markdown: string;
  bytes: number;
  generatedAt: string | null;
}

export interface JsonArtifactResponse {
  documentId: string;
  filename: string;
  json: ParseResult['json'];
  chunks: ParseResult['chunks'];
  assets: ParseResult['assets'];
  metadata: ParseResult['metadata'] | null;
}

/* ── Chunks ──────────────────────────────────────────────────────────────── */

export interface ChunksResponse {
  documentId: string;
  pageCount: number;
  chunks: ParseResult['chunks'];
  /** Page geometry in PDF points, so overlays can be positioned accurately. */
  pages: Array<{ pageNumber: number; width: number; height: number }>;
}

/* ── Projects ────────────────────────────────────────────────────────────── */

export interface ProjectDetailResponse {
  project: Project;
  documents: DocumentWithJob[];
  activity: Activity[];
  stats: {
    documentCount: number;
    parsedCount: number;
    artifactsBytes: number;
    lastActivityAt: string | null;
  };
}

/* ── Split retrieval ─────────────────────────────────────────────────────── */

export interface SplitQueryResponse {
  documentId: string;
  query: string;
  matches: SplitResult['matches'];
  /** Which retriever answered — `mock-lexical` today, embeddings later. */
  retriever: string;
  tookMs: number;
}

/* ── Health ──────────────────────────────────────────────────────────────── */

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  checks: Record<'database' | 'redis' | 'storage' | 'queue', HealthCheckStatus>;
}

export type { Activity, Artifact, DocumentSummary, DocumentWithJob, ProcessingJob, Project, User };
