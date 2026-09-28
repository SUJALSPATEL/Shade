import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing.
 *
 * scrypt via Node's built-in crypto — no native dependency, no bcrypt build
 * step, and memory-hard by design. Parameters are stored inside the hash
 * string, so raising the cost factor later is a per-user migration rather than
 * a flag day: old hashes keep verifying, and `needsRehash` identifies the ones
 * worth upgrading on next sign-in.
 *
 * Format:  scrypt$N$r$p$<salt-b64url>$<hash-b64url>
 */

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const CURRENT = { N: 16_384, r: 8, p: 1, keylen: 64 } as const;

/**
 * scrypt needs roughly `128 * N * r` bytes (16 MB at the current parameters)
 * plus Node's own overhead, and it throws rather than degrading if `maxmem` is
 * too low. 64 MB leaves headroom without letting a hostile hash string in the
 * database demand unbounded memory.
 */
const MAX_MEM = 64 * 1024 * 1024;
const maxmemFor = (N: number, r: number) => Math.max(MAX_MEM, 256 * N * r);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, CURRENT.keylen, {
    ...CURRENT,
    maxmem: maxmemFor(CURRENT.N, CURRENT.r),
  });
  return [
    'scrypt',
    CURRENT.N,
    CURRENT.r,
    CURRENT.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const saltRaw = parts[4];
  const hashRaw = parts[5];
  if (!saltRaw || !hashRaw) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltRaw, 'base64url');
    expected = Buffer.from(hashRaw, 'base64url');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scrypt(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: maxmemFor(N, r),
  });

  // Lengths match by construction, so this cannot throw.
  return timingSafeEqual(derived, expected);
}

/** True when `stored` uses weaker parameters than the current policy. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < CURRENT.N;
}
