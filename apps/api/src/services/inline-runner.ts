import { artifactNames } from '@shade/shared';
import {
  DOCUMENT_SUMMARY,
  markdownByteLength,
  retrieve,
  runExtract,
  runParse,
  type ArtifactReport,
  type DocumentDescriptor,
  type JobEnvelope,
  type JobStage,
  type ParseOutput,
  type SchemaField,
} from '@shade/shared/mock';
import { config } from '../config/env.js';
import { getStorage } from '../storage/index.js';
import { artifactKeyFor, completeJob, failJob, reportProgress, startJob } from './jobs.js';
import type { JobCompleteRequest, JobFailRequest } from '@shade/shared';

/**
 * Inline job runner — the development fallback for `QUEUE_DRIVER=inline`.
 *
 * This is not a shortcut around the async model; it is a second *dispatcher*.
 * It walks the same state machine through the same service functions the worker
 * callbacks use (`startJob` → `reportProgress` → `completeJob`), writes real
 * bytes through the same storage adapter, and produces the same artifacts at
 * the same keys. The only thing it skips is the network hop to Python.
 *
 * That equivalence is the point: the UI, the database and the artifact layout
 * are exercised for real, so switching to `QUEUE_DRIVER=redis` changes nothing
 * a user or a test can observe except where the CPU time is spent.
 *
 * Refuses to run in production — a real deployment must have a real worker.
 */

/** Stages walked by a Parse job, with the progress each one reports. */
const PARSE_STAGES: Array<{ stage: JobStage; progress: number; message: string }> = [
  { stage: 'FETCHING', progress: 8, message: 'Reading the uploaded file' },
  { stage: 'PARSING', progress: 18, message: 'Opening the PDF' },
  { stage: 'LAYOUT', progress: 34, message: 'Detecting page layout' },
  { stage: 'TEXT', progress: 48, message: 'Extracting text' },
  { stage: 'TABLES', progress: 60, message: 'Reconstructing tables' },
  { stage: 'IMAGES', progress: 70, message: 'Extracting figures' },
  { stage: 'STRUCTURE', progress: 78, message: 'Building the document tree' },
  { stage: 'MARKDOWN', progress: 88, message: 'Generating Markdown' },
  { stage: 'JSON', progress: 94, message: 'Generating JSON' },
];

const EXTRACT_STAGES: Array<{ stage: JobStage; progress: number; message: string }> = [
  { stage: 'FETCHING', progress: 10, message: 'Reading the uploaded file' },
  { stage: 'PARSING', progress: 25, message: 'Opening the PDF' },
  { stage: 'TEXT', progress: 45, message: 'Locating candidate passages' },
  { stage: 'STRUCTURE', progress: 70, message: 'Mapping values to schema fields' },
  { stage: 'JSON', progress: 90, message: 'Building the extraction record' },
];

const SPLIT_STAGES: Array<{ stage: JobStage; progress: number; message: string }> = [
  { stage: 'FETCHING', progress: 20, message: 'Reading the uploaded file' },
  { stage: 'TEXT', progress: 50, message: 'Scanning document regions' },
  { stage: 'STRUCTURE', progress: 80, message: 'Ranking matches' },
];

export async function runInlineJob(envelope: JobEnvelope): Promise<void> {
  if (config.isProduction) {
    throw new Error('The inline job runner is a development fallback and must not run in production.');
  }

  const started = await startJob(envelope.jobId);
  // A redelivery, or a job the stale sweep already failed. Skipping keeps the
  // runner idempotent, exactly as the worker must be.
  if (!started) return;

  try {
    const stages = stagesFor(envelope);
    for (const step of stages) {
      await reportProgress(envelope.jobId, step);
      await delay(delayFor(envelope));
    }

    const completion = await buildCompletion(envelope);
    await completeJob(envelope.jobId, completion);
  } catch (error) {
    const failure: JobFailRequest = {
      error: {
        code: 'PROCESSOR_ERROR',
        message: 'The mock processor could not complete this document.',
        retryable: true,
        detail: error instanceof Error ? error.message : String(error),
      },
    };
    await failJob(envelope.jobId, failure);
  }
}

function stagesFor(envelope: JobEnvelope) {
  switch (envelope.operation) {
    case 'PARSE':
      return PARSE_STAGES;
    case 'EXTRACT':
      return EXTRACT_STAGES;
    case 'SPLIT':
      return SPLIT_STAGES;
  }
}

/**
 * Keeps the demo observable without making `npm run dev` feel slow. The `__slow__`
 * marker mirrors the Python worker's, so both paths can be slowed identically
 * when demonstrating the processing states.
 */
function delayFor(envelope: JobEnvelope): number {
  return envelope.document.filename.includes('__slow__') ? 900 : 180;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function descriptorFor(envelope: JobEnvelope): DocumentDescriptor {
  return {
    id: envelope.documentId,
    filename: envelope.document.filename,
    mimeType: envelope.document.mimeType,
    sizeBytes: envelope.document.sizeBytes,
    pageCount: 0,
    title: null,
    author: null,
    createdAt: envelope.enqueuedAt,
  };
}

/* ── Completion payloads ─────────────────────────────────────────────────── */

async function buildCompletion(envelope: JobEnvelope): Promise<JobCompleteRequest> {
  switch (envelope.operation) {
    case 'PARSE':
      return completeParse(envelope);
    case 'EXTRACT':
      return completeExtract(envelope);
    case 'SPLIT':
      return completeSplit(envelope);
  }
}

async function completeParse(envelope: JobEnvelope): Promise<JobCompleteRequest> {
  const document = descriptorFor(envelope);
  const output: ParseOutput = runParse(document, { startedAtMs: Date.now() - 1_840 });

  const storage = getStorage();
  const artifacts: ArtifactReport[] = [];

  // Markdown — the primary representation, its own artifact.
  const markdownKey = artifactKeyFor(envelope.documentId, 'PARSE', 'markdown');
  const markdownPut = await storage.put({
    key: markdownKey,
    body: output.markdown.content,
    contentType: 'text/markdown; charset=utf-8',
    metadata: { documentId: envelope.documentId, operation: 'PARSE' },
  });
  artifacts.push({
    type: 'MARKDOWN',
    storageKey: markdownKey,
    mimeType: 'text/markdown; charset=utf-8',
    sizeBytes: markdownPut.sizeBytes,
    label: artifactNames.markdown,
  });

  // JSON — the secondary representation, carrying chunks and the node tree.
  const jsonKey = artifactKeyFor(envelope.documentId, 'PARSE', 'json');
  const jsonBody = JSON.stringify(output.result, null, 2);
  const jsonPut = await storage.put({
    key: jsonKey,
    body: jsonBody,
    contentType: 'application/json; charset=utf-8',
    metadata: { documentId: envelope.documentId, operation: 'PARSE' },
  });
  artifacts.push({
    type: 'JSON',
    storageKey: jsonKey,
    mimeType: 'application/json; charset=utf-8',
    sizeBytes: jsonPut.sizeBytes,
    label: artifactNames.json,
  });

  // Figures extracted from the document.
  for (const asset of output.assets) {
    const key = `assets/${envelope.documentId}/${asset.name}`;
    const put = await storage.put({
      key,
      body: asset.content,
      contentType: asset.mimeType,
      metadata: { documentId: envelope.documentId, caption: asset.caption ?? '' },
    });
    artifacts.push({
      type: 'ASSET',
      storageKey: key,
      mimeType: asset.mimeType,
      sizeBytes: put.sizeBytes,
      label: asset.name,
    });
  }

  return {
    artifacts,
    document: {
      pageCount: output.result.document.pageCount,
      title: output.result.document.title,
      author: output.result.document.author,
      summary: DOCUMENT_SUMMARY,
    },
    metrics: {
      chunkCount: output.result.chunks.length,
      assetCount: output.assets.length,
      tableCount: output.result.json.tables.length,
      markdownBytes: markdownByteLength(output.markdown.content),
    },
    metadata: {
      engine: output.result.metadata.engine,
      version: output.result.metadata.version,
      durationMs: output.result.metadata.durationMs,
      mocked: true,
    },
  };
}

async function completeExtract(envelope: JobEnvelope): Promise<JobCompleteRequest> {
  const document = descriptorFor(envelope);
  const input = envelope.input as { schemaName: string; fields: SchemaField[] };
  const result = runExtract(document, { name: input.schemaName, fields: input.fields });

  const storage = getStorage();
  const key = artifactKeyFor(envelope.documentId, 'EXTRACT', 'json');
  const body = JSON.stringify(result, null, 2);
  const put = await storage.put({
    key,
    body,
    contentType: 'application/json; charset=utf-8',
    metadata: { documentId: envelope.documentId, operation: 'EXTRACT' },
  });

  return {
    artifacts: [
      {
        type: 'JSON',
        storageKey: key,
        mimeType: 'application/json; charset=utf-8',
        sizeBytes: put.sizeBytes,
        label: 'extract.json',
      },
    ],
    document: { pageCount: result.document.pageCount, title: result.document.title, summary: DOCUMENT_SUMMARY },
    metrics: {
      chunkCount: 0,
      assetCount: 0,
      tableCount: 0,
      markdownBytes: 0,
    },
    metadata: {
      engine: result.metadata.engine,
      version: result.metadata.version,
      durationMs: result.metadata.durationMs,
      mocked: true,
    },
  };
}

async function completeSplit(envelope: JobEnvelope): Promise<JobCompleteRequest> {
  const document = descriptorFor(envelope);
  const input = envelope.input as { query: string; limit: number };
  const matches = retrieve(input.query, { limit: input.limit });

  const result = {
    document: { ...document, pageCount: 3, title: 'Annual Report 2025', author: 'Northwind Analytics' },
    query: input.query,
    matches,
    metadata: {
      engine: 'mock-lexical',
      version: '0.1.0',
      durationMs: 420,
      processedAt: new Date().toISOString(),
      mocked: true,
    },
  };

  const storage = getStorage();
  const key = artifactKeyFor(envelope.documentId, 'SPLIT', 'json');
  const body = JSON.stringify(result, null, 2);
  const put = await storage.put({
    key,
    body,
    contentType: 'application/json; charset=utf-8',
    metadata: { documentId: envelope.documentId, operation: 'SPLIT' },
  });

  return {
    artifacts: [
      {
        type: 'JSON',
        storageKey: key,
        mimeType: 'application/json; charset=utf-8',
        sizeBytes: put.sizeBytes,
        label: 'split.json',
      },
    ],
    document: { pageCount: 3, title: 'Annual Report 2025', summary: DOCUMENT_SUMMARY },
    metrics: {
      chunkCount: matches.length,
      assetCount: 0,
      tableCount: 0,
      markdownBytes: 0,
    },
    metadata: {
      engine: result.metadata.engine,
      version: result.metadata.version,
      durationMs: result.metadata.durationMs,
      mocked: true,
    },
  };
}
