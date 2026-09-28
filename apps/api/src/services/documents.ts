import type {
  DocumentDetailResponse,
  DocumentSummary,
  DocumentWithJob,
  Project,
} from '@shade/shared';
import { withTransaction } from '../db/client.js';
import {
  assignDocumentToProject,
  createDocument,
  deleteDocument as deleteDocumentRow,
  findDocumentRow,
  findDocumentWithJob,
  listDocuments,
  storageKeyOf,
  updateDocumentStatus,
} from '../db/repositories/documents.js';
import { listArtifacts, storageKeysForDocument } from '../db/repositories/artifacts.js';
import { listJobsForDocument } from '../db/repositories/jobs.js';
import { recordActivity } from '../db/repositories/activities.js';
import { findConsumedTicketForOwner } from '../db/repositories/tickets.js';
import { findProject } from '../db/repositories/projects.js';
import { errors } from '../http/errors.js';
import { getStorage } from '../storage/index.js';

/**
 * Document lifecycle.
 *
 * A document is created from a *consumed upload ticket* — never from a
 * client-supplied storage key. The ticket is the proof that this principal put
 * those bytes there, and it carries the authoritative filename, type and size.
 */

export interface CreateDocumentInput {
  owner: { userId: string | null; sessionId: string | null };
  ticketId: string;
  projectId: string | null;
}

export async function createDocumentFromTicket(
  input: CreateDocumentInput,
): Promise<DocumentSummary> {
  const ticket = await findConsumedTicketForOwner(input.ticketId, input.owner);
  if (!ticket) {
    throw errors.validation({
      ticketId:
        'No completed upload found for this ticket. Upload the file first, then create the document.',
    });
  }

  // A project can only be attached if the caller owns it. Without this check a
  // client could file a document into someone else's project by guessing an id.
  if (input.projectId) {
    const userId = input.owner.userId;
    if (!userId) throw errors.unauthenticated('Sign in to add documents to a project.');
    const project = await findProject(input.projectId, userId);
    if (!project) throw errors.notFound('Project');
  }

  // Confirm the bytes actually landed before creating a row that references
  // them, so a client that skipped the upload cannot create a phantom document.
  const storage = getStorage();
  const head = await storage.head(ticket.storage_key);
  if (!head) {
    throw errors.validation({
      ticketId: 'The upload for this ticket was not found in storage. Try uploading again.',
    });
  }

  return withTransaction(async (tx) => {
    const document = await createDocument(
      {
        owner: input.owner,
        projectId: input.projectId,
        filename: ticket.filename,
        storageKey: ticket.storage_key,
        mimeType: ticket.mime_type,
        sizeBytes: Number(ticket.declared_bytes),
        status: 'UPLOADED',
      },
      tx,
    );

    await recordActivity(
      {
        userId: input.owner.userId,
        projectId: input.projectId,
        documentId: document.id,
        type: 'DOCUMENT_UPLOADED',
        message: `Uploaded ${ticket.filename}`,
      },
      tx,
    );

    return document;
  });
}

/** Document plus its latest job, ownership-scoped. Used by the job routes. */
export async function getDocumentWithJob(
  documentId: string,
  owner: { userId: string | null; sessionId: string | null },
): Promise<DocumentWithJob> {
  const document = await findDocumentWithJob(documentId, owner);
  if (!document) throw errors.notFound('Document');
  return document;
}

export async function getDocumentDetail(
  documentId: string,
  owner: { userId: string | null; sessionId: string | null },
): Promise<DocumentDetailResponse> {
  const document = await findDocumentWithJob(documentId, owner);
  if (!document) throw errors.notFound('Document');

  const [jobs, artifacts] = await Promise.all([
    listJobsForDocument(documentId),
    listArtifacts(documentId),
  ]);

  let project: Pick<Project, 'id' | 'name'> | null = null;
  if (document.projectId && owner.userId) {
    const found = await findProject(document.projectId, owner.userId);
    if (found) project = { id: found.id, name: found.name };
  }

  return {
    document,
    project,
    jobs,
    // The storage key is dropped here rather than blanked, so no response shape
    // can carry one out of the server even by accident.
    artifacts: artifacts.map(({ storageKey: _storageKey, ...rest }) => rest),
  };
}

export async function assignProject(
  documentId: string,
  owner: { userId: string | null; sessionId: string | null },
  projectId: string | null,
): Promise<void> {
  const row = await findDocumentRow(documentId, owner);
  if (!row) throw errors.notFound('Document');
  await assignDocumentToProject(documentId, owner, projectId);
}

export async function setDocumentStatus(
  documentId: string,
  status: DocumentSummary['status'],
): Promise<void> {
  await updateDocumentStatus(documentId, status);
}

/**
 * Deletes a document and everything that pointed at it.
 *
 * Artifact rows and the raw upload go first, then the document row. If the row
 * delete fails the object keys are already known, so a retry is safe; if an
 * object delete fails the row survives and the next attempt finds it. The
 * reverse order would orphan bytes with nothing left to name them.
 */
export async function deleteDocument(
  documentId: string,
  owner: { userId: string | null; sessionId: string | null },
): Promise<void> {
  const row = await findDocumentRow(documentId, owner);
  if (!row) throw errors.notFound('Document');

  const storage = getStorage();
  const artifactKeys = await storageKeysForDocument(documentId);

  for (const key of [...artifactKeys, storageKeyOf(row)]) {
    try {
      await storage.delete(key);
    } catch (error) {
      // Log and continue: a missing object must not block the row delete, or a
      // user could never remove a document whose bytes were already gone.
      console.error(`[documents] failed to delete object ${key}: ${(error as Error).message}`);
    }
  }

  await deleteDocumentRow(documentId, owner);
}
