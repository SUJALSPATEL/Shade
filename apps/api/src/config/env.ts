import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Everything the API reads from the environment is declared once, here, and
 * validated at boot — a missing `DATABASE_URL` should stop the process with a
 * readable message, not surface as `undefined` inside a query three requests
 * later.
 *
 * No dotenv dependency: Node's built-in `process.loadEnvFile` does the job.
 * The root `.env` is loaded first, then `apps/api/.env`, and real environment
 * variables always win over both (Node's documented `--env-file` precedence).
 */

function loadEnvFileIfPresent(path: string): void {
  if (!existsSync(path)) return;
  try {
    process.loadEnvFile(path);
  } catch (error) {
    // A malformed .env should be loud, but not prevent an operator from
    // supplying configuration purely through the real environment.
    console.warn(`[config] could not load ${path}: ${(error as Error).message}`);
  }
}

function loadEnvironment(): void {
  const cwd = process.cwd();
  loadEnvFileIfPresent(resolve(cwd, '../../.env'));
  loadEnvFileIfPresent(resolve(cwd, '.env'));
}

loadEnvironment();

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  API_CORS_ORIGINS: z.string().default('http://localhost:3000'),

  SHADE_SECRET: z
    .string()
    .min(16, 'SHADE_SECRET must be at least 16 characters — see .env.example'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  ANONYMOUS_JOB_QUOTA: z.coerce.number().int().min(0).max(100).default(1),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required — copy .env.example to .env'),
  PGPOOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  REDIS_URL: z.string().default('redis://localhost:6379'),
  QUEUE_DRIVER: z.enum(['redis', 'inline']).default('redis'),
  SHADE_JOB_QUEUE: z.string().default('shade:jobs'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./.data/storage'),
  UPLOAD_TICKET_TTL_SECONDS: z.coerce.number().int().min(30).max(86_400).default(900),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1024).default(52_428_800),

  S3_BUCKET: z.string().default('shade-dev'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: booleanish.default('true'),

  WORKER_SHARED_TOKEN: z.string().min(8, 'WORKER_SHARED_TOKEN must be set').default('dev-worker-token'),
  PROCESSOR_ENGINE: z.string().default('mock'),
  PROCESSOR_VERSION: z.string().default('0.1.0'),
});

function parseConfig() {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(
      `Invalid environment configuration:\n${lines.join('\n')}\n\nCopy .env.example to .env and fill it in.`,
    );
  }
  return result.data;
}

const raw = parseConfig();

const isProduction = raw.NODE_ENV === 'production';

/**
 * Refuse to boot in production with the development secret. This is the one
 * configuration mistake that is both easy to make and silently catastrophic.
 */
if (isProduction && raw.SHADE_SECRET.includes('dev-only')) {
  throw new Error('SHADE_SECRET still holds the development placeholder. Set a real secret before deploying.');
}

export const config = {
  env: raw.NODE_ENV,
  isProduction,
  isDevelopment: raw.NODE_ENV === 'development',
  logLevel: raw.LOG_LEVEL,

  api: {
    port: raw.API_PORT,
    publicUrl: raw.API_PUBLIC_URL.replace(/\/$/, ''),
    corsOrigins: raw.API_CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },

  auth: {
    secret: raw.SHADE_SECRET,
    sessionTtlDays: raw.SESSION_TTL_DAYS,
    anonymousJobQuota: raw.ANONYMOUS_JOB_QUOTA,
    /** Cookie name for the session token. */
    cookieName: 'shade_session',
  },

  database: {
    url: raw.DATABASE_URL,
    poolMax: raw.PGPOOL_MAX,
  },

  redis: {
    url: raw.REDIS_URL,
    driver: raw.QUEUE_DRIVER,
    queueName: raw.SHADE_JOB_QUEUE,
  },

  storage: {
    driver: raw.STORAGE_DRIVER,
    localRoot: resolve(process.cwd(), raw.STORAGE_LOCAL_ROOT),
    uploadTicketTtlSeconds: raw.UPLOAD_TICKET_TTL_SECONDS,
    maxUploadBytes: raw.MAX_UPLOAD_BYTES,
    s3: {
      bucket: raw.S3_BUCKET,
      region: raw.S3_REGION,
      endpoint: raw.S3_ENDPOINT || null,
      accessKeyId: raw.S3_ACCESS_KEY_ID,
      secretAccessKey: raw.S3_SECRET_ACCESS_KEY,
      forcePathStyle: raw.S3_FORCE_PATH_STYLE,
    },
  },

  worker: {
    sharedToken: raw.WORKER_SHARED_TOKEN,
    engine: raw.PROCESSOR_ENGINE,
    version: raw.PROCESSOR_VERSION,
  },
} as const;

export type Config = typeof config;

/** Log-safe view of the config — never print secrets. */
export function describeConfig(): Record<string, string | number | boolean> {
  return {
    env: config.env,
    apiPort: config.api.port,
    apiPublicUrl: config.api.publicUrl,
    queueDriver: config.redis.driver,
    queueName: config.redis.queueName,
    storageDriver: config.storage.driver,
    storageRoot: config.storage.localRoot,
    maxUploadBytes: config.storage.maxUploadBytes,
    anonymousJobQuota: config.auth.anonymousJobQuota,
    processorEngine: config.worker.engine,
  };
}
