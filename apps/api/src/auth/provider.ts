import type { User } from '@shade/shared';

/**
 * The authentication seam.
 *
 * The application never talks to a password table directly — it talks to an
 * `AuthProvider`. Today the only implementation is email + password backed by
 * our own `users` table. Swapping in Supabase Auth, Auth.js or an enterprise
 * SSO broker means writing one more implementation of this interface and
 * changing one line in `server.ts`; routes, ownership checks, quotas and the
 * activity feed are all expressed in terms of `Principal` and stay untouched.
 *
 * Providers are responsible only for *verifying identity*. Session issuance,
 * cookie handling and anonymous principals are shared concerns and live in
 * `sessions.ts`, so every provider gets the same battle-tested behaviour.
 */

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface RegisterInput extends AuthCredentials {
  name: string;
}

/** Raised when registration cannot proceed for a reason the user can fix. */
export class AuthError extends Error {
  readonly code: 'EMAIL_IN_USE' | 'INVALID_CREDENTIALS' | 'PROVIDER_UNAVAILABLE';

  constructor(code: AuthError['code'], message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export interface AuthProvider {
  /** Identifier used in logs and in the `GET /api/auth/session` payload. */
  readonly name: string;

  /**
   * Creates an account. Throws `AuthError('EMAIL_IN_USE')` if the address is
   * taken. The returned user has no session attached yet.
   */
  register(input: RegisterInput): Promise<User>;

  /**
   * Verifies credentials. Returns `null` — never throws — when they are wrong,
   * so the caller cannot accidentally leak "this email exists" through a
   * different error path than "wrong password".
   */
  authenticate(input: AuthCredentials): Promise<User | null>;
}
