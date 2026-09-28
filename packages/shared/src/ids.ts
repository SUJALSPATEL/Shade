/**
 * Prefixed, opaque entity ids.
 *
 * A prefix makes ids self-describing in logs and error reports (`doc_...`
 * vs `job_...`), which matters once a CLI and webhooks are in the picture.
 *
 * This module is imported by both the Node API and the browser, so it uses the
 * global Web Crypto API rather than `node:crypto`. Both Node 19+ and every
 * supported browser provide `crypto.randomUUID()`; the fallback exists only so
 * a non-secure-context browser does not hard-crash the module.
 */

export const ID_PREFIXES = {
  user: 'usr',
  session: 'ses',
  project: 'prj',
  document: 'doc',
  job: 'job',
  artifact: 'art',
  activity: 'act',
  schema: 'sch',
  ticket: 'tkt',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

function randomToken(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID().replace(/-/g, '');
  }
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Last resort. Never reached in a supported runtime; keeps the module total.
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`.padEnd(32, '0');
}

export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${randomToken()}`;
}

export function isIdOfKind(id: string, kind: IdKind): boolean {
  return id.startsWith(`${ID_PREFIXES[kind]}_`);
}

/**
 * Upload tickets are short-lived bearer tokens embedded in a local upload URL.
 * They are signed and verified by the API (see `auth/tickets.ts`), not trusted
 * as-is — this only mints the random component.
 */
export function newTicketNonce(): string {
  return randomToken();
}
