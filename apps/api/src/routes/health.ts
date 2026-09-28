import type { FastifyInstance } from 'fastify';
import type { HealthCheckStatus, HealthResponse } from '@shade/shared';
import { config } from '../config/env.js';
import { checkDatabase } from '../db/client.js';
import { getStorage } from '../storage/index.js';
import type { AppDeps } from './deps.js';

/**
 * Health.
 *
 * Reports each dependency separately rather than as a single boolean, because
 * "the API is up but Redis is unreachable" and "nothing works" call for
 * different responses from whoever is on call. A dependency the configured
 * drivers do not use reports `skipped`, so a local-storage / inline-queue
 * development setup does not show a permanent red light.
 */

const startedAt = Date.now();

/** A key that must never exist; reading it proves the backend answers. */
const HEALTH_PROBE_KEY = '__healthcheck__/probe';

export async function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get('/api/health', async (_request, reply) => {
    const [database, queue, storage] = await Promise.all([
      checkDatabase(),
      deps.dispatcher.healthy(),
      checkStorage(),
    ]);

    const checks: HealthResponse['checks'] = {
      database: database ? 'ok' : 'error',
      redis: deps.dispatcher.kind === 'redis' ? (queue ? 'ok' : 'error') : 'skipped',
      storage,
      queue: queue ? 'ok' : 'error',
    };

    const healthy = Object.values(checks).every((value) => value !== 'error');

    const response: HealthResponse = {
      status: healthy ? 'ok' : 'degraded',
      version: `${config.worker.engine}@${config.worker.version}`,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      checks,
    };

    // 503 when degraded, so a load balancer can act without parsing the body.
    // The body is still a full report, which is what a human needs.
    return reply.code(healthy ? 200 : 503).send(response);
  });

  /** Liveness only: is the process accepting requests at all. */
  app.get('/api/health/live', async () => ({ status: 'ok' }));
}

/**
 * A real read against the configured storage backend.
 *
 * `head` on a sentinel key is the cheapest operation that proves the backend is
 * reachable and answering rather than merely configured — and it writes
 * nothing, so a health check cannot create state.
 */
async function checkStorage(): Promise<HealthCheckStatus> {
  try {
    await getStorage().head(HEALTH_PROBE_KEY);
    return 'ok';
  } catch {
    return 'error';
  }
}
