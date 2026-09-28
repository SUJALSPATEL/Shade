import { clampProgress } from '@shade/shared';
import { cn } from '@/lib/cn';
import { JOB_STAGE_LABELS, type JobStage } from '@shade/shared';

/**
 * Progress — a determinate bar and a stage readout.
 *
 * The bar is determinate because the worker reports a real number, and a fake
 * indeterminate animation over a job that knows exactly where it is would be
 * throwing away the one honest signal the pipeline produces.
 *
 * The stage label sits above the bar rather than inside it: "Understanding
 * layout" is the part a user actually reads, and it is frequently wider than
 * the filled portion of the bar in the early stages.
 */

export function Progress({
  value,
  className,
  tone = 'accent',
}: {
  value: number;
  className?: string;
  tone?: 'accent' | 'positive' | 'danger';
}) {
  const percent = clampProgress(value);

  const fill =
    tone === 'positive' ? 'bg-positive' : tone === 'danger' ? 'bg-danger' : 'bg-accent';

  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-raised', className)}
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500 ease-[var(--ease-out-soft)]',
          fill,
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/**
 * The sweep shown when a bar would be lying.
 *
 * Used only for phases with no measurable progress — the upload's final
 * "creating the document" step, and the moment between a job being enqueued and
 * its first progress report. Everywhere else there is a real percentage and
 * this should not be used.
 */
export function IndeterminateBar({ className }: { className?: string }) {
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-raised', className)}
      role="progressbar"
      aria-valuetext="Working"
    >
      <div className="h-full w-1/4 animate-sweep rounded-full bg-accent" />
    </div>
  );
}

/**
 * Stage readout: a labelled bar plus the elapsed stage list.
 *
 * `stages` is the ordered set of stages this job is expected to pass through,
 * which differs by operation — a Split job never extracts tables. Showing the
 * stages a job will not visit as greyed-out rows would make every Split look
 * like a Parse that ran out of time.
 */
export function StageProgress({
  value,
  stage,
  stages,
  className,
}: {
  value: number;
  stage: JobStage | null;
  /** Ordered expected stages. When omitted, only the current stage is shown. */
  stages?: readonly JobStage[];
  className?: string;
}) {
  const currentIndex = stage && stages ? stages.indexOf(stage) : -1;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm font-medium text-ink">
          {stage ? JOB_STAGE_LABELS[stage] : 'Queued'}
        </p>
        <p className="font-mono text-xs tabular-nums text-ink-faint">{clampProgress(value)}%</p>
      </div>

      <Progress value={value} />

      {stages && stages.length > 0 ? (
        <ol className="space-y-1.5 pt-1">
          {stages.map((candidate, index) => {
            const done = currentIndex > index;
            const active = currentIndex === index;
            return (
              <li
                key={candidate}
                className={cn(
                  'flex items-center gap-2.5 text-[0.8125rem] transition-colors duration-200',
                  active ? 'text-ink' : done ? 'text-ink-muted' : 'text-ink-faint',
                )}
              >
                <StageDot done={done} active={active} />
                {JOB_STAGE_LABELS[candidate]}
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

function StageDot({ done, active }: { done: boolean; active: boolean }) {
  if (done) {
    return (
      <svg className="size-3.5 shrink-0 text-positive" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="m3.5 8.5 3 3 6-7"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <span
      className={cn(
        'size-3.5 shrink-0 rounded-full border',
        active ? 'animate-pulse-soft border-accent bg-accent-soft' : 'border-line-strong',
      )}
      aria-hidden="true"
    />
  );
}
