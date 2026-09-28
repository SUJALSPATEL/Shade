'use client';

import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { ERROR_MESSAGES, type ApiError, type ApiErrorCode } from '@shade/shared';
import { Button } from './button';

/**
 * Empty and error states.
 *
 * Both are written as "what happened, and what to do next" rather than as a
 * status code. An empty project list and a failed request look almost identical
 * in a screenshot — a message and a grey box — and they are completely
 * different problems, so they get different components rather than one
 * `<Placeholder>` with a colour prop.
 */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      {icon ? (
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-line bg-raised text-ink-faint">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-[0.8125rem] leading-relaxed text-ink-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/**
 * ErrorState.
 *
 * Takes an unknown because that is what a catch block actually has. The
 * branching is on `error.code`, never on the message text: the code is the
 * contract, the message is copy that may change.
 */
export function ErrorState({
  error,
  onRetry,
  className,
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  /** Inline variant for a panel, rather than a full-page state. */
  compact?: boolean;
}) {
  const apiError = isApiError(error) ? error : null;
  const code: ApiErrorCode = apiError?.code ?? 'INTERNAL_ERROR';
  const message = apiError?.message || ERROR_MESSAGES[code];
  const router = useRouter();

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center text-center',
        compact ? 'px-5 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-[#ef5f6840] bg-danger-soft text-danger">
        <svg className="size-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M10 6.5v4.25M10 13.75h.01M8.6 2.9 1.9 15a1.6 1.6 0 0 0 1.4 2.4h13.4A1.6 1.6 0 0 0 18.1 15L11.4 2.9a1.6 1.6 0 0 0-2.8 0Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <p className="text-sm font-medium text-ink">{message}</p>

      {apiError?.details ? (
        <ul className="mt-2 space-y-0.5">
          {Object.entries(apiError.details).map(([field, detail]) => (
            <li key={field} className="text-xs text-ink-muted">
              <span className="font-mono text-ink-faint">{field}</span> — {detail}
            </li>
          ))}
        </ul>
      ) : null}

      {/* A request id is the one thing that makes a support conversation
          possible, so it is shown rather than logged away. */}
      {apiError?.requestId ? (
        <p className="mt-3 font-mono text-[0.6875rem] text-ink-faint">
          request {apiError.requestId}
        </p>
      ) : null}

      <div className="mt-5 flex items-center gap-2">
        {onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        {apiError?.requiresAuth ? (
          <Button variant="primary" size="sm" onClick={() => router.push('/login')}>
            Sign in
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Structural check for `ApiError`.
 *
 * `instanceof` is unreliable across a module boundary that a bundler may have
 * duplicated — which is exactly the situation with a workspace package that is
 * transpiled into both the API and the web bundle. Checking the shape is
 * slightly more code and considerably more reliable.
 */
function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'status' in error &&
    typeof (error as { code: unknown }).code === 'string'
  );
}
