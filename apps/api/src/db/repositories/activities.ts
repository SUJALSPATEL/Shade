import { newId } from '@shade/shared';
import type { Activity, ActivityType } from '@shade/shared';
import { query, type Queryable } from '../client.js';

/**
 * The activity feed.
 *
 * Writes are fire-and-forget: an activity row is a nice-to-have for the
 * history page, and a failure to record one must never fail the operation that
 * caused it. `recordActivity` therefore swallows its own errors after logging.
 *
 * `message` is composed at write time so rendering history is a single indexed
 * read with no joins — the tradeoff is that changing the wording later does not
 * rewrite history, which for an audit-style feed is the correct behaviour.
 */

interface ActivityRow {
  id: string;
  user_id: string | null;
  project_id: string | null;
  document_id: string | null;
  job_id: string | null;
  type: ActivityType;
  message: string;
  created_at: Date;
}

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    documentId: row.document_id,
    jobId: row.job_id,
    type: row.type,
    message: row.message,
    createdAt: row.created_at.toISOString(),
  };
}

export interface RecordActivityInput {
  userId: string | null;
  projectId?: string | null;
  documentId?: string | null;
  jobId?: string | null;
  type: ActivityType;
  message: string;
}

/**
 * Records an activity. Never throws.
 *
 * Anonymous work is recorded with a null `user_id` and claimed later on
 * sign-up (see `claimAnonymousWork`), which is what makes the history feed
 * continuous across the anonymous → authenticated boundary.
 */
export async function recordActivity(
  input: RecordActivityInput,
  db: Queryable = { query },
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO activities (id, user_id, project_id, document_id, job_id, type, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        newId('activity'),
        input.userId,
        input.projectId ?? null,
        input.documentId ?? null,
        input.jobId ?? null,
        input.type,
        input.message,
      ],
    );
  } catch (error) {
    console.error('[activity] failed to record', {
      type: input.type,
      message: (error as Error).message,
    });
  }
}

/**
 * A page of history, newest first.
 *
 * Cursor pagination on `(created_at, id)` rather than OFFSET: the feed is
 * append-heavy, and an offset would skip or repeat rows whenever something new
 * lands between two page fetches.
 */
export async function listActivity(input: {
  userId: string;
  limit: number;
  cursor?: { createdAt: string; id: string } | null;
  projectId?: string | null;
  type?: ActivityType | null;
}): Promise<Activity[]> {
  const params: unknown[] = [input.userId, input.limit];
  const conditions = ['user_id = $1'];

  if (input.projectId) {
    params.push(input.projectId);
    conditions.push(`project_id = $${params.length}`);
  }
  if (input.type) {
    params.push(input.type);
    conditions.push(`type = $${params.length}`);
  }
  if (input.cursor) {
    params.push(input.cursor.createdAt, input.cursor.id);
    conditions.push(
      `(created_at, id) < ($${params.length - 1}::timestamptz, $${params.length})`,
    );
  }

  const result = await query<ActivityRow>(
    `SELECT * FROM activities
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    params,
  );
  return result.rows.map(toActivity);
}

export async function listActivityForDocument(documentId: string): Promise<Activity[]> {
  const result = await query<ActivityRow>(
    `SELECT * FROM activities WHERE document_id = $1 ORDER BY created_at DESC LIMIT 25`,
    [documentId],
  );
  return result.rows.map(toActivity);
}

export async function listActivityForProject(projectId: string, limit = 15): Promise<Activity[]> {
  const result = await query<ActivityRow>(
    `SELECT * FROM activities WHERE project_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [projectId, limit],
  );
  return result.rows.map(toActivity);
}

/** Counts per activity type, for the history page's filter chips. */
export async function activityCounts(userId: string): Promise<Record<string, number>> {
  const result = await query<{ type: string; count: string }>(
    `SELECT type, count(*) AS count FROM activities WHERE user_id = $1 GROUP BY type`,
    [userId],
  );
  return Object.fromEntries(result.rows.map((row) => [row.type, Number(row.count)]));
}
