import { newId } from '@shade/shared';
import type { JobError, JobStage, JobStatus, Operation, ProcessingJob } from '@shade/shared';
import { query, type Queryable } from '../client.js';

/**
 * Processing job persistence.
 *
 * A job row is the single source of truth for "what is happening to this
 * document". The worker never writes here; it reports progress and completion
 * to the internal callback API, which owns every state transition. That keeps
 * the state machine in one place and means the worker needs no database
 * credentials.
 */

export interface JobRowWithDocument {
  id: string;
  document_id: string;
  operation: Operation;
  status: JobStatus;
  progress: number;
  stage: JobStage | null;
  input: Record<string, unknown>;
  error: JobError | null;
  metrics: Record<string, unknown> | null;
  engine: string | null;
  attempts: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

export function toJob(row: JobRowWithDocument): ProcessingJob {
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

export async function createJob(
  input: {
    documentId: string;
    operation: Operation;
    jobInput: Record<string, unknown>;
  },
  db: Queryable = { query },
): Promise<ProcessingJob> {
  const result = await db.query<JobRowWithDocument>(
    `INSERT INTO processing_jobs (id, document_id, operation, status, input, attempts)
     VALUES ($1, $2, $3, 'QUEUED', $4, 1)
     RETURNING *`,
    [newId('job'), input.documentId, input.operation, JSON.stringify(input.jobInput)],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Job insert returned no row');
  return toJob(row);
}

export async function findJob(jobId: string): Promise<JobRowWithDocument | null> {
  const result = await query<JobRowWithDocument>('SELECT * FROM processing_jobs WHERE id = $1', [jobId]);
  return result.rows[0] ?? null;
}

/**
 * Finds a job only if its document belongs to `owner`.
 *
 * The join is the authorisation check: a job id from another account simply
 * does not resolve, so there is no separate "can this user see this job?"
 * branch to forget.
 */
export async function findJobForOwner(
  jobId: string,
  owner: { userId: string | null; sessionId: string | null },
): Promise<(JobRowWithDocument & { filename: string; document_status: string }) | null> {
  const clause = owner.userId
    ? 'd.owner_user_id = $2'
    : 'd.owner_session_id = $2';
  const ownerId = owner.userId ?? owner.sessionId;

  const result = await query<JobRowWithDocument & { filename: string; document_status: string }>(
    `SELECT j.*, d.filename, d.status AS document_status
       FROM processing_jobs j
       JOIN documents d ON d.id = j.document_id
      WHERE j.id = $1 AND ${clause}`,
    [jobId, ownerId],
  );
  return result.rows[0] ?? null;
}
export async function listJobsForDocument(documentId: string): Promise<ProcessingJob[]> {
  const result = await query<JobRowWithDocument>(
    `SELECT * FROM processing_jobs WHERE document_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [documentId],
  );
  return result.rows.map(toJob);
}

export async function listJobs(input: {
  owner: { userId: string | null; sessionId: string | null };
  documentId?: string;
  status?: JobStatus;
  limit: number;
}): Promise<ProcessingJob[]> {
  const ownerId = input.owner.userId ?? input.owner.sessionId;
  const clause = input.owner.userId ? 'd.owner_user_id = $1' : 'd.owner_session_id = $1';
  const params: unknown[] = [ownerId, input.limit];
  const conditions = [clause];

  if (input.documentId) {
    params.push(input.documentId);
    conditions.push(`j.document_id = $${params.length}`);
  }
  if (input.status) {
    params.push(input.status);
    conditions.push(`j.status = $${params.length}`);
  }

  const result = await query<JobRowWithDocument>(
    `SELECT j.* FROM processing_jobs j
       JOIN documents d ON d.id = j.document_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY j.created_at DESC
      LIMIT $2`,
    params,
  );
  return result.rows.map(toJob);
}

/* ── State transitions ───────────────────────────────────────────────────── */

/**
 * QUEUED → PROCESSING.
 *
 * The `WHERE status = 'QUEUED'` guard makes this idempotent under at-least-once
 * delivery: a redelivered envelope for a job already running updates nothing.
 */
export async function markJobStarted(jobId: string): Promise<boolean> {
  const result = await query(
    `UPDATE processing_jobs
        SET status = 'PROCESSING', started_at = COALESCE(started_at, now())
      WHERE id = $1 AND status = 'QUEUED'`,
    [jobId],
  );
  return result.rowCount === 1;
}

export async function updateJobProgress(
  input: { jobId: string; progress: number; stage: JobStage },
): Promise<void> {
  // Progress is monotonic: a late or out-of-order callback must not walk the
  // bar backwards in the UI.
  await query(
    `UPDATE processing_jobs
        SET progress = GREATEST(progress, $2), stage = $3
      WHERE id = $1 AND status = 'PROCESSING'`,
    [input.jobId, input.progress, input.stage],
  );
}

export async function markJobCompleted(
  input: {
    jobId: string;
    metrics: Record<string, unknown>;
    engine: string;
  },
  db: Queryable = { query },
): Promise<void> {
  await db.query(
    `UPDATE processing_jobs
        SET status = 'COMPLETED', progress = 100, stage = 'DONE',
            metrics = $2, engine = $3, completed_at = now(), error = NULL
      WHERE id = $1`,
    [input.jobId, JSON.stringify(input.metrics), input.engine],
  );
}

export async function markJobFailed(jobId: string, error: JobError): Promise<void> {
  await query(
    `UPDATE processing_jobs
        SET status = 'FAILED', error = $2, completed_at = now()
      WHERE id = $1`,
    [jobId, JSON.stringify(error)],
  );
}

/** Increments the attempt counter when a job is redelivered. */
export async function incrementJobAttempts(jobId: string): Promise<void> {
  await query('UPDATE processing_jobs SET attempts = attempts + 1 WHERE id = $1', [jobId]);
}

/**
 * Finds jobs stuck in PROCESSING past `staleAfterMinutes`.
 *
 * With at-least-once delivery a worker can die mid-job and leave a row that
 * never reaches a terminal state. The sweep exists so the UI cannot show a
 * spinner forever; a real deployment would run it on a schedule.
 */
export async function findStaleJobs(staleAfterMinutes = 15): Promise<ProcessingJob[]> {
  const result = await query<JobRowWithDocument>(
    `SELECT * FROM processing_jobs
      WHERE status = 'PROCESSING'
        AND COALESCE(started_at, created_at) < now() - ($1::text || ' minutes')::interval
      ORDER BY created_at ASC
      LIMIT 100`,
    [String(staleAfterMinutes)],
  );
  return result.rows.map(toJob);
}
