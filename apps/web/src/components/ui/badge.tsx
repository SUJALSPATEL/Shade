import { cn } from '@/lib/cn';
import type { ChunkType, DocumentStatus, JobStatus } from '@shade/shared';

/**
 * Badge — status and taxonomy chips.
 *
 * The status maps below live here rather than at each call site so that
 * "processing is amber" is decided once. A status rendered in two colours in
 * two places is the kind of inconsistency a user reads as a bug.
 */

export type BadgeTone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-raised text-ink-muted border-line-strong',
  accent: 'bg-accent-soft text-accent-bright border-accent-line',
  positive: 'bg-positive-soft text-positive border-positive/30',
  warning: 'bg-warning-soft text-warning border-warning/30',
  danger: 'bg-danger-soft text-danger border-danger/30',
  info: 'bg-info-soft text-info border-info/30',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
  dot = false,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5',
        'text-[0.6875rem] font-medium tracking-[0.01em] whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/* ── Domain status → tone ──────────────────────────────────────────────────
   Kept as a function rather than a `Record` so the two enums can be handled
   side by side without one of them silently missing a member. */

const JOB_TONES: Record<JobStatus, BadgeTone> = {
  QUEUED: 'neutral',
  PROCESSING: 'accent',
  COMPLETED: 'positive',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

const DOCUMENT_TONES: Record<DocumentStatus, BadgeTone> = {
  UPLOADING: 'neutral',
  UPLOADED: 'info',
  QUEUED: 'neutral',
  PROCESSING: 'accent',
  READY: 'positive',
  FAILED: 'danger',
};

/** Whether a status is "in flight", which is what drives the pulsing dot. */
function isLive(status: JobStatus | DocumentStatus): boolean {
  return status === 'PROCESSING' || status === 'QUEUED' || status === 'UPLOADING';
}

export function JobStatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  return (
    <Badge tone={JOB_TONES[status]} dot={isLive(status)} className={className}>
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

export function DocumentStatusBadge({
  status,
  className,
}: {
  status: DocumentStatus;
  className?: string;
}) {
  // `READY` is the steady state — every finished document carries it, so
  // rendering it as a green chip would put a positive signal on the majority of
  // rows and drown out the ones that are actually worth noticing.
  if (status === 'READY') {
    return (
      <Badge tone="neutral" className={className}>
        Ready
      </Badge>
    );
  }

  const label = status.charAt(0) + status.slice(1).toLowerCase();
  return (
    <Badge tone={DOCUMENT_TONES[status]} dot={isLive(status)} className={className}>
      {label}
    </Badge>
  );
}

/* ── Chunk roles ─────────────────────────────────────────────────────────────
   Used by the preview overlay, the chunk list and the JSON legend. The colours
   come from the `--color-chunk-*` tokens so the PDF overlay and the list
   beside it cannot drift apart. */

export const CHUNK_COLOURS: Record<ChunkType, string> = {
  heading: 'var(--color-chunk-heading)',
  paragraph: 'var(--color-chunk-paragraph)',
  list: 'var(--color-chunk-list)',
  table: 'var(--color-chunk-table)',
  figure: 'var(--color-chunk-figure)',
  caption: 'var(--color-chunk-caption)',
  formula: 'var(--color-chunk-paragraph)',
  header: 'var(--color-chunk-furniture)',
  footer: 'var(--color-chunk-furniture)',
  page_number: 'var(--color-chunk-furniture)',
};

export const CHUNK_LABELS: Record<ChunkType, string> = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  list: 'List',
  table: 'Table',
  figure: 'Figure',
  caption: 'Caption',
  formula: 'Formula',
  header: 'Header',
  footer: 'Footer',
  page_number: 'Page number',
};

export function ChunkTypeChip({ type, className }: { type: ChunkType; className?: string }) {
  const colour = CHUNK_COLOURS[type];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5',
        'font-mono text-[0.625rem] uppercase tracking-[0.06em]',
        className,
      )}
      style={{
        color: colour,
        borderColor: `color-mix(in srgb, ${colour} 35%, transparent)`,
        background: `color-mix(in srgb, ${colour} 12%, transparent)`,
      }}
    >
      <span className="size-1.5 rounded-sm bg-current" aria-hidden="true" />
      {CHUNK_LABELS[type]}
    </span>
  );
}
