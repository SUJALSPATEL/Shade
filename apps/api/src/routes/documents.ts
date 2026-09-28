import type { FastifyInstance } from 'fastify';
import {
  createDocumentRequestSchema,
  listDocumentsQuerySchema,
} from '@shade/shared/contracts';
import { sanitizeFilename } from '@shade/shared';
import type { CreateDocumentResponse, DocumentWithJob, ListResponse } from '@shade/shared';
import { ownerOf } from '../auth/plugin.js';
import { decodeCursor, encodeCursor } from '../db/client.js';
import { assignDocumentToProject, listDocuments } from '../db/repositories/documents.js';
import { listActivityForDocument } from '../db/repositories/activities.js';
import { findProject } from '../db/repositories/projects.js';
import { errors } from '../http/errors.js';
import { parseBody, parseQuery } from '../http/validate.js';
import {
  createDocumentFromTicket,
  deleteDocument,
  getDocumentDetail,
  getDocumentWithJob,
} from '../services/documents.js';
import {
  artifactAvailability,
  getChunks,
  getMarkdown,
  getRawUpload,
  getStructuredJson,
} from '../services/artifacts.js';
import { createJobForDocument, type JobInputs } from '../services/jobs.js';
import type { AppDeps } from './deps.js';

/**
 * Document routes.
 *
 * Every read resolves the document through `ownerOf(request)`, so a document id
 * belonging to another account simply does not exist as far as this handler is
 * concerned. There is no "fetch then check" step anywhere — the ownership
 * predicate is part of the query.
 */

export async function registerDocumentRoutes(
  app: FastifyInstance,
  deps: AppDeps,
): Promise<void> {
  /**
   * Creates a document from a completed upload, and optionally starts its first
   * job in the same round trip.
   *
   * The client supplies a *ticket id*, never a storage key or a size — those
   * were decided at presign time and are re-read from the ticket row here.
   */
  app.post('/api/documents', async (request, reply) => {
    const input = parseBody(createDocumentRequestSchema, request.body);
    const owner = ownerOf(request);

    const created = await createDocumentFromTicket({
      owner,
      ticketId: input.ticketId,
      projectId: input.projectId ?? null,
    });

    // The initial operation is a convenience for the focused workspace: upload,
    // create and start in one request rather than three. Quota enforcement and
    // the job state machine are the same code path either way.
    if (input.operation) {
      const inputs: JobInputs = {
        ...(input.parseInput ? { parseInput: input.parseInput } : {}),
        ...(input.extractInput ? { extractInput: input.extractInput } : {}),
        ...(input.splitInput ? { splitInput: input.splitInput } : {}),
      };

      const { job } = await createJobForDocument({
        documentId: created.id,
        owner,
        sessionId: request.principal.sessionId,
        operation: input.operation,
        inputs,
        dispatcher: deps.dispatcher,
      });

      const response: CreateDocumentResponse = {
        document: await getDocumentWithJob(created.id, owner),
        job,
      };
      return reply.code(201).send(response);
    }

    const response: CreateDocumentResponse = {
      document: await getDocumentWithJob(created.id, owner),
      job: null,
    };
    return reply.code(201).send(response);
  });

  app.get('/api/documents', async (request) => {
    const query = parseQuery(listDocumentsQuerySchema, request.query);
    const owner = ownerOf(request);
    const cursor = decodeCursor(query.cursor);

    // One extra row is requested so "is there a next page?" is answered without
    // a second count query.
    const rows = await listDocuments({
      owner,
      projectId: query.projectId ?? null,
      limit: query.limit + 1,
      cursor,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    const response: ListResponse<DocumentWithJob> = {
      data: page,
      nextCursor:
        hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
    };
    return response;
  });

  app.get<{ Params: { documentId: string } }>(
    '/api/documents/:documentId',
    async (request) => {
      const owner = ownerOf(request);
      const detail = await getDocumentDetail(request.params.documentId, owner);
      const availability = await artifactAvailability(request.params.documentId, owner);
      return { ...detail, availability };
    },
  );

  /** Files a document into a project, or out of one with `projectId: null`. */
  app.patch<{ Params: { documentId: string }; Body: { projectId?: string | null } }>(
    '/api/documents/:documentId',
    async (request) => {
      const owner = ownerOf(request);
      const projectId = request.body?.projectId ?? null;

      if (projectId) {
        const userId = owner.userId;
        if (!userId) throw errors.unauthenticated('Sign in to file documents into a project.');
        const project = await findProject(projectId, userId);
        if (!project) throw errors.notFound('Project');
      }

      const document = await getDocumentWithJob(request.params.documentId, owner);
      const updated = await assignDocumentToProject(document.id, owner, projectId);
      if (!updated) throw errors.notFound('Document');

      return getDocumentWithJob(document.id, owner);
    },
  );

  app.delete<{ Params: { documentId: string } }>(
    '/api/documents/:documentId',
    async (request, reply) => {
      await deleteDocument(request.params.documentId, ownerOf(request));
      return reply.code(204).send();
    },
  );

  /* ── Artifacts ─────────────────────────────────────────────────────────── */

  /** Markdown — the primary representation. */
  app.get<{ Params: { documentId: string } }>(
    '/api/documents/:documentId/markdown',
    async (request, reply) => {
      const result = await getMarkdown(request.params.documentId, ownerOf(request));
      return reply
        .header('content-type', 'text/markdown; charset=utf-8')
        .header('cache-control', 'private, no-store')
        .send(result);
    },
  );

  /** JSON — the secondary representation, with chunks and the node tree. */
  app.get<{ Params: { documentId: string } }>(
    '/api/documents/:documentId/json',
    async (request) => getStructuredJson(request.params.documentId, ownerOf(request)),
  );

  /** Detected regions, for the preview overlay. */
  app.get<{ Params: { documentId: string } }>(
    '/api/documents/:documentId/chunks',
    async (request) => getChunks(request.params.documentId, ownerOf(request)),
  );

  /**
   * The original upload, streamed for the PDF preview.
   *
   * Served from the API rather than handed out as a storage URL: a signed URL
   * would outlive the session that requested it and would be a second, parallel
   * authorisation path to keep correct. `inline` plus `nosniff` means the
   * browser renders it and never guesses a different type for it.
   */
  app.get<{ Params: { documentId: string } }>(
    '/api/documents/:documentId/raw',
    async (request, reply) => {
      const { object, document } = await getRawUpload(request.params.documentId, ownerOf(request));

      return reply
        .header('content-type', document.mime_type)
        .header('content-length', String(object.sizeBytes))
        .header('content-disposition', `inline; filename="${sanitizeFilename(document.filename)}"`)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, max-age=300')
        .send(object.stream);
    },
  );

  /** Per-document activity, shown in the document panel's History tab. */
  app.get<{ Params: { documentId: string } }>(
    '/api/documents/:documentId/activity',
    async (request) => {
      const document = await getDocumentWithJob(request.params.documentId, ownerOf(request));
      const activity = await listActivityForDocument(document.id);
      return { data: activity };
    },
  );
}
