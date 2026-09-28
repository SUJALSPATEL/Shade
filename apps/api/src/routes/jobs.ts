import type { FastifyInstance } from 'fastify';
import { createJobRequestSchema, listJobsQuerySchema } from '@shade/shared/contracts';
import type {
  ExtractResult,
  JobStatusResponse,
  ListResponse,
  ParseResult,
  ProcessingJob,
  SplitResult,
} from '@shade/shared';
import { isTerminalJobStatus } from '@shade/shared';
import { ownerOf } from '../auth/plugin.js';
import {
  findJobForOwner,
  listJobs,
  type JobRowWithDocument,
} from '../db/repositories/jobs.js';
import { errors } from '../http/errors.js';
import { parseBody, parseQuery } from '../http/validate.js';
import { getDocumentWithJob } from '../services/documents.js';
import { createJobForDocument, type JobInputs } from '../services/jobs.js';
import { readArtifactPayload } from '../services/artifacts.js';
import { findArtifact } from '../db/repositories/artifacts.js';
import type { AppDeps } from './deps.js';

/**
 * Job routes.
 *
 * The async contract in one place: `POST /api/jobs` returns a job id
 * immediately and does not wait for processing; `GET /api/jobs/:id` is polled
 * by the workspace until the job reaches a terminal state, at which point the
 * result is included inline so completion and its payload arrive together.
 *
 * Nothing here blocks on the processor. The only work a request does is a row
 * insert and a push onto a queue.
 */

export async function registerJobRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.post('/api/jobs', async (request, reply) => {
    const input = parseBody(createJobRequestSchema, request.body);
    const owner = ownerOf(request);

    const inputs: JobInputs = {
      ...(input.parseInput ? { parseInput: input.parseInput } : {}),
      ...(input.extractInput ? { extractInput: input.extractInput } : {}),
      ...(input.splitInput ? { splitInput: input.splitInput } : {}),
    };

    const { job } = await createJobForDocument({
      documentId: input.documentId,
      owner,
      sessionId: request.principal.sessionId,
      operation: input.operation,
      inputs,
      dispatcher: deps.dispatcher,
    });

    // 202: the work is accepted, not done. The client follows `job.id`.
    return reply.code(202).send({ job });
  });

  /**
   * Job status, with the result attached once it exists.
   *
   * Polling this is the whole progress mechanism — there is no socket to keep
   * alive and no server-push state to reconcile. The response is small until
   * the job completes, and the client stops as soon as `status` is terminal.
   */
  app.get<{ Params: { jobId: string } }>('/api/jobs/:jobId', async (request) => {
    const owner = ownerOf(request);
    const row = await findJobForOwner(request.params.jobId, owner);
    if (!row) throw errors.notFound('Job');

    const document = await getDocumentWithJob(row.document_id, owner);

    const response: JobStatusResponse = {
      job: toPublicJob(row),
      document: {
        id: document.id,
        filename: document.filename,
        status: document.status,
        pageCount: document.pageCount,
        summary: document.summary,
      },
      result: isTerminalJobStatus(row.status) && row.status === 'COMPLETED'
        ? await loadResult(row)
        : null,
    };

    return response;
  });

  app.get('/api/jobs', async (request) => {
    const query = parseQuery(listJobsQuerySchema, request.query);

    const jobs = await listJobs({
      owner: ownerOf(request),
      documentId: query.documentId,
      status: query.status as ProcessingJob['status'] | undefined,
      limit: query.limit,
    });

    const response: ListResponse<ProcessingJob> = { data: jobs, nextCursor: null };
    return response;
  });
}

function toPublicJob(row: JobRowWithDocument): ProcessingJob {
  return {
    id: row.id,
    documentId: row.document_id,
    operation: row.operation,
    status: row.status,
    progress: Number(row.progress),
    stage: row.stage,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

/**
 * Reads the completed payload back out of object storage.
 *
 * The job row knows the engine and the metrics; the bytes live in the artifact
 * it reported. Re-reading rather than caching here keeps one source of truth
 * for the result, and the payload is bounded (a parsed report, not a corpus).
 */
async function loadResult(
  row: JobRowWithDocument,
): Promise<ParseResult | ExtractResult | SplitResult | null> {
  const artifact = await findArtifact(row.document_id, 'JSON', row.operation);
  if (!artifact) return null;

  try {
    return await readArtifactPayload<ParseResult | ExtractResult | SplitResult>(artifact);
  } catch {
    // A completed job whose artifact cannot be read is a real inconsistency,
    // but it must not turn a status poll into a 500 — the workspace shows the
    // result tabs as unavailable and offers to run the job again.
    return null;
  }
}
