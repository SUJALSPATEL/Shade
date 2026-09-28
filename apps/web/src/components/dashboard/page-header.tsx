import { cn } from '@/lib/cn';

/**
 * Page header.
 *
 * Every dashboard route opens with the same three things: a title, a line of
 * context, and the one action that screen exists to perform. Writing that
 * inline per page is how a product ends up with three different vertical
 * rhythms, so it lives here.
 *
 * `actions` is a slot rather than a fixed button because the primary action
 * genuinely differs — "New document" on the dashboard, "New project" on the
 * projects list, nothing at all on a document you are reading.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Rendered above the title — a back link or a parent name. */
  breadcrumb?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-4 border-b border-line px-4 py-5 sm:px-6',
        className,
      )}
    >
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-1.5">{breadcrumb}</div> : null}
        <h1 className="truncate text-lg font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>

      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/**
 * A single number with a label.
 *
 * `tone` exists to let one figure — usually total artifacts or a failure count
 * — carry emphasis without the caller reaching for a colour class directly.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'accent' | 'danger';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5',
        className,
      )}
    >
      <p className="text-[0.6875rem] font-medium uppercase tracking-[0.04em] text-ink-faint">
        {label}
      </p>
      <p
        className={cn(
          'mt-1.5 text-xl font-semibold tabular-nums tracking-[-0.02em]',
          tone === 'accent' ? 'text-accent-bright' : tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}
