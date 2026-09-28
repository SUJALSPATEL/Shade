import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/env.js';
import { errors } from '../http/errors.js';
import { createSession, resolvePrincipal } from './sessions.js';
import type { Principal } from '@shade/shared';

/**
 * Principal resolution.
 *
 * Registered as an `onRequest` hook so that by the time any route handler runs,
 * `request.principal` is populated — either a signed-in user or an anonymous
 * session created on the spot for a first-time visitor.
 *
 * Auto-issuing an anonymous session here (rather than making the client call an
 * endpoint first) is what lets the landing page drop someone straight into a
 * focused workspace with no ceremony: their very first `POST /api/uploads/presign`
 * already has a principal, a quota, and an owner for the resulting document.
 *
 * Paths under `/api/internal/` are skipped: those are worker callbacks
 * authenticated by a shared token, and issuing them a session cookie would be
 * both meaningless and noisy.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated for every non-internal route. */
    principal: Principal;
    /** Raw session token; needed only when rotating or clearing the cookie. */
    sessionToken: string | null;
  }
}

const INTERNAL_PREFIX = '/api/internal/';

export function registerAuth(app: FastifyInstance): void {
  // `null` is the pre-hook placeholder; the `onRequest` hook below always
  // assigns a real principal before any handler runs.
  app.decorateRequest('principal', null as unknown as Principal);
  app.decorateRequest('sessionToken', null);

  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith(INTERNAL_PREFIX)) return;

    const token = readCookie(request, config.auth.cookieName);

    if (token) {
      const principal = await resolvePrincipal(token);
      if (principal) {
        request.principal = principal;
        request.sessionToken = token;
        return;
      }
      // Expired or revoked: clear the stale cookie so the browser stops
      // sending it on every subsequent request.
      clearSessionCookie(reply);
    }

    const issued = await createSession(
      { kind: 'ANONYMOUS' },
      request.headers['user-agent'] ?? null,
    );
    setSessionCookie(reply, issued.token, issued.expiresAt);

    request.principal = {
      kind: 'ANONYMOUS',
      userId: null,
      sessionId: issued.sessionId,
      email: null,
      name: null,
      jobsRemaining: config.auth.anonymousJobQuota,
    };
    request.sessionToken = issued.token;
  });
}

function readCookie(request: FastifyRequest, name: string): string | null {
  const value = request.cookies?.[name];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(config.auth.cookieName, token, {
    path: '/',
    httpOnly: true,
    // `lax` rather than `strict`: the OAuth-style redirect flows a future auth
    // provider will add need the cookie to survive a top-level navigation.
    sameSite: 'lax',
    secure: config.isProduction,
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(config.auth.cookieName, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
  });
}

/* ── Route-level guards ──────────────────────────────────────────────────── */

/** Returns the signed-in user id, or throws a 401 envelope. */
export function requireUser(request: FastifyRequest): string {
  const principal = request.principal;
  if (!principal || principal.kind !== 'USER' || !principal.userId) {
    throw errors.unauthenticated();
  }
  return principal.userId;
}

/**
 * The owner tuple every repository takes.
 *
 * Deriving it in one place is what stops "who owns this?" from being
 * re-derived — and mis-derived — at each call site.
 */
export function ownerOf(request: FastifyRequest): {
  userId: string | null;
  sessionId: string | null;
} {
  const principal = request.principal;
  if (principal.kind === 'USER' && principal.userId) {
    return { userId: principal.userId, sessionId: null };
  }
  return { userId: null, sessionId: principal.sessionId };
}

/**
 * The user id to attribute activity to.
 *
 * Anonymous work is recorded with a null user so it can be claimed on sign-up;
 * passing the session id here would make it invisible to the account that
 * later adopts those documents.
 */
export function activityUserId(request: FastifyRequest): string | null {
  return request.principal.kind === 'USER' ? request.principal.userId : null;
}
