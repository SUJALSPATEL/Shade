import { newId } from '@shade/shared';
import type { Artifact, ArtifactType, Operation } from '@shade/shared';
import { query, type Queryable } from '../client.js';

/**
 * Artifact metadata.
 *
 * This table is a *pointer index*, never a payload store. An artifact row says
 * "a Markdown document of 8,412 bytes lives at this key"; the bytes themselves
 * are in object storage. That split is what keeps the database small enough to
 * back up frequently and the artifacts large enough to be useful.
 */

interface ArtifactRow {
  id: string;
  document_id: string;
  job_id: string | null;
  type: ArtifactType;
  storage_key: string;
  mime_type: string;
  size_bytes: string | number;
  label: string | null;
  created_at: Date;
}

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    documentId: row.document_id,
    jobId: row.job_id,
    type: row.type,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    label: row.label,
    createdAt: row.created_at.toISOString(),
  };
}

export interface ArtifactUpsert {
  type: ArtifactType;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  label?: string | null;
}

/**
 * Idempotent write, keyed on `storage_key`.
 *
 * Job delivery is at-least-once, so the same artifact can be reported twice —
 * by a retry, or by a worker that completed the work but failed to acknowledge
 * it. Storage keys are deterministic per (document, operation, filename), so
 * the unique constraint turns a duplicate report into an update rather than a
 * second row.
 */
export async function upsertArtifacts(
  input: { documentId: string; jobId: string; artifacts: ArtifactUpsert[] },
  db: Queryable = { query },
): Promise<Artifact[]> {
  const written: Artifact[] = [];

  for (const artifact of input.artifacts) {
    const result = await db.query<ArtifactRow>(
      `INSERT INTO artifacts (id, document_id, job_id, type, storage_key, mime_type, size_bytes, label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (storage_key) DO UPDATE
         SET job_id = EXCLUDED.job_id,
             mime_type = EXCLUDED.mime_type,
             size_bytes = EXCLUDED.size_bytes,
             label = EXCLUDED.label,
             created_at = now()
       RETURNING *`,
      [
        newId('artifact'),
        input.documentId,
        input.jobId,
        artifact.type,
        artifact.storageKey,
        artifact.mimeType,
        artifact.sizeBytes,
        artifact.label ?? null,
      ],
    );
    const row = result.rows[0];
    if (row) written.push(toArtifact(row));
  }

  return written;
}

export async function listArtifacts(documentId: string): Promise<Artifact[]> {
  const result = await query<ArtifactRow>(
    `SELECT * FROM artifacts WHERE document_id = $1 ORDER BY created_at DESC`,
    [documentId],
  );
  return result.rows.map(toArtifact);
}

/**
 * Finds an artifact by type, optionally scoped to an operation.
 *
 * Scoping by operation matters once a document has been parsed *and* extracted:
 * both write a JSON artifact, and the caller wants the one belonging to the
 * operation it asked for.
 */
export async function findArtifact(
  documentId: string,
  type: ArtifactType,
  operation?: Operation,
): Promise<Artifact | null> {
  if (operation) {
    const result = await query<ArtifactRow>(
      `SELECT a.* FROM artifacts a
         JOIN processing_jobs j ON j.id = a.job_id
        WHERE a.document_id = $1 AND a.type = $2 AND j.operation = $3
        ORDER BY a.created_at DESC
        LIMIT 1`,
      [documentId, type, operation],
    );
    const row = result.rows[0];
    if (row) return toArtifact(row);
  }

  const result = await query<ArtifactRow>(
    `SELECT * FROM artifacts
      WHERE document_id = $1 AND type = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [documentId, type],
  );
  const row = result.rows[0];
  return row ? toArtifact(row) : null;
}

export async function listAssets(documentId: string): Promise<Artifact[]> {
  const result = await query<ArtifactRow>(
    `SELECT * FROM artifacts WHERE document_id = $1 AND type = 'ASSET' ORDER BY label ASC`,
    [documentId],
  );
  return result.rows.map(toArtifact);
}

/**
 * Finds a single asset by the filename the generated Markdown references.
 *
 * The name arrives from a URL path segment, which is exactly the kind of input
 * that turns into a path traversal when it is concatenated into a storage key.
 * It never is: the lookup is a parameterised equality against the `label`
 * column, and the storage key that gets read comes from the matched row. A name
 * like `../../etc/passwd` simply matches nothing.
 */
export async function findAssetByName(documentId: string, name: string): Promise<Artifact | null> {
  const result = await query<ArtifactRow>(
    `SELECT * FROM artifacts
      WHERE document_id = $1 AND type = 'ASSET' AND label = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [documentId, name],
  );
  const row = result.rows[0];
  return row ? toArtifact(row) : null;
}

/** Total bytes stored for a document — used by the project stats header. */
export async function artifactsSizeForDocument(documentId: string): Promise<number> {
  const result = await query<{ total: string | null }>(
    `SELECT COALESCE(sum(size_bytes), 0) AS total FROM artifacts WHERE document_id = $1`,
    [documentId],
  );
  return Number(result.rows[0]?.total ?? 0);
}

/**
 * Storage keys for a document, used when deleting it so the caller can clean
 * up object storage after the row is gone.
 */
export async function storageKeysForDocument(documentId: string): Promise<string[]> {
  const result = await query<{ storage_key: string }>(
    'SELECT storage_key FROM artifacts WHERE document_id = $1',
    [documentId],
  );
  return result.rows.map((row) => row.storage_key);
}
