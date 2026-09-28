import type {
  Artifact,
  ChunksResponse,
  JsonArtifactResponse,
  MarkdownArtifactResponse,
  Operation,
  ParseResult,
} from '@shade/shared';
import { PAGE_GEOMETRY } from '@shade/shared/mock';
import { findArtifact, findAssetByName } from '../db/repositories/artifacts.js';
import { findDocumentRow, type DocumentOwner, type DocumentRow } from '../db/repositories/documents.js';
import { errors } from '../http/errors.js';
import { getStorage } from '../storage/index.js';

/**
 * Artifact reads.
 *
 * Every one of these is a two-step operation: look up where the bytes live,
 * then fetch them. The storage key never leaves the server — the caller gets
 * the payload, or a typed error explaining why it is not ready yet.
 *
 * Each entry point takes an `owner` and resolves the document through the
 * ownership-scoped repository. That is deliberate: reading an artifact must be
 * exactly as hard to get wrong as reading a document, and the only way to
 * guarantee that is for the scoped lookup to be the only one in the signature.
 *
 * `ARTIFACT_NOT_READY` is a distinct code from `NOT_FOUND` on purpose: "you
 * have not run this operation yet" and "this document does not exist" are
 * different states, and the UI renders them differently (an empty state with a
 * Run button, versus an error).
 */

async function readArtifactPayload<T>(artifact: Artifact): Promise<T> {
  const storage = getStorage();
  let buffer: Buffer;
  try {
    buffer = await storage.get(artifact.storageKey);
  } catch (error) {
    throw errors.storage(
      `Could not read the ${artifact.type.toLowerCase()} artifact from storage.`,
      error,
    );
  }

  try {
    return JSON.parse(buffer.toString('utf8')) as T;
  } catch (error) {
    throw errors.internal(`Artifact ${artifact.label ?? artifact.id} is not valid JSON.`, error);
  }
}

/** Resolves the document through the ownership-scoped lookup, or 404s. */
async function requireOwnedDocument(documentId: string, owner: DocumentOwner): Promise<DocumentRow> {
  const document = await findDocumentRow(documentId, owner);
  if (!document) throw errors.notFound('Document');
  return document;
}

/** Resolves an artifact for a document, with a sharp error when it is missing. */
async function requireArtifact(
  documentId: string,
  type: 'MARKDOWN' | 'JSON',
  operation: Operation,
  notReadyMessage: string,
): Promise<Artifact> {
  const artifact = await findArtifact(documentId, type, operation);
  if (!artifact) throw errors.artifactNotReady(notReadyMessage);
  return artifact;
}

export async function getMarkdown(
  documentId: string,
  owner: DocumentOwner,
  operation: Operation = 'PARSE',
): Promise<MarkdownArtifactResponse> {
  const document = await requireOwnedDocument(documentId, owner);

  const artifact = await requireArtifact(
    documentId,
    'MARKDOWN',
    operation,
    `This document has not been ${operation.toLowerCase()}d yet.`,
  );

  const storage = getStorage();
  const buffer = await storage.get(artifact.storageKey);

  return {
    documentId,
    filename: document.filename,
    markdown: buffer.toString('utf8'),
    bytes: buffer.byteLength,
    generatedAt: artifact.createdAt,
  };
}

/**
 * The secondary representation.
 *
 * For a Parse job this returns the full structured payload — document
 * descriptor, chunks, the node tree, assets and processor metadata — which is
 * everything the JSON tab and the preview overlay need in one request.
 */
export async function getStructuredJson(
  documentId: string,
  owner: DocumentOwner,
  operation: Operation = 'PARSE',
): Promise<JsonArtifactResponse> {
  const document = await requireOwnedDocument(documentId, owner);

  const artifact = await requireArtifact(
    documentId,
    'JSON',
    operation,
    `This document has not been ${operation.toLowerCase()}d yet.`,
  );

  const payload = await readArtifactPayload<Partial<ParseResult>>(artifact);

  return {
    documentId,
    filename: document.filename,
    json: payload.json ?? { title: null, page_count: 0, sections: [], tables: [], assets: [] },
    chunks: payload.chunks ?? [],
    assets: payload.assets ?? [],
    metadata: payload.metadata ?? null,
  };
}

/**
 * Detection regions, for the preview overlay.
 *
 * Reads from the Parse artifact rather than a table: chunks are document
 * content, and the storage rule says document content does not live in
 * PostgreSQL. They are small enough to read whole and are only requested by
 * the workspace that is already displaying the document.
 */
export async function getChunks(
  documentId: string,
  owner: DocumentOwner,
): Promise<ChunksResponse> {
  const document = await requireOwnedDocument(documentId, owner);

  const artifact = await findArtifact(documentId, 'JSON', 'PARSE');
  if (!artifact) {
    throw errors.artifactNotReady('Parse this document to see its detected regions.');
  }

  const payload = await readArtifactPayload<{ chunks?: ParseResult['chunks'] }>(artifact);
  const chunks = payload.chunks ?? [];

  // Page geometry comes from the processor's fixture in this milestone. A real
  // engine reports per-page dimensions in the same artifact, so this becomes a
  // read of `payload.pages` rather than a constant.
  const pageCount = Math.max(
    document.page_count ?? 0,
    chunks.reduce((max, chunk) => Math.max(max, chunk.page_number), 0),
  );

  return {
    documentId,
    pageCount,
    chunks,
    pages: PAGE_GEOMETRY.slice(0, Math.max(pageCount, 1)),
  };
}

/** Lightweight check used by the workspace to decide which tabs to enable. */
export async function artifactAvailability(
  documentId: string,
  owner: DocumentOwner,
): Promise<{ markdown: boolean; json: boolean; chunks: number }> {
  await requireOwnedDocument(documentId, owner);

  const [markdown, json] = await Promise.all([
    findArtifact(documentId, 'MARKDOWN', 'PARSE'),
    findArtifact(documentId, 'JSON', 'PARSE'),
  ]);

  if (!json) return { markdown: Boolean(markdown), json: false, chunks: 0 };

  try {
    const payload = await readArtifactPayload<{ chunks?: unknown[] }>(json);
    return { markdown: Boolean(markdown), json: true, chunks: payload.chunks?.length ?? 0 };
  } catch {
    return { markdown: Boolean(markdown), json: true, chunks: 0 };
  }
}

/** Streams the raw uploaded file for the PDF preview. */
export async function getRawUpload(documentId: string, owner: DocumentOwner) {
  const document = await requireOwnedDocument(documentId, owner);

  const storage = getStorage();
  try {
    const object = await storage.getStream(document.storage_key);
    return { object, document };
  } catch (error) {
    throw errors.storage('The original upload could not be read from storage.', error);
  }
}

/**
 * Streams an extracted asset — the figures the generated Markdown references.
 *
 * Without this the Markdown's image links are dead: the file names a figure and
 * there is nowhere to fetch it from. Serving assets through the same ownership
 * check as everything else is what keeps that reference meaningful rather than
 * a note the reader has to take on trust.
 */
export async function getAssetStream(documentId: string, owner: DocumentOwner, name: string) {
  await requireOwnedDocument(documentId, owner);

  const asset = await findAssetByName(documentId, name);
  if (!asset) throw errors.notFound('Asset');

  const storage = getStorage();
  try {
    const object = await storage.getStream(asset.storageKey);
    return { object, asset };
  } catch (error) {
    throw errors.storage('That asset could not be read from storage.', error);
  }
}

export { readArtifactPayload };
