'use client';

import { useMemo, useState } from 'react';
import { ACTIVITY_TYPES, type ActivityType } from '@shade/shared';
import { history as historyApi } from '@/lib/endpoints';
import { useResource } from '@/lib/hooks/use-resource';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';
import { PageHeader, StatCard } from '@/components/dashboard/page-header';
import { ActivityFeed } from '@/components/dashboard/activity-feed';

/**
 * History.
 *
 * The feed, unfiltered and paginated. Two things make it more than a log dump:
 * the filter chips, because "when did that job fail" is a question that starts
 * with narrowing, and the summary counts, because they answer "is anything
 * broken" before the reader has scrolled.
 *
 * Filtering is server-side. The alternative — fetch 500 rows and filter in the
 * browser — works until an account has 5,000 rows, at which point the honest
 * fix is the one already written here.
 */
export default function HistoryPage() {
  const [type, setType] = useState<ActivityType | 'ALL'>('ALL');
  const [pages, setPages] = useState(1);

  const summary = useResource('history:summary', () => historyApi.summary());

  // The key carries the filter and the page count, so changing either refetches
  // and `useResource` handles the reset — no effect, no stale rows.
  const feed = useResource(`history:${type}:${pages}`, () =>
    historyApi.list({
      limit: 25 * pages,
      ...(type === 'ALL' ? {} : { type }),
    }),
  );

  const counts = summary.data?.counts ?? {};
  const failed = counts.JOB_FAILED ?? 0;

  const activity = useMemo(() => feed.data?.data ?? [], [feed.data]);
  const hasMore = feed.data?.nextCursor != null;

  return (
    <>
      <PageHeader
        title="History"
        description="Every job Shade has run, and what it produced."
      />

      <div className="space-y-6 p-4 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Total events" value={summary.data?.total ?? '—'} />
          <StatCard label="Documents uploaded" value={counts.DOCUMENT_UPLOADED ?? 0} />
          <StatCard label="Parse runs" value={counts.DOCUMENT_PARSED ?? 0} tone="accent" />
          <StatCard
            label="Failures"
            value={failed}
            tone={failed > 0 ? 'danger' : 'default'}
            hint={failed > 0 ? 'Open a document to see the error' : 'None'}
          />
        </div>

        <Card>
          <CardHeader
            title="Events"
            description={
              type === 'ALL'
                ? 'Newest first.'
                : `Filtered to ${LABELS[type]}.`
            }
            action={
              feed.isRefreshing ? (
                <span className="font-mono text-[0.6875rem] text-ink-faint">Refreshing…</span>
              ) : null
            }
          />

          <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3">
            <FilterChip
              label="All"
              active={type === 'ALL'}
              onClick={() => {
                setType('ALL');
                setPages(1);
              }}
            />
            {ACTIVITY_TYPES.map((value) => (
              <FilterChip
                key={value}
                label={LABELS[value]}
                count={counts[value]}
                active={type === value}
                onClick={() => {
                  setType(value);
                  setPages(1);
                }}
              />
            ))}
          </div>

          {feed.error && !feed.data ? (
            <ErrorState error={feed.error} onRetry={feed.reload} compact />
          ) : (
            <>
              <ActivityFeed
                activity={activity}
                isLoading={feed.isLoading}
                emptyTitle={type === 'ALL' ? 'Nothing has happened yet' : 'Nothing of that kind'}
                emptyDescription={
                  type === 'ALL'
                    ? 'Upload a document and the work Shade does on it shows up here.'
                    : 'Try a different filter, or clear it to see everything.'
                }
              />

              {hasMore ? (
                <div className="border-t border-line px-5 py-3.5 text-center">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={feed.isRefreshing}
                    onClick={() => setPages((value) => value + 1)}
                  >
                    {feed.isRefreshing ? 'Loading…' : 'Load more'}
                  </Button>
                  <p className="mt-2 font-mono text-[0.6875rem] text-ink-faint">
                    Showing {activity.length} of {summary.data?.total ?? 'more'}
                  </p>
                </div>
              ) : activity.length > 0 ? (
                <p className="border-t border-line px-5 py-3 text-center font-mono text-[0.6875rem] text-ink-faint">
                  End of history · {activity.length} events
                </p>
              ) : null}
            </>
          )}
        </Card>
      </div>
    </>
  );
}

/** Human labels for the activity vocabulary, which is machine-shaped. */
const LABELS: Record<ActivityType, string> = {
  PROJECT_CREATED: 'Project created',
  DOCUMENT_UPLOADED: 'Uploads',
  DOCUMENT_PARSED: 'Parses',
  DOCUMENT_EXTRACTED: 'Extractions',
  DOCUMENT_SPLIT: 'Splits',
  JOB_FAILED: 'Failures',
};

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        'transition-colors duration-150 ease-[var(--ease-out-soft)]',
        active
          ? 'border-accent-line bg-accent-soft text-accent-bright'
          : 'border-line bg-raised text-ink-muted hover:border-line-strong hover:text-ink',
      )}
    >
      {label}
      {count !== undefined ? (
        <span className="font-mono text-[0.625rem] tabular-nums text-ink-faint">{count}</span>
      ) : null}
    </button>
  );
}
