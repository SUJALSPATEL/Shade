'use client';

import Link from 'next/link';
import {
  OPERATION_LABELS,
  formatBytes,
  formatPageCount,
  relativeTime,
  truncate,
  type DocumentWithJob,
} from '@shade/shared';
import { cn } from '@/lib/cn';
import { DocumentStatusBadge, JobStatusBadge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/states';
import { SkeletonRows } from '@/components/ui/skeleton';

/**
 * A list of documents.
 *
 * A table on wide screens and a stack of cards on narrow ones, from one
 * component. The alternative — a real `<table>` that scrolls sideways on a
 * phone — makes every row a horizontal scroll to learn anything, and the
 * columns here are few enough that stacking them loses nothing.
 *
 * The row links to the document rather than carrying its own actions: a list is
 * for finding things, and the things you can do to a document live on the
 * document. The one exception is the project name, which links to the project,
 * because that is the other place a reader is trying to get to.
 */
export function DocumentList({
  documents,
  isLoading = false,
  emptyTitle = 'No documents yet',
  emptyDescription = 'Upload a PDF and Shade will turn it into Markdown, JSON, and a map of its regions.',
  emptyAction,
  showProject = false,
  className,
}: {
  documents: DocumentWithJob[];
  isLoading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  /** Off inside a project, where every row's project is the same one. */
  showProject?: boolean;
  className?: string;
}) {
  if (isLoading) {
    return (
      <div className={cn('px-5 py-4', className)}>
        <SkeletonRows rows={5} />
      </div>
    );
  }

  if (documents.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  return (
    <div className={className}>
      {/* Header row — desktop only, since the mobile layout is labelled inline. */}
      <div className="hidden items-center gap-4 border-b border-line px-5 py-2 lg:flex">
        <ColumnLabel className="min-w-0 flex-1">Document</ColumnLabel>
        {showProject ? <ColumnLabel className="w-36">Project</ColumnLabel> : null}
        <ColumnLabel className="w-28">Status</ColumnLabel>
        <ColumnLabel className="w-40">Last job</ColumnLabel>
        <ColumnLabel className="w-20 text-right">Pages</ColumnLabel>
        <ColumnLabel className="w-20 text-right">Size</ColumnLabel>
        <ColumnLabel className="w-28 text-right">Added</ColumnLabel>
      </div>

      <ul className="divide-y divide-[var(--color-line)]">
        {documents.map((document) => (
          <li key={document.id}>
            <Link
              href={`/documents/${document.id}`}
              className="block px-5 py-3 transition-colors duration-150 ease-[var(--ease-out-soft)] hover:bg-raised/50 focus-visible:bg-raised/50 focus-visible:outline-none"
            >
              {/* Mobile: stacked. Desktop: one row of aligned columns. */}
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
                <div className="min-w-0 lg:flex-1">
                  <p className="truncate text-[0.8125rem] font-medium text-ink">
                    {document.filename}
                  </p>
                  {document.summary ? (
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {truncate(document.summary, 96)}
                    </p>
                  ) : null}
                </div>

                {showProject ? (
                  <div className="hidden w-36 lg:block">
                    {document.projectId ? (
                      <span className="truncate font-mono text-[0.6875rem] text-ink-faint">
                        {document.projectId.slice(0, 12)}…
                      </span>
                    ) : (
                      <span className="text-xs text-ink-faint">—</span>
                    )}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 lg:w-28 lg:flex-nowrap">
                  <DocumentStatusBadge status={document.status} />
                </div>

                <div className="flex items-center gap-2 lg:w-40">
                  {document.latestJob ? (
                    <>
                      <JobStatusBadge status={document.latestJob.status} />
                      <span className="truncate font-mono text-[0.6875rem] text-ink-faint">
                        {OPERATION_LABELS[document.latestJob.operation]}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-ink-faint">No jobs</span>
                  )}
                </div>

                {/* The three numeric cells sit in their own row on mobile and
                    dissolve into the parent row at `lg` via `display: contents`
                    — which is the one CSS feature that lets a single set of
                    spans be both a mobile group and desktop columns without
                    rendering the row twice. */}
                <div className="flex items-center gap-4 font-mono text-[0.6875rem] text-ink-faint lg:contents">
                  <span className="lg:w-20 lg:text-right">
                    {formatPageCount(document.pageCount)}
                  </span>
                  <span className="lg:w-20 lg:text-right">{formatBytes(document.sizeBytes)}</span>
                  <span className="lg:w-28 lg:text-right">{relativeTime(document.createdAt)}</span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ColumnLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'text-[0.6875rem] font-medium uppercase tracking-[0.04em] text-ink-faint',
        className,
      )}
    >
      {children}
    </span>
  );
}
