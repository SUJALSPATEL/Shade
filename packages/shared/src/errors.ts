/**
 * Error taxonomy shared by the API and the UI.
 *
 * The API always responds with this envelope on failure, so the frontend has
 * exactly one shape to branch on and never has to parse prose:
 *
 *   { "error": { "code": "FILE_TOO_LARGE", "message": "...", "details": {...} } }
 */

export const API_ERROR_CODES = [
  // 400
  'VALIDATION_ERROR',
  'INVALID_FILE_TYPE',
  'FILE_TOO_LARGE',
  'EMPTY_FILE',
  // 401 / 403
  'UNAUTHENTICATED',
  'SESSION_EXPIRED',
  'FORBIDDEN',
  'QUOTA_EXCEEDED',
  // 404
  'NOT_FOUND',
  'ARTIFACT_NOT_READY',
  // 409
  'CONFLICT',
  'EMAIL_IN_USE',
  // 429
  'RATE_LIMITED',
  // 5xx
  'STORAGE_ERROR',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  /** Field-level validation detail, keyed by request field path. */
  details?: Record<string, string>;
  /** Correlation id echoed in logs — surfaced in the UI error state. */
  requestId?: string;
}

export interface ApiErrorResponse {
  error: ApiErrorBody;
}

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INVALID_FILE_TYPE: 415,
  FILE_TOO_LARGE: 413,
  EMPTY_FILE: 400,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  QUOTA_EXCEEDED: 402,
  NOT_FOUND: 404,
  ARTIFACT_NOT_READY: 409,
  CONFLICT: 409,
  EMAIL_IN_USE: 409,
  RATE_LIMITED: 429,
  STORAGE_ERROR: 502,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export function httpStatusForErrorCode(code: ApiErrorCode): number {
  return STATUS_BY_CODE[code];
}

/**
 * Copy shown to users. Deliberately written here rather than in the API so the
 * client can render a sensible message for any code even if the server's
 * message is missing or unhelpful.
 */
export const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: 'Some of the information provided was not valid.',
  INVALID_FILE_TYPE: 'Only PDF files are supported right now.',
  FILE_TOO_LARGE: 'That file is larger than the 50 MB limit.',
  EMPTY_FILE: 'That file appears to be empty.',
  UNAUTHENTICATED: 'Sign in to continue.',
  SESSION_EXPIRED: 'Your session has expired. Sign in again to continue.',
  FORBIDDEN: 'You do not have access to this resource.',
  QUOTA_EXCEEDED: 'Create a free account to keep processing documents.',
  NOT_FOUND: 'We could not find what you were looking for.',
  ARTIFACT_NOT_READY: 'This document is still processing.',
  CONFLICT: 'That action conflicts with the current state.',
  EMAIL_IN_USE: 'An account with that email already exists.',
  RATE_LIMITED: 'Too many requests. Try again in a moment.',
  STORAGE_ERROR: 'We could not reach document storage.',
  INTERNAL_ERROR: 'Something went wrong on our side.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
};

/** Client-side error that carries the parsed API envelope. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, string>;
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || ERROR_MESSAGES[body.code]);
    this.name = 'ApiError';
    this.code = body.code;
    this.status = status;
    this.details = body.details;
    this.requestId = body.requestId;
  }

  /** Whether the UI should offer a "Try again" affordance. */
  get retryable(): boolean {
    return this.status >= 500 || this.code === 'RATE_LIMITED' || this.code === 'SERVICE_UNAVAILABLE';
  }

  /** True when the fix is "sign in", not "retry". */
  get requiresAuth(): boolean {
    return this.code === 'UNAUTHENTICATED' || this.code === 'SESSION_EXPIRED' || this.code === 'QUOTA_EXCEEDED';
  }
}
