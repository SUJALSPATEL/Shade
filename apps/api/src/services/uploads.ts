import { sanitizeFilename, storageKeys, type PresignUploadResponse } from '@shade/shared';
import { config } from '../config/env.js';
import { createUploadTicket } from '../db/repositories/tickets.js';
import { errors } from '../http/errors.js';
import { getStorage } from '../storage/index.js';
import { buildLocalUploadUrl, signUploadTicket } from '../auth/tokens.js';

/**
 * Upload negotiation.
 *
 * The client describes what it is about to send; the server decides where it
 * will live and records what it expects. Nothing about the destination is
 * client-controlled — the storage key is built from the session id and a
 * server-generated document id, and the original filename is kept only as
 * display metadata.
 */

/**
 * Formats the product accepts today.
 *
 * PDF only, deliberately. The processing interface is format-agnostic and the
 * roadmap covers DOCX and images, but validating a narrower set than the
 * processor can handle is strictly safer than the reverse.
 */
export const ALLOWED_UPLOAD_MIME_TYPES = ['application/pdf'] as const;

/** A PDF must start with this; checked against real bytes at upload time. */
export const PDF_MAGIC = Buffer.from('%PDF-', 'utf8');

export function assertAllowedUpload(input: { mimeType: string; sizeBytes: number }): void {
  if (!ALLOWED_UPLOAD_MIME_TYPES.includes(input.mimeType as (typeof ALLOWED_UPLOAD_MIME_TYPES)[number])) {
    throw errors.invalidFileType(input.mimeType, ALLOWED_UPLOAD_MIME_TYPES.join(', '));
  }
  if (input.sizeBytes <= 0) {
    throw errors.emptyFile();
  }
  if (input.sizeBytes > config.storage.maxUploadBytes) {
    throw errors.fileTooLarge(input.sizeBytes, config.storage.maxUploadBytes);
  }
}

export async function presignUpload(input: {
  owner: { userId: string | null; sessionId: string | null };
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<PresignUploadResponse> {
  assertAllowedUpload({ mimeType: input.mimeType, sizeBytes: input.sizeBytes });

  // An upload id, not a document id: the bytes have to have a destination
  // before the document row exists. See `storageKeys.raw`.
  const uploadId = globalThis.crypto.randomUUID().replace(/-/g, '');
  const ownerId = input.owner.userId ?? input.owner.sessionId ?? 'anonymous';
  const safeFilename = sanitizeFilename(input.filename);
  const storageKey = storageKeys.raw(ownerId, uploadId, safeFilename);

  const ticket = await createUploadTicket({
    owner: input.owner,
    storageKey,
    filename: input.filename,
    mimeType: input.mimeType,
    declaredBytes: input.sizeBytes,
    ttlSeconds: config.storage.uploadTicketTtlSeconds,
  });

  const expiresAtMs = ticket.expires_at.getTime();
  const storage = getStorage();

  // S3 (and any future backend that can sign) hands back a real presigned URL.
  // The local adapter returns null, so we issue an API-mediated endpoint that
  // validates the bytes against this same ticket before writing them.
  const target = await storage.createUploadTarget({
    key: storageKey,
    contentType: input.mimeType,
    expiresInSeconds: config.storage.uploadTicketTtlSeconds,
    maxBytes: config.storage.maxUploadBytes,
  });

  return {
    ticketId: ticket.id,
    uploadUrl: target?.url ?? buildLocalUploadUrl(ticket.id, expiresAtMs),
    method: target?.method ?? 'PUT',
    headers: target?.headers ?? { 'content-type': input.mimeType },
    storageKey,
    expiresAt: (target?.expiresAt ?? ticket.expires_at).toISOString(),
    maxBytes: config.storage.maxUploadBytes,
  };
}

/** Re-exported so the direct-upload route can verify the signature it was given. */
export { signUploadTicket };
