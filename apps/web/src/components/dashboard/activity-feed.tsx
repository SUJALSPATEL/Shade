'use client';

import Link from 'next/link';
import {
  historyBucket,
  relativeTime,
  type Activity,
  type ActivityType,
} from '@shade/shared';
import { cn } from '@/lib/cn';
import { EmptyState } from '@/components/ui/states';
import { SkeletonRows } from '@/components/ui/skeleton';

/**
 * The activity feed.
 *
 * Journal-shaped rather than table-shaped: an activity row is a sentence that
 * happened at a time, and grouping it by "Today / Yesterday / Earlier this
 * week" is how a person actually looks for it. A reverse-chronological table
 * with a timestamp column makes the reader do that grouping themselves.
 *
 * Grouping happens here rather than in the API because it is a presentation
 * decision that depends on the reader's clock — the server has no idea what
 * "yesterday" means to this browser.
 *
 * Rows link to their document when they have one. The message is written by the
 * API at write time (denormalised on purpose, so the feed needs no joins), and
 * it is rendered as text, never as markup.
 */
export function ActivityFeed({
  activity,
  isLoading = false,
  emptyTitle = 'Nothing has happened yet',
  emptyDescription = 'Upload a document and the work Shade does on it shows up here.',
  className,
}: {
  activity: Activity[];
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}) {
  if (isLoading) {
    return (
      <div className={cn('px-5 py-4', className)}>
        <SkeletonRows rows={4} />
      </div>
    );
  }

  if (activity.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  const groups = groupByBucket(activity);

  return (
    <div className={cn('divide-y divide-[var(--color-line)]', className)}>
      {groups.map((group) => (
        <section key={group.label}>
          <h3 className="bg-surface px-5 py-2 text-[0.6875rem] font-medium uppercase tracking-[0.04em] text-ink-faint">
            {group.label}
          </h3>

          <ul className="divide-y divide-[var(--color-line)]">
            {group.items.map((item) => (
              <li key={item.id}>
                <ActivityRow activity={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  const body = (
    <>
      <ActivityGlyph type={activity.type} />

      <span className="min-w-0 flex-1">
        <span className="block text-[0.8125rem] leading-relaxed text-ink">{activity.message}</span>
        <span className="mt-0.5 block font-mono text-[0.6875rem] text-ink-faint">
          {relativeTime(activity.createdAt)}
        </span>
      </span>

      {activity.documentId ? (
        <svg
          className="mt-1 size-3.5 shrink-0 text-ink-faint"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m7.5 12.5 5-5M8.5 5.5H6a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6 15.5h7a1.5 1.5 0 0 0 1.5-1.5v-2.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
    </>
  );

  // Only rows with a destination are links — an activity about a deleted
  // document would otherwise be a link to a 404.
  if (!activity.documentId) {
    return <div className="flex items-start gap-3 px-5 py-3">{body}</div>;
  }

  return (
    <Link
      href={`/documents/${activity.documentId}`}
      className="flex items-start gap-3 px-5 py-3 transition-colors duration-150 ease-[var(--ease-out-soft)] hover:bg-raised/50 focus-visible:bg-raised/50 focus-visible:outline-none"
    >
      {body}
    </Link>
  );
}

/**
 * Colour-coded by kind, not by outcome.
 *
 * A failed job is red because something went wrong; the four success types get
 * their own hues because "what kind of thing happened" is the question a feed
 * is scanned to answer. Making all four green would make the feed a wall of
 * identical dots.
 */
const ACTIVITY_TONES: Record<ActivityType, string> = {
  PROJECT_CREATED: 'text-ink-muted',
  DOCUMENT_UPLOADED: 'text-[var(--color-chunk-paragraph)]',
  DOCUMENT_PARSED: 'text-accent-bright',
  DOCUMENT_EXTRACTED: 'text-positive',
  DOCUMENT_SPLIT: 'text-[var(--color-chunk-list)]',
  JOB_FAILED: 'text-danger',
};

function ActivityGlyph({ type }: { type: ActivityType }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-line bg-raised',
        ACTIVITY_TONES[type],
      )}
    >
      <svg className="size-3.5" viewBox="0 0 20 20" fill="none">
        {type === 'JOB_FAILED' ? (
          <path
            d="M10 6.5v4M10 13.2h.01"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        ) : type === 'PROJECT_CREATED' ? (
          <path
            d="M3 6.5A1.5 1.5 0 0 1 4.5 5h2.7l1.4 1.8h6.9A1.5 1.5 0 0 1 17 8.3v5.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 13.5v-7Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        ) : type === 'DOCUMENT_UPLOADED' ? (
          <path
            d="M10 12.5V5m0 0L7 8m3-3 3 3M4 13.5v1A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5v-1"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="m4 10.5 3.5 3.5L16 5.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </span>
  );
}

/** Buckets in the order they should appear, newest bucket first. */
function groupByBucket(activity: Activity[]): Array<{ label: string; items: Activity[] }> {
  const groups: Array<{ label: string; items: Activity[] }> = [];

  for (const item of activity) {
    const label = historyBucket(item.createdAt);
    const last = groups[groups.length - 1];

    // The API returns newest-first, so a bucket is never revisited once left —
    // appending is enough and no map-and-resort is needed.
    if (last && last.label === label) {
      last.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }

  return groups;
}
