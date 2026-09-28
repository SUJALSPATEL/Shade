import {
  ERROR_MESSAGES,
  httpStatusForErrorCode,
  type ApiErrorBody,
  type ApiErrorCode,
} from '@shade/shared';

/**
 * The API's error type.
 *
 * Every failure path throws one of these; a single Fastify error handler turns
 * it into the wire envelope. That means a route never constructs an error
 * response by hand, and the frontend only ever has one shape to parse.
 */

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, string>;
  /** Overrides the generic copy from `ERROR_MESSAGES` when set. */
  readonly userMessage?: string;

  constructor(
    code: ApiErrorCode,
    options: {
      message?: string;
      details?: Record<string, string>;
      /** Override the derived HTTP status. Rare — used for 402 quota errors. */
      status?: number;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? ERROR_MESSAGES[code], options.cause ? { cause: options.cause } : undefined);
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status ?? httpStatusForErrorCode(code);
    this.details = options.details;
  }

  toBody(requestId?: string): ApiErrorBody {
    return {
      code: this.code,
      message: this.userMessage ?? this.message ?? ERROR_MESSAGES[this.code],
      ...(this.details ? { details: this.details } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }
}

/* ── Constructors for the cases routes hit most ──────────────────────────── */

export const errors = {
  validation: (details: Record<string, string>, message?: string) =>
    new ApiError('VALIDATION_ERROR', { details, ...(message ? { message } : {}) }),

  notFound: (what = 'Resource') => new ApiError('NOT_FOUND', { message: `${what} not found.` }),

  unauthenticated: (message?: string) =>
    new ApiError('UNAUTHENTICATED', message ? { message } : {}),

  forbidden: (message?: string) => new ApiError('FORBIDDEN', message ? { message } : {}),

  /** The anonymous first-use limit. Sends the user to sign-up, not to retry. */
  quotaExceeded: (message?: string) => new ApiError('QUOTA_EXCEEDED', message ? { message } : {}),

  invalidFileType: (received: string, expected = 'application/pdf') =>
    new ApiError('INVALID_FILE_TYPE', {
      message: `Unsupported file type "${received}". Expected ${expected}.`,
    }),

  fileTooLarge: (sizeBytes: number, maxBytes: number) =>
    new ApiError('FILE_TOO_LARGE', {
      message: `File is ${formatMb(sizeBytes)} MB; the limit is ${formatMb(maxBytes)} MB.`,
    }),

  emptyFile: () => new ApiError('EMPTY_FILE'),

  conflict: (message?: string) => new ApiError('CONFLICT', message ? { message } : {}),

  artifactNotReady: (message?: string) => new ApiError('ARTIFACT_NOT_READY', message ? { message } : {}),

  storage: (message: string, cause?: unknown) =>
    new ApiError('STORAGE_ERROR', { message, cause }),

  internal: (message?: string, cause?: unknown) =>
    new ApiError('INTERNAL_ERROR', { ...(message ? { message } : {}), cause }),

  unavailable: (message?: string) => new ApiError('SERVICE_UNAVAILABLE', message ? { message } : {}),
};

function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}
