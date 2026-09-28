import { Redis } from 'ioredis';
import { config } from '../config/env.js';
import { JOB_PROTOCOL_VERSION } from '@shade/shared';
import type { JobEnvelope } from '@shade/shared';

/**
 * Job dispatch.
 *
 * The HTTP request that creates a job must return immediately — that is the
 * whole point of the async model. So the API does exactly one thing with a
 * new job: it hands the envelope to a `JobDispatcher` and returns the job id.
 * The browser then polls `GET /api/jobs/:id`.
 *
 * Two dispatchers exist:
 *
 *   RedisJobDispatcher   pushes onto a Redis list; the Python worker consumes.
 *                        This is the real path and the default.
 *   InlineJobDispatcher  fulfils the job in-process using the shared mock
 *                        engine, after a short delay, without blocking the
 *                        request. It exists so `npm run dev` produces a
 *                        complete, believable flow with no Redis and no Python
 *                        installed. It is selected only by explicit config and
 *                        it refuses to run in production.
 *
 * Both satisfy the same contract, so routes never branch on which is active.
 */

export interface JobDispatcher {
  readonly kind: 'redis' | 'inline';
  dispatch(envelope: JobEnvelope): Promise<void>;
  /** Whether the dispatcher can currently accept work. */
  healthy(): Promise<boolean>;
  close(): Promise<void>;
}

/* ── Redis ───────────────────────────────────────────────────────────────── */

let sharedRedis: Redis | null = null;

/**
 * A single connection is shared for publishing. `maxRetriesPerRequest: null` is
 * required for blocking commands and keeps a transient Redis blip from
 * throwing on an in-flight request.
 */
export function getRedis(): Redis {
  if (!sharedRedis) {
    sharedRedis = new Redis(config.redis.url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
    });
    sharedRedis.on('error', (error: Error) => {
      console.error('[redis] connection error', error.message);
    });
  }
  return sharedRedis;
}

export class RedisJobDispatcher implements JobDispatcher {
  readonly kind = 'redis' as const;

  constructor(
    private readonly queueName: string = config.redis.queueName,
    private readonly redis: () => Redis = getRedis,
  ) {}

  async dispatch(envelope: JobEnvelope): Promise<void> {
    // LPUSH + BRPOP on the worker side gives FIFO ordering. The envelope is
    // self-contained: the worker needs nothing from our database to do its job.
    await this.redis().lpush(this.queueName, JSON.stringify(envelope));
  }

  async healthy(): Promise<boolean> {
    try {
      const pong = await this.redis().ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  /** Queue depth, surfaced by `/api/health` and useful when debugging. */
  async depth(): Promise<number> {
    return this.redis().llen(this.queueName);
  }

  async close(): Promise<void> {
    // The shared connection is closed once, by the server shutdown hook.
  }
}

/* ── Inline (development fallback) ───────────────────────────────────────── */

export type InlineJobRunner = (envelope: JobEnvelope) => Promise<void>;

/**
 * Runs jobs in-process without blocking the request that created them.
 *
 * This is a *dispatcher*, not a shortcut around the async model: `dispatch`
 * returns as soon as the work is queued on the event loop, and job state still
 * moves QUEUED → PROCESSING → COMPLETED through the same persistence code the
 * Redis path uses. What it skips is the network hop to a real worker.
 */
export class InlineJobDispatcher implements JobDispatcher {
  readonly kind = 'inline' as const;

  constructor(
    private readonly run: InlineJobRunner,
    /** Artificial delay so the UI's processing states are actually visible. */
    private readonly delayMs = 600,
  ) {}

  async dispatch(envelope: JobEnvelope): Promise<void> {
    const timer = setTimeout(() => {
      void this.run(envelope).catch((error: unknown) => {
        console.error(
          `[queue:inline] job ${envelope.jobId} failed:`,
          error instanceof Error ? error.message : error,
        );
      });
    }, this.delayMs);
    // Do not hold the process open on shutdown for a pending demo job.
    timer.unref?.();
  }

  async healthy(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {
    // Nothing to release.
  }
}

/* ── Envelope construction ───────────────────────────────────────────────── */

export function buildJobEnvelope(input: {
  jobId: string;
  documentId: string;
  operation: JobEnvelope['operation'];
  jobInput: JobEnvelope['input'];
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  attempt?: number;
}): JobEnvelope {
  return {
    protocolVersion: JOB_PROTOCOL_VERSION,
    jobId: input.jobId,
    documentId: input.documentId,
    operation: input.operation,
    input: input.jobInput,
    document: {
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey: input.storageKey,
    },
    callback: {
      // The worker calls back to the API's public origin. In a private
      // deployment this would be the cluster-internal service URL instead.
      baseUrl: config.api.publicUrl,
      token: config.worker.sharedToken,
    },
    attempt: input.attempt ?? 1,
    enqueuedAt: new Date().toISOString(),
  };
}
