import type { QueryResultRow } from 'pg';
import { config } from '../config/env.js';
import { newId } from '@shade/shared';
import type { Principal, User } from '@shade/shared';
import { query, type Queryable } from '../db/client.js';
import { generateSessionToken, hashSessionToken } from './tokens.js';

/**
 * Session persistence and principal resolution.
 *
 * A "principal" is whoever the request is acting as — a signed-in user or an
 * anonymous browser session with a usage quota. Everything downstream
 * (ownership checks, activity attribution, the job quota) reads the principal
 * and never the raw cookie, so the two kinds stay interchangeable.
 */

interface SessionRow extends QueryResultRow {
  id: string;
  kind: 'USER' | 'ANONYMOUS';
  user_id: string | null;
  jobs_used: number;
  expires_at: Date;
  email: string | null;
  name: string | null;
}

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface IssuedSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

/**
 * Creates a session row and returns the raw token exactly once. The caller is
 * responsible for putting it in an HttpOnly cookie; it is never retrievable
 * again.
 */
export async function createSession(
  input: { kind: 'USER'; userId: string } | { kind: 'ANONYMOUS' },
  userAgent: string | null,
  db: Queryable = { query },
): Promise<IssuedSession> {
  const sessionId = newId('session');
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + config.auth.sessionTtlDays * 24 * 60 * 60 * 1000);

  await db.query(
    `INSERT INTO sessions (id, kind, user_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, input.kind, input.kind === 'USER' ? input.userId : null, tokenHash, userAgent, expiresAt],
  );

  return { sessionId, token, expiresAt };
}

/**
 * Resolves a raw cookie value into a principal, or `null` when the token is
 * unknown, expired or belongs to a deleted user.
 *
 * `jobsRemaining` is computed here rather than at the call site so every
 * enforcement point uses the same arithmetic.
 */
export async function resolvePrincipal(token: string): Promise<Principal | null> {
  const tokenHash = hashSessionToken(token);

  const result = await query<SessionRow>(
    `SELECT s.id, s.kind, s.user_id, s.jobs_used, s.expires_at,
            u.email, u.name
       FROM sessions s
       LEFT JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND (s.kind = 'ANONYMOUS' OR u.id IS NOT NULL)`,
    [tokenHash],
  );

  const row = result.rows[0];
  if (!row) return null;

  // Sliding expiry: an active session should not expire mid-use, but we only
  // touch the row on read rather than on every request path.
  void query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.id]).catch(() => undefined);

  const jobsRemaining =
    row.kind === 'ANONYMOUS'
      ? Math.max(0, config.auth.anonymousJobQuota - row.jobs_used)
      : null;

  return {
    kind: row.kind,
    userId: row.user_id,
    sessionId: row.id,
    email: row.email,
    name: row.name,
    jobsRemaining,
  };
}

/**
 * Consumes one unit of an anonymous session's quota.
 *
 * Returns `false` when the quota is already spent. The `WHERE jobs_used < $2`
 * guard makes this a compare-and-swap, so two concurrent job creations cannot
 * both slip past the limit — the check and the increment are one statement.
 */
export async function consumeAnonymousQuota(
  sessionId: string,
  limit: number,
  db: Queryable = { query },
): Promise<boolean> {
  const result = await db.query(
    `UPDATE sessions
        SET jobs_used = jobs_used + 1
      WHERE id = $1 AND kind = 'ANONYMOUS' AND jobs_used < $2
      RETURNING id`,
    [sessionId, limit],
  );
  return result.rowCount === 1;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

/** Housekeeping for `/api/health` operators and a future cron. */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await query('DELETE FROM sessions WHERE expires_at < now()');
  return result.rowCount ?? 0;
}

/**
 * Re-parents everything an anonymous session created onto a real account.
 *
 * This is what makes the "try it, then sign up" flow feel continuous: the
 * document a visitor parsed before signing in is already in their workspace,
 * with its jobs, artifacts and history intact.
 */
export async function claimAnonymousWork(sessionId: string, userId: string): Promise<number> {
  const documents = await query(
    `UPDATE documents
        SET owner_user_id = $2, owner_session_id = NULL
      WHERE owner_session_id = $1
      RETURNING id`,
    [sessionId, userId],
  );

  await query(
    `UPDATE upload_tickets
        SET owner_user_id = $2, owner_session_id = NULL
      WHERE owner_session_id = $1`,
    [sessionId, userId],
  );

  await query(
    `UPDATE activities
        SET user_id = $2
      WHERE user_id IS NULL
        AND document_id IN (SELECT id FROM documents WHERE owner_user_id = $2)`,
    [userId],
  );

  // The anonymous session has served its purpose; the user now has a real one.
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);

  return documents.rowCount ?? 0;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await query<UserRow>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  return result.rows[0] ?? null;
}

export async function findUserById(userId: string): Promise<UserRow | null> {
  const result = await query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows[0] ?? null;
}

export async function updateUserPasswordHash(userId: string, passwordHash: string): Promise<void> {
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
}

export type { UserRow };
