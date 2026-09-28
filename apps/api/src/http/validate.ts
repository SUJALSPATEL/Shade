import type { ZodTypeAny, infer as ZodInfer } from 'zod';
import { ApiError, errors } from './errors.js';

/**
 * Request parsing helpers.
 *
 * Zod issues are flattened into `{ field: message }` so the frontend can put
 * each message next to the input that caused it, instead of showing one
 * concatenated string above the form.
 *
 * The return type is `z.infer<S>` — the schema's *output* type — rather than
 * the schema's input type. That distinction matters: a field with
 * `.default(false)` is optional on the way in and guaranteed on the way out,
 * and typing the result as the input type would make every handler treat
 * `parseInput.extractImages` as possibly `undefined` when `parse` has already
 * filled it in.
 */

export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): ZodInfer<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data as ZodInfer<S>;

  const details: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join('.') || '_';
    // Keep the first message per field: later issues on the same path are
    // almost always restatements and make the UI noisier.
    details[path] ??= issue.message;
  }
  throw errors.validation(details);
}

export function parseQuery<S extends ZodTypeAny>(schema: S, query: unknown): ZodInfer<S> {
  return parseBody(schema, query ?? {});
}

/** Throws a 404-shaped error rather than returning `null` at the call site. */
export function requireFound<T>(value: T | null | undefined, what = 'Resource'): T {
  if (value === null || value === undefined) throw errors.notFound(what);
  return value;
}

/**
 * Guards a route against a missing principal.
 *
 * Routes that need a real account call this; routes that accept anonymous
 * first use use `request.principal` directly and check the quota themselves.
 */
export function requireUser(userId: string | null, message?: string): string {
  if (!userId) throw errors.unauthenticated(message);
  return userId;
}

export { ApiError };
