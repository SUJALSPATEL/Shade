import { newId } from '@shade/shared';
import { query, type Queryable } from '../client.js';

/**
 * Upload tickets.
 *
 * The client never proposes a storage key. It asks for a ticket, the server
 * decides where the bytes will live and records what it was told to expect,
 * and the direct-upload endpoint re-validates the real request against that
 * row before writing anything. A client that lies about size or content type
 * gets a 400, not a stored object.
 *
 * Tickets are single-use (`consumed_at`) and short-lived (`expires_at`).
 */

export interface UploadTicketRow {
  id: string;
  owner_user_id: string | null;
  owner_session_id: string | null;
  storage_key: string;
  filename: string;
  mime_type: string;
  declared_bytes: string | number;
  consumed_at: Date | null;
  expires_at: Date;
  created_at: Date;
}

export async function createUploadTicket(
  input: {
    owner: { userId: string | null; sessionId: string | null };
    storageKey: string;
    filename: string;
    mimeType: string;
    declaredBytes: number;
    ttlSeconds: number;
  },
  db: Queryable = { query },
): Promise<UploadTicketRow> {
  const result = await db.query<UploadTicketRow>(
    `INSERT INTO upload_tickets
       (id, owner_user_id, owner_session_id, storage_key, filename, mime_type, declared_bytes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + ($8::text || ' seconds')::interval)
     RETURNING *`,
    [
      newId('ticket'),
      input.owner.userId,
      input.owner.sessionId,
      input.storageKey,
      input.filename,
      input.mimeType,
      input.declaredBytes,
      String(input.ttlSeconds),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Upload ticket insert returned no row');
  return row;
}

export async function findUploadTicket(ticketId: string): Promise<UploadTicketRow | null> {
  const result = await query<UploadTicketRow>('SELECT * FROM upload_tickets WHERE id = $1', [
    ticketId,
  ]);
  return result.rows[0] ?? null;
}

/**
 * Marks a ticket used, atomically.
 *
 * Returns `false` when the ticket was already consumed, expired or owned by
 * someone else. Doing the check and the write in one statement is what makes
 * two concurrent uploads with the same ticket resolve to exactly one winner
 * instead of both passing a read-then-write check.
 */
export async function consumeUploadTicket(
  ticketId: string,
  owner: { userId: string | null; sessionId: string | null },
): Promise<boolean> {
  const ownerId = owner.userId ?? owner.sessionId;
  const ownerClause = owner.userId ? 'owner_user_id = $2' : 'owner_session_id = $2';

  const result = await query(
    `UPDATE upload_tickets
        SET consumed_at = now()
      WHERE id = $1
        AND ${ownerClause}
        AND consumed_at IS NULL
        AND expires_at > now()
      RETURNING id`,
    [ticketId, ownerId],
  );
  return result.rowCount === 1;
}

/**
 * Re-validates a consumed ticket when a document is created from it.
 *
 * Document creation and ticket consumption are separate requests, so this is
 * the point where "you uploaded this, and it was yours" is confirmed before a
 * document row is written.
 */
export async function findConsumedTicketForOwner(
  ticketId: string,
  owner: { userId: string | null; sessionId: string | null },
): Promise<UploadTicketRow | null> {
  const ownerId = owner.userId ?? owner.sessionId;
  const ownerClause = owner.userId ? 'owner_user_id = $2' : 'owner_session_id = $2';

  const result = await query<UploadTicketRow>(
    `SELECT * FROM upload_tickets
      WHERE id = $1 AND ${ownerClause} AND consumed_at IS NOT NULL`,
    [ticketId, ownerId],
  );
  return result.rows[0] ?? null;
}

/** Housekeeping: drop tickets that expired without being used. */
export async function purgeExpiredTickets(): Promise<number> {
  const result = await query(
    `DELETE FROM upload_tickets WHERE expires_at < now() - interval '1 day'`,
  );
  return result.rowCount ?? 0;
}
