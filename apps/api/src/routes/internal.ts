import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  jobCompleteRequestSchema,
  jobFailRequestSchema,
  jobProgressRequestSchema,
} from '@shade/shared/contracts';
import { JOB_PROTOCOL_VERSION } from '@shade/shared';
import { config } from '../config/env.js';
import { errors } from '../http/errors.js';
import { parseBody } from '../http/validate.js';
import { completeJob, failJob, reportProgress, startJob } from '../services/jobs.js';
import { getStorage } from '../storage/index.js';

/**
 * Worker callbacks.
 *
 * The processing plane has no database credentials and no session. It reports
 * what it did to these endpoints and this server owns every state transition —
 * which keeps the job state machine in exactly one place and makes the worker
 * replaceable without a schema migration.
 *
 * Authentication is a shared token in `X-Worker-Token`, compared in constant
 * time. These routes live in their own encapsulated Fastify scope so the token
 * guard is a scope-level hook: a callback added here later cannot be registered
 * without it. They sit under `/api/internal/`, which the session hook skips
 * entirely — a worker has no use for a cookie and must never be handed one.
 */

const WORKER_TOKEN_HEADER = 'x-worker-token';

export async function registerInternalRoutes(app: FastifyInstance): Promise<void> {
  await app.register(async (scope) => {
    scope.addHook('onRequest', async (request) => {
      assertWorkerToken(request);
    });

    /** Claims a job: QUEUED → PROCESSING. */
    scope.post<{ Params: { jobId: string } }>(
      '/api/internal/jobs/:jobId/start',
      async (request) => {
        // `claimed: false` means the row is no longer QUEUED — a redelivery, or
        // a job the stale sweep already settled. The worker reads that as "skip
        // this envelope" rather than redoing work that is already done.
        const claimed = await startJob(request.params.jobId);
        return { claimed };
      },
    );

    scope.post<{ Params: { jobId: string } }>(
      '/api/internal/jobs/:jobId/progress',
      async (request, reply) => {
        const input = parseBody(jobProgressRequestSchema, request.body);
        await reportProgress(request.params.jobId, input);
        return reply.code(202).send({ ok: true });
      },
    );

    scope.post<{ Params: { jobId: string } }>(
      '/api/internal/jobs/:jobId/complete',
      async (request) => {
        const input = parseBody(jobCompleteRequestSchema, request.body);

        // The worker names the keys it wrote; confirming they resolve before
        // the job is marked COMPLETED means a job can never point at artifacts
        // that are not actually there. A completed job the UI cannot render is
        // worse than a failed one.
        const storage = getStorage();
        for (const artifact of input.artifacts) {
          const head = await storage.head(artifact.storageKey);
          if (!head) {
            throw errors.validation({
              artifacts: `Artifact ${artifact.storageKey} was reported but is not present in storage.`,
            });
          }
        }

        await completeJob(request.params.jobId, input);
        return { ok: true };
      },
    );

    scope.post<{ Params: { jobId: string } }>(
      '/api/internal/jobs/:jobId/fail',
      async (request, reply) => {
        const input = parseBody(jobFailRequestSchema, request.body);
        await failJob(request.params.jobId, input);
        return reply.code(202).send({ ok: true });
      },
    );

    /** Runtime facts a worker needs to agree with this server. No secrets. */
    scope.get('/api/internal/worker-config', async () => ({
      protocolVersion: JOB_PROTOCOL_VERSION,
      engine: config.worker.engine,
      version: config.worker.version,
      queueName: config.redis.queueName,
      maxUploadBytes: config.storage.maxUploadBytes,
    }));
  });
}

function assertWorkerToken(request: FastifyRequest): void {
  const header = request.headers[WORKER_TOKEN_HEADER];
  const token = Array.isArray(header) ? header[0] : header;

  if (!token || !constantTimeEquals(token, config.worker.sharedToken)) {
    throw errors.unauthenticated('A valid worker token is required for this endpoint.');
  }
}

/**
 * Constant-time string comparison.
 *
 * Both sides are hashed first: `timingSafeEqual` throws on unequal lengths, and
 * an explicit length check would itself leak the token's length. Digesting
 * makes both operands a fixed 32 bytes, so there is no such check to make.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
