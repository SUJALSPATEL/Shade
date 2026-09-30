'use client';

import { formatBytes, OPERATION_STAGES, type Operation, type ProcessingJob } from '@shade/shared';
import { Button } from '@/components/ui/button';
import { IndeterminateBar, Progress, StageProgress } from '@/components/ui/progress';
import { cn } from '@/lib/cn';
import type { UploadProgress } from '@/lib/upload';

/**
 * What the user watches while a document is being read.
 *
 * The panel is built around one rule: never show a number that is not real.
 * Upload progress is measured bytes; processing progress is the worker's own
 * percentage. The only place a bar is indeterminate is the gap between the last
 * byte landing and the document row existing — a window of a few milliseconds
 * where there genuinely is nothing to measure, and where a bar frozen at 100%
 * would read as a hang.
 */

export type ProcessingFailure = {
  /** Headline, already human-readable. */
  message: string;
  /** Whether offering "Try again" is honest. */
  retryable: boolean;
  /** The stage the job died on, when it got far enough to have one. */
  stage?: string | null;
} | null;

export function ProcessingPanel({
  filename,
  sizeBytes,
  operation,
  upload,
  job,
  failure,
  onRetry,
  onCancel,
  className,
}: {
  filename: string;
  sizeBytes: number;
  operation: Operation;
  /** Null once the upload has finished. */
  upload: UploadProgress | null;
  job: ProcessingJob | null;
  failure: ProcessingFailure;
  onRetry?: () => void;
  onCancel?: () => void;
  className?: string;
}) {
  const stages = OPERATION_STAGES[operation];

  return (
    <div className={cn('w-full max-w-lg', className)}>
      {/* ── The file ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-raised text-accent-bright">
          <FileIcon />
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.8125rem] font-medium text-ink">{filename}</p>
          <p className="font-mono text-[0.6875rem] text-ink-faint">
            {formatBytes(sizeBytes)} · {operation.toLowerCase()}
          </p>
        </div>

        {onCancel && !failure && job?.status !== 'COMPLETED' ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>

      {/* ── Failure ──────────────────────────────────────────────────────── */}
      {failure ? (
        <div
          role="alert"
          className="mt-4 rounded-[var(--radius-card)] border border-danger/30 bg-danger-soft px-4 py-3.5"
        >
          <p className="text-[0.8125rem] font-medium text-danger">{failure.message}</p>
          {failure.stage ? (
            <p className="mt-1 text-xs text-ink-muted">
              Failed during <span className="font-mono">{failure.stage.toLowerCase()}</span>.
            </p>
          ) : null}
          {onRetry && failure.retryable ? (
            <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="mt-5">
          {/* ── Uploading ──────────────────────────────────────────────────── */}
          {upload ? (
            <div className="space-y-3">
              <div className="flex items-baseline justify-between gap-4">
                <p className="text-sm font-medium text-ink">
                  {upload.phase === 'preparing'
                    ? 'Preparing upload'
                    : upload.phase === 'uploading'
                      ? 'Uploading'
                      : 'Creating document'}
                </p>
                {upload.phase === 'uploading' ? (
                  <p className="font-mono text-xs tabular-nums text-ink-faint">
                    {Math.round(upload.fraction * 100)}%
                  </p>
                ) : null}
              </div>

              {/* `preparing` is a presign round trip — short, and with nothing
                  to measure. A bar at 0% that never moves for the one second it
                  takes reads as broken, so it sweeps instead. */}
              {upload.phase === 'preparing' ? (
                <IndeterminateBar />
              ) : (
                <Progress value={upload.fraction * 100} />
              )}
            </div>
          ) : job ? (
            /* ── Processing ─────────────────────────────────────────────── */
            <StageProgress value={job.progress} stage={job.stage} stages={stages} />
          ) : (
            /* Upload finished, job not yet created — the one honest sweep. */
            <div className="space-y-3">
              <p className="text-sm font-medium text-ink">Queued</p>
              <IndeterminateBar />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FileIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 1.75h5L12.25 5v9.25a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1V2.75a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M9 1.75V5h3.25" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}
