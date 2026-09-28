import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config/env.js';

/**
 * Session tokens and signed upload tickets.
 *
 * Both are HMAC-signed with `SHADE_SECRET`, and neither is ever stored in a
 * form that would let a database reader impersonate someone:
 *
 *   session token — random, and only its SHA-256 is persisted. A leaked dump
 *                   yields no usable cookie.
 *   upload ticket — the row is the source of truth (single-use, expiring), and
 *                   the signature is a second lock so a guessed id is useless
 *                   on its own.
 */

/** 256 bits of entropy, base64url so it is cookie- and URL-safe. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  // Plain SHA-256 rather than a password hash: the token is already 256 bits of
  // randomness, so there is nothing to brute-force and lookups must stay cheap.
  return createHmac('sha256', config.auth.secret).update(token).digest('hex');
}

function sign(payload: string): string {
  return createHmac('sha256', config.auth.secret).update(payload).digest('base64url');
}

/**
 * Upload ticket signature. Binds the ticket to its expiry so a signature
 * captured from a log cannot be replayed with a longer lifetime.
 */
export function signUploadTicket(ticketId: string, expiresAtMs: number): string {
  return sign(`upload:${ticketId}:${expiresAtMs}`);
}

export function verifyUploadTicketSignature(
  ticketId: string,
  expiresAtMs: number,
  signature: string,
): boolean {
  const expected = signUploadTicket(ticketId, expiresAtMs);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Builds the direct-upload URL a local-storage presign hands back. */
export function buildLocalUploadUrl(ticketId: string, expiresAtMs: number): string {
  const signature = signUploadTicket(ticketId, expiresAtMs);
  const params = new URLSearchParams({
    expires: String(expiresAtMs),
    signature,
  });
  return `${config.api.publicUrl}/api/uploads/direct/${encodeURIComponent(ticketId)}?${params.toString()}`;
}
