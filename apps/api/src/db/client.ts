import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { config } from '../config/env.js';

/**
 * PostgreSQL access.
 *
 * Deliberately a thin layer over `pg` rather than an ORM: the schema is small,
 * the queries are hand-written SQL that reads like the tables, and there is no
 * generated client to regenerate when a migration lands.
 *
 * Repositories take a `Queryable` rather than reaching for the pool directly,
 * which is what makes multi-statement operations (create document + enqueue
 * job + write activity) runnable inside one transaction.
 */

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
}

export const pool = new Pool({
  connectionString: config.database.url,
  max: config.database.poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Money, counts and byte sizes all fit comfortably; keep bigint as a string
  // rather than silently losing precision on very large artifacts.
  application_name: 'shade-api',
});

pool.on('error', (error) => {
  // An idle client erroring must not take the process down; the pool discards
  // it and the next checkout creates a fresh connection.
  console.error('[db] idle client error', error.message);
});

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, values);
}

/** Runs `fn` inside a transaction, rolling back on any throw. */
export async function withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[db] rollback failed', (rollbackError as Error).message);
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Lightweight readiness probe for `/api/health`. */
export async function checkDatabase(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

/**
 * Cursor helpers.
 *
 * Lists are paginated by `(created_at, id)` descending. The cursor is opaque
 * to clients — it is just those two values, base64url encoded — so the sort
 * key can change later without breaking stored cursors.
 */

export interface Cursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(value: string | undefined | null): Cursor | null {
  if (!value) return null;
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const separator = decoded.indexOf('|');
    if (separator === -1) return null;
    const createdAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (!createdAt || !id || Number.isNaN(new Date(createdAt).getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
