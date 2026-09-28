import { newId } from '@shade/shared';
import type { Project } from '@shade/shared';
import { query, type Queryable } from '../client.js';

/**
 * Project persistence.
 *
 * Every query is scoped by `user_id` in the WHERE clause rather than fetched
 * and then checked in application code. Ownership is a property of the query,
 * which is the only version of this that survives someone later adding a new
 * call site and forgetting the check.
 */

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  summary: string | null;
  created_at: Date;
  updated_at: Date;
  document_count?: string | number;
  last_activity_at?: Date | null;
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    summary: row.summary,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(row.document_count !== undefined ? { documentCount: Number(row.document_count) } : {}),
    ...(row.last_activity_at !== undefined
      ? { lastActivityAt: row.last_activity_at ? row.last_activity_at.toISOString() : null }
      : {}),
  };
}

export async function createProject(
  input: { userId: string; name: string; summary?: string | null },
  db: Queryable = { query },
): Promise<Project> {
  const result = await db.query<ProjectRow>(
    `INSERT INTO projects (id, user_id, name, summary)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [newId('project'), input.userId, input.name, input.summary ?? null],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Project insert returned no row');
  return toProject(row);
}

export async function findProject(projectId: string, userId: string): Promise<Project | null> {
  const result = await query<ProjectRow>(
    `SELECT * FROM projects WHERE id = $1 AND user_id = $2`,
    [projectId, userId],
  );
  const row = result.rows[0];
  return row ? toProject(row) : null;
}

/**
 * Project list with document counts in one query.
 *
 * A correlated subquery rather than a JOIN + GROUP BY: with an index on
 * `documents(project_id)` this is a cheap index-only scan per project and it
 * avoids the row multiplication that makes a grouped join easy to get wrong.
 */
export async function listProjects(
  input: { userId: string; limit: number; cursor?: { createdAt: string; id: string } | null },
): Promise<Project[]> {
  const params: unknown[] = [input.userId, input.limit];
  let cursorClause = '';

  if (input.cursor) {
    params.push(input.cursor.createdAt, input.cursor.id);
    cursorClause = `AND (p.updated_at, p.id) < ($3::timestamptz, $4)`;
  }

  const result = await query<ProjectRow>(
    `SELECT p.*,
            (SELECT count(*) FROM documents d WHERE d.project_id = p.id) AS document_count,
            (SELECT max(a.created_at) FROM activities a WHERE a.project_id = p.id) AS last_activity_at
       FROM projects p
      WHERE p.user_id = $1
        ${cursorClause}
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT $2`,
    params,
  );

  return result.rows.map(toProject);
}

export async function updateProject(
  input: { projectId: string; userId: string; name?: string; summary?: string | null },
): Promise<Project | null> {
  // COALESCE keeps this a single statement while still allowing an explicit
  // `null` summary to be distinguished from "not provided" via the boolean.
  const result = await query<ProjectRow>(
    `UPDATE projects
        SET name = COALESCE($3, name),
            summary = CASE WHEN $4::boolean THEN $5 ELSE summary END
      WHERE id = $1 AND user_id = $2
      RETURNING *`,
    [
      input.projectId,
      input.userId,
      input.name ?? null,
      input.summary !== undefined,
      input.summary ?? null,
    ],
  );
  const row = result.rows[0];
  return row ? toProject(row) : null;
}

export async function deleteProject(projectId: string, userId: string): Promise<boolean> {
  const result = await query('DELETE FROM projects WHERE id = $1 AND user_id = $2', [
    projectId,
    userId,
  ]);
  return result.rowCount === 1;
}

/** Lightweight stats for the project detail header. */
export async function projectStats(
  projectId: string,
): Promise<{ documentCount: number; parsedCount: number; artifactsBytes: number; lastActivityAt: string | null }> {
  const result = await query<{
    document_count: string;
    parsed_count: string;
    artifacts_bytes: string | null;
  }>(
    `SELECT
       (SELECT count(*) FROM documents d WHERE d.project_id = $1) AS document_count,
       (SELECT count(*) FROM documents d WHERE d.project_id = $1 AND d.status = 'READY') AS parsed_count,
       (SELECT COALESCE(sum(a.size_bytes), 0)
          FROM artifacts a
          JOIN documents d ON d.id = a.document_id
         WHERE d.project_id = $1) AS artifacts_bytes`,
    [projectId],
  );

  const activity = await query<{ created_at: Date | null }>(
    `SELECT max(created_at) AS created_at FROM activities WHERE project_id = $1`,
    [projectId],
  );

  const row = result.rows[0];
  return {
    documentCount: Number(row?.document_count ?? 0),
    parsedCount: Number(row?.parsed_count ?? 0),
    artifactsBytes: Number(row?.artifacts_bytes ?? 0),
    lastActivityAt: activity.rows[0]?.created_at?.toISOString() ?? null,
  };
}
