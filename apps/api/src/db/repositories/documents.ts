import { newId } from '@shade/shared';
import type { DocumentStatus, DocumentSummary, DocumentWithJob, ProcessingJob } from '@shade/shared';
import { query, type Queryable } from '../client.js';
import { toJob, type JobRowWithDocument } from './jobs.js';

/**
 * Document persistence.
 *
 * A document row is metadata plus a storage pointer. The `storage_key` column
 * is never selected into an API response — `toDocument` deliberately omits it —
 * so there is no path by which a client learns where bytes live.
 */

export interface DocumentRow {
  id: string;
  project_id: string | null;
  owner_user_id: string | null;
  owner_session_id: string | null;
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: string | number;
  page_count: number | null;
  status: DocumentStatus;
  summary: string | null;
  created_at: Date;
  updated_at: Date;
}

export function toDocument(row: DocumentRow): DocumentSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    pageCount: row.page_count,
    status: row.status,
    summary: row.summary,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** The raw storage pointer, available only to server-side callers. */
export function storageKeyOf(row: DocumentRow): string {
  return row.storage_key;
}

export interface DocumentOwner {
  userId: string | null;
  sessionId: string | null;
}

/**
 * Ownership predicate used by every read.
 *
 * `owner_user_id = $n` alone would let an anonymous session read a document
 * that happens to have a null user id, so the two branches are explicit and
 * mutually exclusive — matching the `documents_single_owner` CHECK constraint.
 */
function ownerClause(owner: DocumentOwner, startIndex: number): { sql: string; params: unknown[] } {
  if (owner.userId) {
    return { sql: `d.owner_user_id = $${startIndex}`, params: [owner.userId] };
  }
  return { sql: `d.owner_session_id = $${startIndex}`, params: [owner.sessionId] };
}

export async function createDocument(
  input: {
    owner: DocumentOwner;
    projectId: string | null;
    filename: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    status?: DocumentStatus;
  },
  db: Queryable = { query },
): Promise<DocumentSummary> {
  const result = await db.query<DocumentRow>(
    `INSERT INTO documents
       (id, project_id, owner_user_id, owner_session_id, filename, storage_key, mime_type, size_bytes, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      newId('document'),
      input.projectId,
      input.owner.userId,
      input.owner.sessionId,
      input.filename,
      input.storageKey,
      input.mimeType,
      input.sizeBytes,
      input.status ?? 'UPLOADED',
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Document insert returned no row');
  return toDocument(row);
}

/** Full row including the storage key — server-side use only. */
export async function findDocumentRow(
  documentId: string,
  owner: DocumentOwner,
): Promise<DocumentRow | null> {
  const clause = ownerClause(owner, 2);
  const result = await query<DocumentRow>(
    `SELECT d.* FROM documents d WHERE d.id = $1 AND ${clause.sql}`,
    [documentId, ...clause.params],
  );
  return result.rows[0] ?? null;
}

/**
 * Unscoped lookup for internal callbacks and background work.
 *
 * Worker callbacks authenticate with the shared worker token rather than a
 * session, so there is no owner to scope against. Keeping this as a separate,
 * explicitly-named function — rather than making `owner` optional on the scoped
 * one — means a request-path call site cannot silently lose its ownership
 * check by passing `undefined`.
 */
export async function findDocumentRowById(documentId: string): Promise<DocumentRow | null> {
  const result = await query<DocumentRow>('SELECT d.* FROM documents d WHERE d.id = $1', [
    documentId,
  ]);
  return result.rows[0] ?? null;
}

/**
 * Document plus its most recent job, in one round trip.
 *
 * `DISTINCT ON` is the PostgreSQL idiom for "latest row per group" and is
 * markedly cheaper here than a correlated subquery per document.
 */
export async function findDocumentWithJob(
  documentId: string,
  owner: DocumentOwner,
): Promise<DocumentWithJob | null> {
  const clause = ownerClause(owner, 2);
  // Typed as a loose row: this select is a document *plus* flattened lateral
  // columns, and `rowsToJobShape` is the single place that knows the aliases.
  const result = await query<Record<string, unknown>>(
    `SELECT d.*,
            j.id            AS job_id,
            j.document_id   AS job_document_id,
            j.operation     AS job_operation,
            j.status        AS job_status,
            j.progress      AS job_progress,
            j.stage         AS job_stage,
            j.input         AS job_input,
            j.error         AS job_error,
            j.metrics       AS job_metrics,
            j.engine        AS job_engine,
            j.attempts      AS job_attempts,
            j.created_at    AS job_created_at,
            j.started_at    AS job_started_at,
            j.completed_at  AS job_completed_at
       FROM documents d
       LEFT JOIN LATERAL (
         SELECT * FROM processing_jobs pj
          WHERE pj.document_id = d.id
          ORDER BY pj.created_at DESC
          LIMIT 1
       ) j ON true
      WHERE d.id = $1 AND ${clause.sql}`,
    [documentId, ...clause.params],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    ...toDocument(row as unknown as DocumentRow),
    latestJob: row.job_id ? toJob(rowsToJobShape(row)) : null,
  };
}

/** Re-shapes the aliased lateral columns back into a `JobRowWithDocument`. */
function rowsToJobShape(row: Record<string, unknown>): JobRowWithDocument {
  return {
    id: row.job_id as string,
    document_id: row.job_document_id as string,
    operation: row.job_operation as JobRowWithDocument['operation'],
    status: row.job_status as JobRowWithDocument['status'],
    progress: row.job_progress as number,
    stage: row.job_stage as JobRowWithDocument['stage'],
    input: (row.job_input ?? {}) as Record<string, unknown>,
    error: (row.job_error ?? null) as JobRowWithDocument['error'],
    metrics: (row.job_metrics ?? null) as JobRowWithDocument['metrics'],
    engine: (row.job_engine ?? null) as string | null,
    attempts: (row.job_attempts ?? 0) as number,
    created_at: row.job_created_at as Date,
    started_at: (row.job_started_at ?? null) as Date | null,
    completed_at: (row.job_completed_at ?? null) as Date | null,
  };
}

export async function listDocuments(input: {
  owner: DocumentOwner;
  projectId?: string | null;
  limit: number;
  cursor?: { createdAt: string; id: string } | null;
}): Promise<DocumentWithJob[]> {
  const clause = ownerClause(input.owner, 1);
  const params: unknown[] = [...clause.params, input.limit];
  const conditions: string[] = [clause.sql];

  if (input.projectId) {
    params.push(input.projectId);
    conditions.push(`d.project_id = $${params.length}`);
  }
  if (input.cursor) {
    params.push(input.cursor.createdAt, input.cursor.id);
    conditions.push(`(d.created_at, d.id) < ($${params.length - 1}::timestamptz, $${params.length})`);
  }

  const result = await query<Record<string, unknown>>(
    `SELECT d.*,
            j.id AS job_id, j.operation AS job_operation, j.status AS job_status,
            j.progress AS job_progress, j.stage AS job_stage, j.error AS job_error,
            j.input AS job_input,
            j.metrics AS job_metrics, j.engine AS job_engine, j.attempts AS job_attempts,
            j.created_at AS job_created_at, j.started_at AS job_started_at,
            j.completed_at AS job_completed_at, j.document_id AS job_document_id
       FROM documents d
       LEFT JOIN LATERAL (
         SELECT * FROM processing_jobs pj
          WHERE pj.document_id = d.id
          ORDER BY pj.created_at DESC
          LIMIT 1
       ) j ON true
      WHERE ${conditions.join(' AND ')}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT $2`,
    params,
  );

  return result.rows.map((row) => {
    const document = toDocument(row as unknown as DocumentRow);
    const latestJob: ProcessingJob | null = row.job_id ? toJob(rowsToJobShape(row)) : null;
    return { ...document, latestJob };
  });
}

export async function updateDocumentStatus(
  documentId: string,
  status: DocumentStatus,
  db: Queryable = { query },
): Promise<void> {
  await db.query('UPDATE documents SET status = $2 WHERE id = $1', [documentId, status]);
}

export async function updateDocumentAfterProcessing(
  input: {
    documentId: string;
    status: DocumentStatus;
    pageCount?: number | null;
    summary?: string | null;
  },
  db: Queryable = { query },
): Promise<void> {
  await db.query(
    `UPDATE documents
        SET status = $2,
            page_count = COALESCE($3, page_count),
            summary = COALESCE($4, summary)
      WHERE id = $1`,
    [input.documentId, input.status, input.pageCount ?? null, input.summary ?? null],
  );
}

export async function assignDocumentToProject(
  documentId: string,
  owner: DocumentOwner,
  projectId: string | null,
): Promise<boolean> {
  const clause = ownerClause(owner, 3);
  const result = await query(
    `UPDATE documents d SET project_id = $2 WHERE d.id = $1 AND ${clause.sql}`,
    [documentId, projectId, ...clause.params],
  );
  return result.rowCount === 1;
}

export async function deleteDocument(documentId: string, owner: DocumentOwner): Promise<boolean> {
  const clause = ownerClause(owner, 2);
  const result = await query(`DELETE FROM documents d WHERE d.id = $1 AND ${clause.sql}`, [
    documentId,
    ...clause.params,
  ]);
  return result.rowCount === 1;
}

/** Distinct operations that have completed for a document, for the UI tabs. */
export async function completedOperations(documentId: string): Promise<string[]> {
  const result = await query<{ operation: string }>(
    `SELECT DISTINCT operation FROM processing_jobs
      WHERE document_id = $1 AND status = 'COMPLETED'`,
    [documentId],
  );
  return result.rows.map((row) => row.operation);
}
