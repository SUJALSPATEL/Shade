import {
  DEFAULT_PARSE_INPUT,
  DEFAULT_SPLIT_LIMIT,
  JOB_ERROR_CODES,
  OPERATION_LABELS,
  artifactNames,
  clampProgress,
  storageKeys,
} from '@shade/shared';
import type {
  ActivityType,
  JobCompleteRequest,
  JobEnvelope,
  JobErrorCode,
  JobFailRequest,
  JobProgressRequest,
  Operation,
  ProcessingJob,
  SchemaField,
} from '@shade/shared';
import { config } from '../config/env.js';
import { withTransaction } from '../db/client.js';
import {
  createJob as insertJob,
  findJob,
  markJobCompleted,
  markJobFailed,
  markJobStarted,
  updateJobProgress,
} from '../db/repositories/jobs.js';
import { upsertArtifacts } from '../db/repositories/artifacts.js';
import { recordActivity } from '../db/repositories/activities.js';
import {
  findDocumentRowById,
  updateDocumentAfterProcessing,
  updateDocumentStatus,
} from '../db/repositories/documents.js';
import { consumeAnonymousQuota } from '../auth/sessions.js';
import { errors } from '../http/errors.js';
import { buildJobEnvelope, type JobDispatcher } from '../queue/dispatcher.js';

/**
 * Job orchestration.
 *
 * This module owns the entire job state machine. The HTTP route creates a job
 * and dispatches it; the worker reports progress and completion back through
 * the internal routes, which land here. Nothing else moves a job between
 * states, which is what keeps QUEUED → PROCESSING → COMPLETED meaningful.
 */

export interface JobInputs {
  parseInput?: { extractImages: boolean; keepFurniture: boolean };
  extractInput?: { schemaName: string; fields: SchemaField[] };
  splitInput?: { query: string; limit: number };
}

/**
 * Normalises the optional per-operation blocks into exactly one job input,
 * matching the operation being run.
 *
 * Validating the *combination* here rather than in each route means an EXTRACT
 * job can never be dispatched with no schema, whichever endpoint created it.
 */
export function resolveJobInput(operation: Operation, inputs: JobInputs): Record<string, unknown> {
  switch (operation) {
    case 'PARSE':
      return { ...DEFAULT_PARSE_INPUT, ...(inputs.parseInput ?? {}) };

    case 'EXTRACT': {
      const schema = inputs.extractInput;
      if (!schema || schema.fields.length === 0) {
        throw errors.validation(
          { extractInput: 'Provide a schema with at least one field to run an extraction.' },
        );
      }
      return { schemaName: schema.schemaName, fields: schema.fields };
    }

    case 'SPLIT': {
      const query = inputs.splitInput?.query?.trim();
      if (!query) {
        throw errors.validation({ splitInput: 'Describe what you want to find.' });
      }
      return { query, limit: inputs.splitInput?.limit ?? DEFAULT_SPLIT_LIMIT };
    }

    default: {
      // Exhaustiveness: adding an Operation without a branch is a compile error.
      const never: never = operation;
      throw errors.validation({ operation: `Unsupported operation: ${String(never)}` });
    }
  }
}

export interface CreateJobResult {
  job: ProcessingJob;
  envelope: JobEnvelope;
}

/**
 * Creates and dispatches a job.
 *
 * The document row is locked for the duration of the transaction so two
 * concurrent requests cannot both pass the quota check and both enqueue — the
 * compare-and-swap in `consumeAnonymousQuota` covers the counter, and the
 * row lock covers the status transition that follows it.
 */
export async function createJobForDocument(input: {
  documentId: string;
  owner: { userId: string | null; sessionId: string | null };
  sessionId: string;
  operation: Operation;
  inputs: JobInputs;
  dispatcher: JobDispatcher;
}): Promise<CreateJobResult> {
  const jobInput = resolveJobInput(input.operation, input.inputs);

  const job = await withTransaction(async (tx) => {
    const document = await tx
      .query<{ id: string; filename: string; storage_key: string; mime_type: string; size_bytes: string }>(
        `SELECT id, filename, storage_key, mime_type, size_bytes
           FROM documents
          WHERE id = $1 AND ${input.owner.userId ? 'owner_user_id = $2' : 'owner_session_id = $2'}
          FOR UPDATE`,
        [input.documentId, input.owner.userId ?? input.owner.sessionId],
      )
      .then((result) => result.rows[0]);

    if (!document) throw errors.notFound('Document');

    // Enforce the anonymous first-use limit *before* any work is queued.
    if (!input.owner.userId) {
      const allowed = await consumeAnonymousQuota(input.sessionId, config.auth.anonymousJobQuota, tx);
      if (!allowed) {
        throw errors.quotaExceeded(
          'You have used your free preview. Create an account to keep processing documents.',
        );
      }
    }

    const created = await insertJob(
      { documentId: input.documentId, operation: input.operation, jobInput },
      tx,
    );
    await updateDocumentStatus(input.documentId, 'QUEUED', tx);

    await recordActivity(
      {
        userId: input.owner.userId,
        documentId: input.documentId,
        jobId: created.id,
        type: 'DOCUMENT_UPLOADED',
        message: `Started ${input.operation.toLowerCase()} on ${document.filename}`,
      },
      tx,
    );

    return { created, document };
  });

  const envelope = buildJobEnvelope({
    jobId: job.created.id,
    documentId: job.document.id,
    operation: input.operation,
    jobInput: jobInput as JobEnvelope['input'],
    filename: job.document.filename,
    mimeType: job.document.mime_type,
    sizeBytes: Number(job.document.size_bytes),
    storageKey: job.document.storage_key,
  });

  // Dispatch *after* the transaction commits. Enqueuing inside it would risk a
  // worker picking up a job whose row is not yet visible.
  await input.dispatcher.dispatch(envelope);

  return { job: job.created, envelope };
}

/* ── Worker callbacks ────────────────────────────────────────────────────── */

/**
 * QUEUED → PROCESSING.
 *
 * Called by the worker on pickup. Returns `false` when the job is not in
 * QUEUED — a redelivery, or a job already failed by the stale sweep — which
 * tells the worker to skip it rather than duplicate the work.
 */
export async function startJob(jobId: string): Promise<boolean> {
  const started = await markJobStarted(jobId);
  if (started) {
    const job = await findJob(jobId);
    if (job) await updateDocumentStatus(job.document_id, 'PROCESSING');
  }
  return started;
}

export async function reportProgress(jobId: string, progress: JobProgressRequest): Promise<void> {
  await updateJobProgress({
    jobId,
    progress: clampProgress(progress.progress),
    stage: progress.stage,
  });
}

/**
 * The worker's completion report.
 *
 * The worker has already written the artifact bytes to object storage; this
 * records where they landed, updates the document, and writes the history
 * entry. All of it in one transaction, so a crash cannot leave a COMPLETED job
 * whose artifacts are unrecorded.
 */
export async function completeJob(jobId: string, report: JobCompleteRequest): Promise<void> {
  const job = await findJob(jobId);
  if (!job) throw errors.notFound('Job');
  if (job.status === 'COMPLETED') return; // idempotent under redelivery

  await withTransaction(async (tx) => {
    await upsertArtifacts(
      {
        documentId: job.document_id,
        jobId,
        artifacts: report.artifacts.map((artifact) => ({
          type: artifact.type,
          storageKey: artifact.storageKey,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          label: artifact.label ?? null,
        })),
      },
      tx,
    );

    await markJobCompleted(
      {
        jobId,
        engine: `${report.metadata.engine}@${report.metadata.version}`,
        // `metrics.chunks` is accepted on the wire but deliberately not stored:
        // chunk text belongs to the JSON artifact, not to a relational row.
        metrics: {
          chunkCount: report.metrics.chunkCount,
          assetCount: report.metrics.assetCount,
          tableCount: report.metrics.tableCount,
          markdownBytes: report.metrics.markdownBytes,
          durationMs: report.metadata.durationMs,
          mocked: report.metadata.mocked,
        },
      },
      tx,
    );

    await updateDocumentAfterProcessing(
      {
        documentId: job.document_id,
        status: 'READY',
        pageCount: report.document.pageCount,
        summary: report.document.summary ?? null,
      },
      tx,
    );
  });

  // Activity is recorded outside the transaction: a failure to write a history
  // line must not roll back a completed job.
  const document = await findDocumentRowById(job.document_id);
  await recordActivity({
    userId: document?.owner_user_id ?? null,
    documentId: job.document_id,
    projectId: document?.project_id ?? null,
    jobId,
    type: activityTypeFor(job.operation),
    message: activityMessageFor(job.operation, document?.filename ?? 'document'),
  });
}

export async function failJob(jobId: string, report: JobFailRequest): Promise<void> {
  const job = await findJob(jobId);
  if (!job) throw errors.notFound('Job');
  // Idempotent: a redelivered failure report, or one arriving after the stale
  // sweep already failed the job, must not overwrite the original error.
  if (job.status === 'FAILED' || job.status === 'COMPLETED') return;

  await markJobFailed(jobId, {
    code: normaliseJobErrorCode(report.error.code),
    message: report.error.message,
    retryable: report.error.retryable,
    ...(report.error.detail ? { detail: report.error.detail } : {}),
  });

  await updateDocumentStatus(job.document_id, 'FAILED');

  const document = await findDocumentRowById(job.document_id);
  await recordActivity({
    userId: document?.owner_user_id ?? null,
    documentId: job.document_id,
    projectId: document?.project_id ?? null,
    jobId,
    type: 'JOB_FAILED',
    message: `${OPERATION_LABELS[job.operation]} failed for ${document?.filename ?? 'document'}`,
  });
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * The worker sends the error code as a string so an older API does not reject a
 * newer worker outright. Anything unrecognised becomes PROCESSOR_ERROR, which
 * keeps the UI's error copy meaningful instead of showing a raw token.
 */
function normaliseJobErrorCode(code: string): JobErrorCode {
  return (JOB_ERROR_CODES as readonly string[]).includes(code)
    ? (code as JobErrorCode)
    : 'PROCESSOR_ERROR';
}

function activityTypeFor(operation: Operation): ActivityType {
  switch (operation) {
    case 'PARSE':
      return 'DOCUMENT_PARSED';
    case 'EXTRACT':
      return 'DOCUMENT_EXTRACTED';
    case 'SPLIT':
      return 'DOCUMENT_SPLIT';
  }
}

function activityMessageFor(operation: Operation, filename: string): string {
  switch (operation) {
    case 'PARSE':
      return `Parsed ${filename}`;
    case 'EXTRACT':
      return `Extracted schema from ${filename}`;
    case 'SPLIT':
      return `Searched ${filename}`;
  }
}

/**
 * Canonical artifact keys for an operation.
 *
 * Exported because the worker (which writes) and the API (which reads) must
 * agree exactly — they are what makes `upsertArtifacts` idempotent under
 * at-least-once delivery.
 */
export function artifactKeyFor(
  documentId: string,
  operation: Operation,
  kind: 'markdown' | 'json',
): string {
  const name = kind === 'markdown' ? artifactNames.markdown : jsonArtifactName(operation);
  return storageKeys.artifact(documentId, operation, name);
}

export function jsonArtifactName(operation: Operation): string {
  switch (operation) {
    case 'PARSE':
      return artifactNames.json;
    case 'EXTRACT':
      return 'extract.json';
    case 'SPLIT':
      return 'split.json';
  }
}
