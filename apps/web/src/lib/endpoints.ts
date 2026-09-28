import type {
  Activity,
  ChunksResponse,
  CreateDocumentResponse,
  DocumentDetailResponse,
  DocumentWithJob,
  JsonArtifactResponse,
  JobStatusResponse,
  ListResponse,
  MarkdownArtifactResponse,
  Operation,
  PresignUploadResponse,
  ProcessingJob,
  Project,
  ProjectDetailResponse,
  SessionResponse,
  SplitQueryResponse,
  User,
} from '@shade/shared';
import { request, sameOrigin } from './api';

/**
 * Every endpoint the app calls, in one place.
 *
 * Components never build a URL. That keeps the surface small enough to audit —
 * "what does this app ask the server for?" is answered by reading one file — and
 * it means a path change is a one-line edit rather than a search.
 *
 * Request bodies are declared inline rather than imported from
 * `@shade/shared/contracts`: those are zod schemas, and importing them would put
 * the whole validation library into the browser bundle to type four fields. The
 * types below mirror the zod-inferred request types exactly; the server
 * validates regardless, so the cost of a drift is a 400 with a field message,
 * not a silent bad write.
 */

/* ── Auth ─────────────────────────────────────────────────────────────────── */

export const auth = {
  session: () => request<SessionResponse>('/api/auth/session'),

  register: (input: { email: string; password: string; name: string }) =>
    request<SessionResponse>('/api/auth/register', { method: 'POST', body: input }),

  login: (input: { email: string; password: string }) =>
    request<SessionResponse>('/api/auth/login', { method: 'POST', body: input }),

  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
};

/* ── Uploads ──────────────────────────────────────────────────────────────── */

export const uploads = {
  /**
   * Reserves a destination and returns where to send the bytes.
   *
   * The client describes the file; the server decides the storage key. Nothing
   * about where the bytes land is decided here.
   */
  presign: (input: { filename: string; mimeType: string; sizeBytes: number; projectId?: string | null }) =>
    request<PresignUploadResponse>('/api/uploads/presign', {
      method: 'POST',
      body: {
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      },
    }),

  /**
   * Sends the bytes to the URL the presign call returned.
   *
   * `progress` is wired to `XMLHttpRequest` rather than `fetch`, because fetch
   * still cannot report upload progress — and a 40 MB PDF with no feedback is
   * the single most common way an upload UI feels broken.
   */
  put(
    uploadUrl: string,
    file: File,
    headers: Record<string, string>,
    options: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
  ): Promise<void> {
    const url = sameOrigin(uploadUrl);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      xhr.withCredentials = true;

      for (const [key, value] of Object.entries(headers)) {
        // `content-length` is set by the browser and cannot be assigned.
        if (key.toLowerCase() === 'content-length') continue;
        xhr.setRequestHeader(key, value);
      }

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && options.onProgress) {
          options.onProgress(event.loaded / event.total);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          options.onProgress?.(1);
          resolve();
          return;
        }
        reject(new Error(uploadFailureMessage(xhr)));
      });

      xhr.addEventListener('error', () =>
        reject(new Error('The upload could not reach the server.')),
      );
      xhr.addEventListener('abort', () =>
        reject(new DOMException('The upload was cancelled.', 'AbortError')),
      );

      options.signal?.addEventListener('abort', () => xhr.abort(), { once: true });

      xhr.send(file);
    });
  },
};

/** Pulls the API's own message out of an upload failure, when there is one. */
function uploadFailureMessage(xhr: XMLHttpRequest): string {
  try {
    const parsed = JSON.parse(xhr.responseText) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Not JSON — fall through.
  }
  if (xhr.status === 413) return 'That file is larger than the upload limit.';
  if (xhr.status === 415) return 'Only PDF files are supported right now.';
  return `The upload failed with HTTP ${xhr.status}.`;
}

/* ── Request shapes ───────────────────────────────────────────────────────── */

/**
 * Mirrors `parseInput`, `extractInput` and `splitInput` in
 * `@shade/shared/contracts`. Declared once here because all three appear on both
 * `POST /api/documents` and `POST /api/jobs`, and a drift between the two would
 * be a bug in whichever one nobody tested.
 */
export interface ParseInput {
  extractImages: boolean;
  keepFurniture: boolean;
}

export interface ExtractInput {
  schemaName: string;
  fields: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean' | 'date' | 'array<string>' | 'array<object>';
    description?: string;
    required?: boolean;
  }>;
}

export interface SplitInput {
  query: string;
  limit: number;
}

/** The three per-operation inputs are mutually exclusive; at most one applies. */
export interface OperationInputs {
  parseInput?: ParseInput;
  extractInput?: ExtractInput;
  splitInput?: SplitInput;
}

/* ── Documents ────────────────────────────────────────────────────────────── */

/**
 * A document's detail view.
 *
 * `availability` is computed by the API rather than inferred from `artifacts`
 * here. Both could answer "is there Markdown yet?", but the chunk count cannot:
 * it lives inside the JSON payload in storage, and the API already had to read
 * that payload to answer. Re-deriving it client-side would mean a second fetch
 * of the same object for a number the server just handed over.
 */
export interface DocumentDetail extends DocumentDetailResponse {
  availability: { markdown: boolean; json: boolean; chunks: number };
}

export const documents = {
  /**
   * Confirms a completed upload, creating the document row.
   *
   * `operation` is optional and enqueues the first job in the same round trip.
   * The workspace always passes it: a document with no job is a row nobody can
   * do anything with, so creating one and then immediately asking for a job
   * would be two requests that can disagree.
   */
  create: (
    input: {
      ticketId: string;
      projectId?: string | null;
      operation?: Operation;
    } & OperationInputs,
  ) => request<CreateDocumentResponse>('/api/documents', { method: 'POST', body: input }),

  list: (params: { projectId?: string; limit?: number; cursor?: string } = {}) =>
    request<ListResponse<DocumentWithJob>>(`/api/documents${queryString(params)}`),

  get: (documentId: string, signal?: AbortSignal) =>
    request<DocumentDetail>(`/api/documents/${encodeURIComponent(documentId)}`, { signal }),

  assignProject: (documentId: string, projectId: string | null) =>
    request<DocumentWithJob>(`/api/documents/${encodeURIComponent(documentId)}`, {
      method: 'PATCH',
      body: { projectId },
    }),

  remove: (documentId: string) =>
    request<void>(`/api/documents/${encodeURIComponent(documentId)}`, { method: 'DELETE' }),

  markdown: (documentId: string) =>
    request<MarkdownArtifactResponse>(`/api/documents/${encodeURIComponent(documentId)}/markdown`),

  json: (documentId: string) =>
    request<JsonArtifactResponse>(`/api/documents/${encodeURIComponent(documentId)}/json`),

  chunks: (documentId: string) =>
    request<ChunksResponse>(`/api/documents/${encodeURIComponent(documentId)}/chunks`),

  activity: (documentId: string) =>
    request<{ data: Activity[] }>(`/api/documents/${encodeURIComponent(documentId)}/activity`),

  /** Path for the PDF preview iframe. Same-origin, so the cookie rides along. */
  rawUrl: (documentId: string) => `/api/documents/${encodeURIComponent(documentId)}/raw`,

  /**
   * Path for an extracted figure.
   *
   * The generated Markdown references assets by their bare filename, so the
   * renderer has to resolve them against the document that produced them — the
   * same name in two different documents is two different figures.
   */
  assetUrl: (documentId: string, name: string) =>
    `/api/documents/${encodeURIComponent(documentId)}/assets/${encodeURIComponent(name)}`,
};

/* ── Jobs ─────────────────────────────────────────────────────────────────── */

export const jobs = {
  create: (input: { documentId: string; operation: Operation } & OperationInputs) =>
    request<{ job: ProcessingJob }>('/api/jobs', { method: 'POST', body: input }),

  status: (jobId: string, signal?: AbortSignal) =>
    request<JobStatusResponse>(`/api/jobs/${encodeURIComponent(jobId)}`, { signal }),

  list: (params: { documentId?: string; status?: string; limit?: number } = {}) =>
    request<ListResponse<ProcessingJob>>(`/api/jobs${queryString(params)}`),
};

/* ── Split (interactive retrieval) ────────────────────────────────────────── */

export const split = {
  query: (input: { documentId: string; query: string; limit?: number }) =>
    request<SplitQueryResponse>('/api/split', { method: 'POST', body: input }),
};

/* ── Projects ─────────────────────────────────────────────────────────────── */

export const projects = {
  create: (input: { name: string; summary?: string }) =>
    request<Project>('/api/projects', { method: 'POST', body: input }),

  list: (params: { limit?: number; cursor?: string } = {}) =>
    request<ListResponse<Project>>(`/api/projects${queryString(params)}`),

  get: (projectId: string) =>
    request<ProjectDetailResponse>(`/api/projects/${encodeURIComponent(projectId)}`),

  update: (projectId: string, input: { name?: string; summary?: string | null }) =>
    request<Project>(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: input,
    }),

  remove: (projectId: string) =>
    request<void>(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }),
};

/* ── History ──────────────────────────────────────────────────────────────── */

export interface HistorySummary {
  counts: Record<string, number>;
  total: number;
}

export const history = {
  list: (params: { limit?: number; cursor?: string; projectId?: string; type?: string } = {}) =>
    request<ListResponse<Activity>>(`/api/history${queryString(params)}`),

  summary: () => request<HistorySummary>('/api/history/summary'),
};

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * Builds a query string, dropping empty values.
 *
 * `URLSearchParams` would serialise `cursor=undefined` and `projectId=`, and the
 * API's zod schemas reject an id that is not a real id — so an unfiltered list
 * request must carry no filter keys at all.
 */
function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export type { User };
