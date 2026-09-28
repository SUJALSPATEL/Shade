import type { FastifyInstance } from 'fastify';
import { signInRequestSchema, signUpRequestSchema } from '@shade/shared/contracts';
import type { SessionResponse } from '@shade/shared';
import { config } from '../config/env.js';
import { emailPasswordAuthProvider } from '../auth/email-password.js';
import { AuthError } from '../auth/provider.js';
import {
  claimAnonymousWork,
  createSession,
  deleteSession,
} from '../auth/sessions.js';
import {
  clearSessionCookie,
  ownerOf,
  requireUser,
  setSessionCookie,
} from '../auth/plugin.js';
import { errors } from '../http/errors.js';
import { parseBody } from '../http/validate.js';

/**
 * Authentication routes.
 *
 * The provider swap point is deliberately visible here: these handlers call
 * `emailPasswordAuthProvider` through the `AuthProvider` interface, so moving
 * to Supabase or Auth.js replaces the import and nothing else. Session
 * issuance, cookies and anonymous claiming are provider-independent and are
 * shared by every implementation.
 */

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  /** Current principal — a user, or the anonymous session the browser holds. */
  app.get('/api/auth/session', async (request) => {
    const principal = request.principal;
    const user = principal.userId
      ? {
          id: principal.userId,
          email: principal.email ?? '',
          name: principal.name ?? '',
          createdAt: '',
          updatedAt: '',
        }
      : null;

    const response: SessionResponse = {
      principal,
      user,
      jobsRemaining: principal.jobsRemaining,
    };
    return response;
  });

  app.post('/api/auth/register', async (request, reply) => {
    const input = parseBody(signUpRequestSchema, request.body);
    const anonymousSessionId = request.principal.sessionId;

    let user;
    try {
      user = await emailPasswordAuthProvider.register(input);
    } catch (error) {
      if (error instanceof AuthError && error.code === 'EMAIL_IN_USE') {
        throw errors.validation({ email: 'An account with that email already exists.' });
      }
      throw error;
    }

    // Everything the visitor did before signing up follows them into the
    // account: documents are re-parented, activity is attributed, and their
    // first parse is already waiting in the workspace.
    const claimedDocumentCount = await claimAnonymousWork(anonymousSessionId, user.id);

    const session = await createSession({ kind: 'USER', userId: user.id }, request.headers['user-agent'] ?? null);
    setSessionCookie(reply, session.token, session.expiresAt);

    const response: SessionResponse = {
      principal: {
        kind: 'USER',
        userId: user.id,
        sessionId: session.sessionId,
        email: user.email,
        name: user.name,
        jobsRemaining: null,
      },
      user,
      jobsRemaining: null,
      claimedDocumentCount,
    };
    return reply.code(201).send(response);
  });

  app.post('/api/auth/login', async (request, reply) => {
    const input = parseBody(signInRequestSchema, request.body);
    const anonymousSessionId = request.principal.sessionId;

    const user = await emailPasswordAuthProvider.authenticate(input);
    if (!user) {
      // Same error shape for "no such account" and "wrong password" — the
      // client cannot distinguish them, and neither can an attacker.
      throw errors.validation({ password: 'That email and password combination is not recognised.' });
    }

    const claimedDocumentCount = await claimAnonymousWork(anonymousSessionId, user.id);

    const session = await createSession({ kind: 'USER', userId: user.id }, request.headers['user-agent'] ?? null);
    setSessionCookie(reply, session.token, session.expiresAt);

    const response: SessionResponse = {
      principal: {
        kind: 'USER',
        userId: user.id,
        sessionId: session.sessionId,
        email: user.email,
        name: user.name,
        jobsRemaining: null,
      },
      user,
      jobsRemaining: null,
      claimedDocumentCount,
    };
    return response;
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const principal = request.principal;
    if (principal.kind === 'USER') {
      await deleteSession(principal.sessionId);
    }
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  /** Who am I, in the form the dashboard shell needs. */
  app.get('/api/auth/me', async (request) => {
    const userId = requireUser(request);
    const owner = ownerOf(request);
    return { userId, owner, quota: config.auth.anonymousJobQuota };
  });
}
