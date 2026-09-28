import type { ArtifactType, Operation } from './constants.js';

/**
 * Storage key layout.
 *
 * Keys are opaque to clients: the API never returns a storage key to the
 * browser, and download URLs are always API-mediated so that ownership can be
 * checked on every read. Keys are derived only from server-generated ids, so
 * a hostile filename can never influence the path (see `sanitizeFilename`).
 *
 *   raw/{ownerId}/{uploadId}/{filename}
 *   artifacts/{documentId}/{operation}/{name}
 *   assets/{documentId}/{filename}
 */
export const storageKeys = {
  /**
   * Raw uploads are keyed by an *upload* id, not a document id.
   *
   * Bytes arrive before the document row exists, and the presign endpoint must
   * decide the destination without knowing what the eventual `documents.id`
   * will be. Keying on the upload keeps those two identities independent — and
   * means a failed upload never leaves a hole in the document id space.
   */
  raw(ownerId: string, uploadId: string, safeFilename: string): string {
    return `raw/${ownerId}/${uploadId}/${safeFilename}`;
  },
  artifact(documentId: string, operation: Operation, name: string): string {
    return `artifacts/${documentId}/${operation.toLowerCase()}/${name}`;
  },
  asset(documentId: string, filename: string): string {
    return `assets/${documentId}/${filename}`;
  },
} as const;

/** Canonical artifact filenames, so readers and writers cannot drift. */
export const artifactNames = {
  markdown: 'document.md',
  json: 'document.json',
  chunks: 'chunks.json',
} as const;

export const ARTIFACT_MIME_TYPES: Record<ArtifactType, string> = {
  MARKDOWN: 'text/markdown; charset=utf-8',
  JSON: 'application/json; charset=utf-8',
  ASSET: 'application/octet-stream',
};

/**
 * Strips directory separators, control characters and anything that is not a
 * conservative filename character. The original filename is preserved
 * separately as display metadata; this value only ever reaches the filesystem.
 */
export function sanitizeFilename(input: string): string {
  // Take the last path segment: defeats `../../etc/passwd` and Windows `C:\`.
  const base = input.split(/[\\/]/).pop() ?? 'document';
  const cleaned = base
    .normalize('NFKD')
    // Collapse everything outside a conservative allow-list into a single dash.
    // This also removes control characters, quotes and shell metacharacters.
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    // A leading dot would produce a hidden file; a leading dash confuses CLIs.
    .replace(/^[-.]+/, '')
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'document';
}

/** Lowercase extension of a filename, without the dot. */
export function fileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx + 1).toLowerCase();
}
