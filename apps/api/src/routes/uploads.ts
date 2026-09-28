import type { FastifyInstance, FastifyRequest } from 'fastify';
import { presignUploadRequestSchema } from '@shade/shared/contracts';
import { config } from '../config/env.js';
import { ownerOf, requireUser } from '../auth/plugin.js';
import { errors } from '../http/errors.js';
import { parseBody } from '../http/validate.js';
import { getStorage } from '../storage/index.js';
import { PDF_MAGIC, assertAllowedUpload, presignUpload } from '../services/uploads.js';
import { consumeUploadTicket, findUploadTicket } from '../db/repositories/tickets.js';
import { verifyUploadTicketSignature } from '../auth/tokens.js';

/**
 * Upload routes.
 *
 * Two shapes of upload, one ticket:
 *
 *   POST /api/uploads/presign        → reserve a destination, get a URL
 *   PUT  /api/uploads/direct/:id     → the local-storage path: the API writes
 *                                      the bytes itself
 *
 * With S3 the second step is replaced by a presigned PUT straight to the
 * bucket and never touches this server. The validation below is what makes the
 * local path safe: declared size and content type are re-checked against the
 * ticket, and the real bytes must actually start with `%PDF-`.
 */

export async function registerUploadRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/uploads/presign', async (request) => {
    const input = parseBody(presignUploadRequestSchema, request.body);
    const owner = ownerOf(request);

    // Project-scoped uploads require a real account; the project is validated
    // again at document-creation time, where the ownership check belongs.
    if (input.projectId) {
      requireUser(request);
    }

    return presignUpload({
      owner,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    });
  });

  /**
   * Direct upload for the local storage adapter.
   *
   * The multipart body is consumed as a stream with a hard byte ceiling, so an
   * oversized file is rejected while it is still arriving rather than after it
   * has been buffered into memory.
   */
  app.put<{ Params: { ticketId: string }; Querystring: { expires?: string; signature?: string } }>(
    '/api/uploads/direct/:ticketId',
    async (request, reply) => {
      const { ticketId } = request.params;
      const expiresAtMs = Number(request.query.expires ?? '0');
      const signature = request.query.signature ?? '';

      if (!Number.isFinite(expiresAtMs) || !verifyUploadTicketSignature(ticketId, expiresAtMs, signature)) {
        throw errors.forbidden('This upload link is not valid.');
      }
      if (Date.now() > expiresAtMs) {
        throw errors.forbidden('This upload link has expired. Request a new one.');
      }

      const ticket = await findUploadTicket(ticketId);
      if (!ticket) throw errors.notFound('Upload ticket');

      // The ticket must belong to the caller. A signature alone is not enough:
      // a leaked URL must not let a different session write into this slot.
      const owner = ownerOf(request);
      const ownerId = owner.userId ?? owner.sessionId;
      if ((owner.userId ? ticket.owner_user_id : ticket.owner_session_id) !== ownerId) {
        throw errors.forbidden('This upload link belongs to a different session.');
      }

      const body = await readBodyWithLimit(request, Math.min(
        Number(ticket.declared_bytes),
        config.storage.maxUploadBytes,
      ));

      assertAllowedUpload({ mimeType: ticket.mime_type, sizeBytes: body.byteLength });

      if (!body.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
        throw errors.invalidFileType('unknown', 'application/pdf');
      }

      const consumed = await consumeUploadTicket(ticketId, owner);
      if (!consumed) {
        throw errors.conflict('This upload link has already been used.');
      }

      const stored = await getStorage().put({
        key: ticket.storage_key,
        body,
        contentType: ticket.mime_type,
        metadata: { ticketId, originalFilename: ticket.filename },
      });

      return reply.code(201).send({
        ticketId,
        storageKey: ticket.storage_key,
        sizeBytes: stored.sizeBytes,
        contentType: stored.contentType,
      });
    },
  );
}

/**
 * Buffers the raw request body, refusing anything over `limit`.
 *
 * `application/pdf` is not a form encoding, so the bytes arrive as-is on
 * `request.raw` — the content type parser registered in `server.ts` deliberately
 * hands the stream through untouched. The ceiling is enforced as chunks
 * accumulate rather than after the fact, so an oversized upload is rejected
 * while it is still arriving instead of after it has been buffered.
 */
async function readBodyWithLimit(request: FastifyRequest, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request.raw) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buffer.byteLength;
    if (total > limit) {
      throw errors.fileTooLarge(total, limit);
    }
    chunks.push(buffer);
  }

  if (total === 0) throw errors.emptyFile();
  return Buffer.concat(chunks);
}
