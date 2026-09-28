import { newId } from '@shade/shared';
import type { User } from '@shade/shared';
import { query } from '../db/client.js';
import { hashPassword, needsRehash, verifyPassword } from './password.js';
import { AuthError, type AuthCredentials, type AuthProvider, type RegisterInput } from './provider.js';
import { findUserByEmail, toUser, updateUserPasswordHash, type UserRow } from './sessions.js';

/**
 * Email + password authentication against our own `users` table.
 *
 * Two details worth knowing:
 *
 *  - `authenticate` runs the password hash even when the email is unknown, so
 *    response time does not reveal which addresses have accounts.
 *  - Successful sign-in opportunistically re-hashes when the stored cost
 *    parameters are behind current policy, which is how the scrypt cost factor
 *    gets raised over time without a migration.
 */

/** Hash of a throwaway value, used only to equalise timing on unknown emails. */
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('shade-timing-equaliser-not-a-real-password');
  return dummyHashPromise;
}

export const emailPasswordAuthProvider: AuthProvider = {
  name: 'email-password',

  async register(input: RegisterInput): Promise<User> {
    const email = input.email.trim().toLowerCase();

    const existing = await findUserByEmail(email);
    if (existing) {
      throw new AuthError('EMAIL_IN_USE', 'An account with that email already exists.');
    }

    const passwordHash = await hashPassword(input.password);
    const id = newId('user');

    try {
      const result = await query<UserRow>(
        `INSERT INTO users (id, email, password_hash, name)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [id, email, passwordHash, input.name.trim()],
      );
      const row = result.rows[0];
      if (!row) throw new AuthError('PROVIDER_UNAVAILABLE', 'Account could not be created.');
      return toUser(row);
    } catch (error) {
      // Unique-violation race: two simultaneous signups with the same address.
      if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505') {
        throw new AuthError('EMAIL_IN_USE', 'An account with that email already exists.');
      }
      throw error;
    }
  },

  async authenticate(input: AuthCredentials): Promise<User | null> {
    const email = input.email.trim().toLowerCase();
    const row = await findUserByEmail(email);

    if (!row) {
      await verifyPassword(input.password, await getDummyHash());
      return null;
    }

    const valid = await verifyPassword(input.password, row.password_hash);
    if (!valid) return null;

    if (needsRehash(row.password_hash)) {
      // Best-effort: a failure here must not block a legitimate sign-in.
      void hashPassword(input.password)
        .then((hash) => updateUserPasswordHash(row.id, hash))
        .catch(() => undefined);
    }

    return toUser(row);
  },
};
