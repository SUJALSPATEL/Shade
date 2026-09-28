import type { FastifyInstance } from 'fastify';
import { splitQueryRequestSchema } from '@shade/shared/contracts';
import type { ParseResult, SplitQueryResponse } from '@shade/shared';
import { rankChunks } from '@shade/shared/mock';
import { ownerOf } from '../auth/plugin.js';
import { findArtifact } from '../db/repositories/artifacts.js';
import { errors } from '../http/errors.js';
import { parseBody } from '../http/validate.js';
import { readArtifactPayload } from '../services/artifacts.js';
import { getDocumentWithJob } from '../services/documents.js';

/**
 * Interactive retrieval.
 *
 * `POST /api/jobs` with `operation: SPLIT` runs a split as a *job* — durable,
 * recorded, resumable. This endpoint is the other half: the question box in the
 * workspace, where waiting for a queue round trip to rank passages that are
 * already sitting in an artifact would be silly. It answers synchronously.
 *
 * What it must not do is answer from somewhere other than the user's own
 * document. So the chunks come from the Parse artifact this document actually
 * produced, and a document that has not been parsed gets a clear
 * `ARTIFACT_NOT_READY` rather than a plausible-looking result built from the
 * fixture.
 */

export async function registerSplitRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/split', async (request) => {
    const input = parseBody(splitQueryRequestSchema, request.body);
    const owner = ownerOf(request);
    const startedAt = Date.now();

    const document = await getDocumentWithJob(input.documentId, owner);

    const artifact = await findArtifact(document.id, 'JSON', 'PARSE');
    if (!artifact) {
      throw errors.artifactNotReady(
        'Parse this document before searching it — there are no detected regions yet.',
      );
    }

    const payload = await readArtifactPayload<{ chunks?: ParseResult['chunks'] }>(artifact);
    const chunks = payload.chunks ?? [];

    if (chunks.length === 0) {
      throw errors.artifactNotReady(
        'This document has no retrievable regions. Re-run Parse and try again.',
      );
    }

    const matches = rankChunks(chunks, input.query, { limit: input.limit });

    const response: SplitQueryResponse = {
      documentId: document.id,
      query: input.query,
      matches,
      // The retriever names itself so the UI can be honest about what answered,
      // and so swapping in embeddings is visible rather than mysterious.
      retriever: 'mock-lexical',
      tookMs: Date.now() - startedAt,
    };
    return response;
  });
}
