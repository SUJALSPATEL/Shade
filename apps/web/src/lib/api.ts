import { ApiError, type ApiErrorBody } from '@shade/shared';

/**
 * The API client.
 *
 * Every call in the app goes through `request`, so there is exactly one place
 * that knows how a Shade error is shaped, how the session cookie is carried and
 * how a cancelled request is distinguished from a failed one.
 *
 * Two decisions worth stating:
 *
 * **Same-origin by default.** With `NEXT_PUBLIC_API_BASE_URL` unset, requests go
 * to `/api/*` on the app's own origin and Next proxies them (see
 * `next.config.ts`). The session cookie is `httpOnly`, so the browser attaches
 * it automatically and no code here ever handles a credential.
 *
 * **Failures throw `ApiError`.** The API returns `{ error: { code, message } }`
 * for every failure, and `ApiError` (from `@shade/shared`) is the same class the
 * API constructs. The UI branches on `error.code`, never on prose — which is
 * what lets it show the right next step (sign in, retry, pick another file)
 * instead of a generic failure toast.
 */

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');

/** Absolute URL for an API path. `path` must start with `/api`. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/**
 * Rewrites an absolute API URL to a same-origin path when the app is talking to
 * its own origin through the proxy.
 *
 * The upload endpoint hands back an absolute `uploadUrl` built from the API's
 * own `API_PUBLIC_URL`. When the browser and the API are on different ports that
 * would turn a same-origin PUT into a cross-origin one, which means a preflight
 * and a cookie that has to survive it. Going through the proxy instead keeps the
 * whole flow first-party — and if the app has been configured with an explicit
 * API origin, the URL is left exactly as the server sent it.
 */
export function sameOrigin(url: string): string {
  if (API_BASE) return url;
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    // Already a relative path.
    return url;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON-serialised when present. */
  body?: unknown;
  /** Sent as-is, for the raw upload PUT. */
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Parse the body as text instead of JSON (the Markdown endpoint). */
  asText?: boolean;
}

/**
 * Performs a request and returns the parsed body.
 *
 * A 204 returns `undefined` rather than throwing on an empty body — `DELETE`
 * and `POST /logout` are real successes with nothing to say.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, rawBody, headers = {}, signal, asText } = options;

  const init: RequestInit = {
    method,
    // `same-origin` rather than `include`: when the app is proxying, the cookie
    // is first-party and this is all that is needed. Sending `include` to every
    // origin would be a standing invitation to leak it if a base URL were ever
    // misconfigured.
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...headers },
    ...(signal ? { signal } : {}),
  };

  if (rawBody !== undefined) {
    init.body = rawBody;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), init);
  } catch (cause) {
    // A network failure is not an API error — there is no envelope to read. It
    // is reported with the same class so callers have one thing to catch, and
    // with a code the UI can act on (retry, not "sign in").
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'We could not reach the Shade API. Is it running?',
    });
  }

  if (response.status === 204) return undefined as T;

  if (!response.ok) {
    throw new ApiError(response.status, await readErrorBody(response));
  }

  if (asText) return (await response.text()) as T;
  return (await response.json()) as T;
}

/**
 * Reads an error body, falling back to a synthesised envelope.
 *
 * A proxy or a crashed process can return HTML or an empty body. Turning that
 * into a well-formed `ApiErrorBody` means no caller ever has to guard against a
 * response that is not the shape the API promises.
 */
async function readErrorBody(response: Response): Promise<ApiErrorBody> {
  try {
    const parsed = (await response.json()) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'error' in parsed &&
      (parsed as { error: unknown }).error &&
      typeof (parsed as { error: { code?: unknown } }).error === 'object'
    ) {
      return (parsed as { error: ApiErrorBody }).error;
    }
  } catch {
    // Fall through to the synthesised body below.
  }
  return {
    code: response.status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR',
    message: `The request failed with HTTP ${response.status}.`,
  };
}

/**
 * True for a request that was deliberately cancelled.
 *
 * `AbortError` is not a failure and must never reach an error state: every
 * polling loop unmounts by aborting, and rendering "Something went wrong" on a
 * normal navigation would be a bug the user sees.
 */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
