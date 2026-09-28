import { z } from 'zod';
import { JOB_STAGES, OPERATIONS, SCHEMA_FIELD_TYPES } from '../constants.js';

/**
 * Request validation schemas.
 *
 * These live in the shared package (not in the API) because the same rules
 * back the browser forms, the API's request parsing, and — later — the CLI and
 * any published OpenAPI document. One definition, three consumers.
 */

const id = z
  .string()
  .min(1)
  .max(64)
  // Ids are always server-minted; reject anything that could not have been.
  .regex(/^[a-z]{3}_[a-z0-9]{8,}$/, 'Malformed identifier');

export const idSchema = id;

/* ── Auth ────────────────────────────────────────────────────────────────── */

export const signUpRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .max(200, 'That password is too long'),
  name: z.string().trim().min(1).max(120),
});

export const signInRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

/* ── Projects ────────────────────────────────────────────────────────────── */

export const createProjectRequestSchema = z.object({
  name: z.string().trim().min(1, 'Give the project a name').max(120),
  summary: z.string().trim().max(2000).optional(),
});

export const updateProjectRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().max(2000).nullable().optional(),
});

export const listProjectsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

/* ── Uploads ─────────────────────────────────────────────────────────────── */

/**
 * The browser asks for a ticket before it uploads. The API decides the storage
 * key; the client never proposes one.
 */
export const presignUploadRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(128),
  sizeBytes: z.number().int().positive(),
  projectId: id.nullable().optional(),
});

/* ── Documents ───────────────────────────────────────────────────────────── */

/**
 * After a successful upload the client confirms it, which creates the document
 * row and (optionally) kicks off the first processing job in one round trip.
 */
export const createDocumentRequestSchema = z.object({
  ticketId: z.string().min(1).max(128),
  projectId: id.nullable().optional(),
  /** Convenience: enqueue the initial job as part of document creation. */
  operation: z.enum(OPERATIONS).optional(),
  parseInput: z
    .object({
      extractImages: z.boolean().default(true),
      keepFurniture: z.boolean().default(false),
    })
    .optional(),
  extractInput: z
    .object({
      schemaName: z.string().trim().min(1).max(120),
      fields: z
        .array(
          z.object({
            name: z
              .string()
              .trim()
              .min(1)
              .max(64)
              .regex(/^[a-z][a-z0-9_]*$/, 'Use snake_case field names'),
            type: z.enum(SCHEMA_FIELD_TYPES),
            description: z.string().trim().max(500).optional(),
            required: z.boolean().optional(),
          }),
        )
        .min(1, 'Add at least one field')
        .max(64),
    })
    .optional(),
  splitInput: z
    .object({
      query: z.string().trim().min(3, 'Describe what to find').max(500),
      limit: z.number().int().min(1).max(25).default(8),
    })
    .optional(),
});

export const listDocumentsQuerySchema = z.object({
  projectId: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

/* ── Jobs ────────────────────────────────────────────────────────────────── */

export const createJobRequestSchema = z.object({
  documentId: id,
  operation: z.enum(OPERATIONS),
  parseInput: z
    .object({
      extractImages: z.boolean().default(true),
      keepFurniture: z.boolean().default(false),
    })
    .optional(),
  extractInput: z
    .object({
      schemaName: z.string().trim().min(1).max(120),
      fields: z
        .array(
          z.object({
            name: z
              .string()
              .trim()
              .min(1)
              .max(64)
              .regex(/^[a-z][a-z0-9_]*$/, 'Use snake_case field names'),
            type: z.enum(SCHEMA_FIELD_TYPES),
            description: z.string().trim().max(500).optional(),
            required: z.boolean().optional(),
          }),
        )
        .min(1, 'Add at least one field')
        .max(64),
    })
    .optional(),
  splitInput: z
    .object({
      query: z.string().trim().min(3, 'Describe what to find').max(500),
      limit: z.number().int().min(1).max(25).default(8),
    })
    .optional(),
});

export const listJobsQuerySchema = z.object({
  documentId: id.optional(),
  status: z.string().max(32).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/* ── History ─────────────────────────────────────────────────────────────── */

export const listHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
  projectId: id.optional(),
  type: z.string().max(64).optional(),
});

/* ── Split retrieval (query endpoint, no job) ────────────────────────────── */

export const splitQueryRequestSchema = z.object({
  documentId: id,
  query: z.string().trim().min(3).max(500),
  limit: z.number().int().min(1).max(25).default(8),
});

/* ── Internal worker callbacks ───────────────────────────────────────────── */

export const jobProgressRequestSchema = z.object({
  progress: z.number().min(0).max(100),
  stage: z.enum(JOB_STAGES),
  message: z.string().max(500).optional(),
});

export const artifactReportSchema = z.object({
  type: z.enum(['MARKDOWN', 'JSON', 'ASSET']),
  storageKey: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(128),
  sizeBytes: z.number().int().nonnegative(),
  label: z.string().max(255).nullable().optional(),
});

export const jobCompleteRequestSchema = z.object({
  artifacts: z.array(artifactReportSchema).min(1),
  document: z.object({
    pageCount: z.number().int().positive(),
    title: z.string().max(500).nullable().optional(),
    author: z.string().max(500).nullable().optional(),
    summary: z.string().max(2000).nullable().optional(),
  }),
  metrics: z.object({
    chunkCount: z.number().int().nonnegative(),
    assetCount: z.number().int().nonnegative(),
    tableCount: z.number().int().nonnegative(),
    markdownBytes: z.number().int().nonnegative(),
    // Chunks are accepted for convenience but deliberately not persisted as a
    // column — see the storage rule in docs/data-model.md.
    chunks: z.array(z.unknown()).optional(),
  }),
  metadata: z.object({
    engine: z.string().max(64),
    version: z.string().max(32),
    durationMs: z.number().nonnegative(),
    mocked: z.boolean(),
  }),
});

export const jobFailRequestSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(1000),
    retryable: z.boolean(),
    detail: z.string().max(4000).optional(),
  }),
});

/* ── Inference ───────────────────────────────────────────────────────────── */

export type SignUpRequest = z.infer<typeof signUpRequestSchema>;
export type SignInRequest = z.infer<typeof signInRequestSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
export type PresignUploadRequest = z.infer<typeof presignUploadRequestSchema>;
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;
export type SplitQueryRequest = z.infer<typeof splitQueryRequestSchema>;
export type JobProgressRequest = z.infer<typeof jobProgressRequestSchema>;
export type JobCompleteRequest = z.infer<typeof jobCompleteRequestSchema>;
export type JobFailRequest = z.infer<typeof jobFailRequestSchema>;
