import { cn } from '@/lib/cn';

/**
 * Skeleton — placeholder geometry for a loading view.
 *
 * Sized by the caller to match the content it stands in for. A skeleton whose
 * shape differs from the eventual content causes a layout jump on load, which
 * is worse than showing nothing: the eye has already committed to where things
 * are.
 */

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse-soft rounded-md bg-raised', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

/** A stack of text-like bars. `widths` are Tailwind width classes. */
export function SkeletonLines({
  lines = 3,
  widths = ['w-full', 'w-11/12', 'w-2/3'],
  className,
}: {
  lines?: number;
  widths?: string[];
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-3', widths[index % widths.length])} />
      ))}
    </div>
  );
}

/**
 * The loading view for a list of rows.
 *
 * Every list in the dashboard is "avatar-ish square, two lines, trailing chip",
 * so one component covers documents, projects and history rather than each
 * screen inventing its own silhouette.
 */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('divide-y divide-line', className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}
