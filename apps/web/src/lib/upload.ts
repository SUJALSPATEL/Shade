import type { CreateDocumentResponse, Operation } from '@shade/shared';
import { formatBytes } from '@shade/shared';
import { documents, uploads, type OperationInputs } from './endpoints';

/**
 * The upload flow, in one function.
 *
 * Three round trips, and the order is the whole security model:
 *
 *   1. `POST /api/uploads/presign` — the server validates the *description*
 *      (type, size) and mints a ticket naming where the bytes will live. The
 *      storage key is built from the session id and a server-generated id; the
 *      client never proposes one.
 *   2. `PUT` the bytes to the returned URL — the server checks the ticket,
 *      checks the bytes actually start with `%PDF-`, and only then writes.
 *   3. `POST /api/documents` — the ticket is redeemed into a document row, and
 *      the first job is enqueued in the same request.
 *
 * The client also validates before step 1, but only to fail fast: a 40 MB file
 * rejected after a full upload is a worse experience than one rejected in the
 * file picker. The server repeats every check, and the server's answer is the
 * one that counts.
 */

/** Mirrors `MAX_UPLOAD_BYTES` in the API's config. */
export const MAX_UPLOAD_BYTES = 52_428_800;

/** What the browser will accept in the picker. */
export const ACCEPTED_MIME_TYPES = ['application/pdf'] as const;
export const ACCEPT_ATTRIBUTE = '.pdf,application/pdf';

export type UploadPhase = 'preparing' | 'uploading' | 'creating';

export interface UploadProgress {
  phase: UploadPhase;
  /** 0–1 within the current phase. */
  fraction: number;
}

export interface UploadRequest extends OperationInputs {
  file: File;
  operation: Operation;
  projectId?: string | null;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
}

export interface UploadOutcome {
  document: CreateDocumentResponse['document'];
  job: CreateDocumentResponse['job'];
  /** Echoed so the caller can report it without re-reading the document. */
  pageCount: number | null;
}

/**
 * Checks a file the way the server will, and returns the reason it would fail.
 *
 * Returning a message rather than throwing keeps this usable as a form
 * validator — a caller can render the reason next to the file picker before the
 * user has committed to anything.
 */
export function describeUploadProblem(file: File): string | null {
  // `file.type` is a browser guess from the extension and can be empty for a
  // file dragged from an unusual source, so a PDF extension is accepted too.
  // The server checks the magic bytes regardless, which is what actually
  // decides whether this is a PDF.
  const looksLikePdf =
    ACCEPTED_MIME_TYPES.includes(file.type as (typeof ACCEPTED_MIME_TYPES)[number]) ||
    file.name.toLowerCase().endsWith('.pdf');

  if (!looksLikePdf && file.type) {
    return `${file.name} is not a PDF. Shade reads PDFs today.`;
  }
  if (file.size === 0) {
    return `${file.name} is empty.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`;
  }
  return null;
}

/** Uploads a file and starts its first job. */
export async function uploadAndProcess(request: UploadRequest): Promise<UploadOutcome> {
  const { file, operation, projectId, signal, onProgress, ...inputs } = request;

  const problem = describeUploadProblem(file);
  if (problem) throw new Error(problem);

  onProgress?.({ phase: 'preparing', fraction: 0 });

  const ticket = await uploads.presign({
    filename: file.name,
    // A PDF dragged from some file managers arrives as an empty string. Sending
    // that would fail the server's allow-list for a file the server would have
    // accepted on its bytes, so the extension is the fallback.
    mimeType: file.type || 'application/pdf',
    sizeBytes: file.size,
    projectId: projectId ?? null,
  });

  onProgress?.({ phase: 'uploading', fraction: 0 });

  await uploads.put(ticket.uploadUrl, file, ticket.headers, {
    signal,
    onProgress: (fraction) => onProgress?.({ phase: 'uploading', fraction }),
  });

  onProgress?.({ phase: 'creating', fraction: 0.5 });

  const created = await documents.create({
    ticketId: ticket.ticketId,
    ...(projectId ? { projectId } : {}),
    operation,
    ...inputs,
  });

  onProgress?.({ phase: 'creating', fraction: 1 });

  return {
    document: created.document,
    job: created.job,
    pageCount: created.document.pageCount,
  };
}
