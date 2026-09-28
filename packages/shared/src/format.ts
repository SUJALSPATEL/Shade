/**
 * Formatting helpers shared by the API (log lines, history messages) and the
 * web app (file sizes, relative times, activity grouping).
 *
 * Locale-aware but deterministic: `relativeTime` takes an explicit `now` so
 * server-rendered output is stable and testable.
 */

/** `1536` → `1.5 KB`. Binary units, one decimal, trailing `.0` dropped. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

/** `2` → `2 pages`; `1` → `1 page`; `null` → `—`. */
export function formatPageCount(pages: number | null | undefined): string {
  if (pages === null || pages === undefined) return '—';
  return `${pages} ${pages === 1 ? 'page' : 'pages'}`;
}

/**
 * Coarse relative time, e.g. `just now`, `4 minutes ago`, `Yesterday`.
 * Deliberately coarse — the history feed reads better with approximate labels
 * than with second-by-second precision.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '—';

  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.round(diffMs / 1000);

  if (diffSec < 0) return 'just now';
  if (diffSec < 45) return 'just now';
  if (diffSec < 90) return 'a minute ago';

  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minutes ago`;

  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const dayDelta = Math.round(
    (startOfToday.getTime() - startOfThen.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (dayDelta === 1) return 'Yesterday';
  if (dayDelta < 7) return `${dayDelta} days ago`;
  if (dayDelta < 30) {
    const weeks = Math.round(dayDelta / 7);
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  }

  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Bucket label for the history feed: `Today`, `Yesterday`, `Earlier this week`,
 * `Earlier this month`, or the month name.
 */
export function historyBucket(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Unknown';

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const dayDelta = Math.round(
    (startOfToday.getTime() - startOfThen.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (dayDelta <= 0) return 'Today';
  if (dayDelta === 1) return 'Yesterday';
  if (dayDelta < 7) return 'Earlier this week';
  if (dayDelta < 30) return 'Earlier this month';
  return then.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** `annual-report.pdf` → `annual-report`; used for download filenames. */
export function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx <= 0 ? filename : filename.slice(0, idx);
}

/** `Annual Report 2025` → `annual-report-2025`. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

/** Clamps a progress value into the 0–100 integer range the API stores. */
export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Truncates on a word boundary, appending an ellipsis when it cuts. */
export function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  const cut = input.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Short display form of an opaque id, e.g. `doc_9f2a…c1`. */
export function shortId(id: string, head = 10): string {
  return id.length <= head ? id : `${id.slice(0, head)}…`;
}
