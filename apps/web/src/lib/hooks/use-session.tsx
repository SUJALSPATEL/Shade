'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { SessionResponse } from '@shade/shared';
import { auth } from '../endpoints';
import { ApiError } from '@shade/shared';

/**
 * Who is using the app right now.
 *
 * The session is fetched once and shared, rather than fetched per screen. That
 * matters for more than request count: anonymous usage is metered by the server,
 * so two screens each fetching their own copy can disagree about how many jobs
 * are left, and a user who uploads a file while the dashboard still shows the
 * pre-upload count has been lied to by their own UI.
 *
 * The session is *not* read from `localStorage` or a cookie the client can see.
 * The cookie is `httpOnly` by design, so the only way to know who you are is to
 * ask the server — which is also the only way to know the answer is still true.
 */

export type SessionStatus = 'loading' | 'ready' | 'error';

interface SessionContextValue {
  status: SessionStatus;
  session: SessionResponse | null;
  /** Set when the initial fetch failed. Not set for a 401 — that is a valid state. */
  error: ApiError | null;
  isAuthenticated: boolean;
  isAnonymous: boolean;
  /** Re-reads the session. Used after sign-in, sign-out and a claimed upload. */
  refresh: () => Promise<SessionResponse | null>;
  /** Replaces the session from a response the caller already has. */
  adopt: (session: SessionResponse) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [error, setError] = useState<ApiError | null>(null);

  // Guards against a `refresh()` resolving after the provider unmounted, and
  // against two overlapping refreshes racing to set state.
  const mounted = useRef(true);
  const inFlight = useRef<Promise<SessionResponse | null> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<SessionResponse | null> => {
    // Coalesce concurrent callers onto one request. Several components mount at
    // once on a cold load and all want the session; without this, the workspace
    // and the sidebar would each issue their own.
    if (inFlight.current) return inFlight.current;

    const promise = (async () => {
      try {
        const next = await auth.session();
        if (!mounted.current) return next;
        setSession(next);
        setError(null);
        setStatus('ready');
        return next;
      } catch (cause) {
        if (!mounted.current) return null;
        // A 401 from the session endpoint is not an error state: it means the
        // cookie is absent or expired, which the API answers by minting a fresh
        // anonymous session. Anything else — a dead API, a 500 — is a real
        // failure, and the app has to say so rather than render as signed-out.
        const apiError = cause instanceof ApiError ? cause : null;
        setError(apiError);
        setStatus(apiError?.requiresAuth ? 'ready' : 'error');
        return null;
      } finally {
        inFlight.current = null;
      }
    })();

    inFlight.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const adopt = useCallback((next: SessionResponse) => {
    setSession(next);
    setError(null);
    setStatus('ready');
  }, []);

  const signOut = useCallback(async () => {
    await auth.logout();
    // The API answers logout by issuing a fresh anonymous session rather than
    // leaving the caller identity-less, so the correct post-logout state is a
    // re-read — not a hard-coded `null`.
    await refresh();
  }, [refresh]);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      session,
      error,
      isAuthenticated: session?.principal.kind === 'USER',
      isAnonymous: session?.principal.kind === 'ANONYMOUS',
      refresh,
      adopt,
      signOut,
    }),
    [status, session, error, refresh, adopt, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used inside <SessionProvider>.');
  }
  return context;
}
