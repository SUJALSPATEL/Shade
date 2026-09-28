import { cn } from '@/lib/cn';

/**
 * Card — the base surface.
 *
 * Every panel in the product is one of these, so the border, radius and
 * background are decided once. `CardHeader` takes an optional action slot
 * because "title on the left, one control on the right" is the shape almost
 * every panel in the dashboard actually has.
 */

export function Card({
  className,
  interactive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-card)] border border-line bg-surface',
        interactive &&
          'transition-colors duration-150 ease-[var(--ease-out-soft)] hover:border-line-strong hover:bg-raised',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-line px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center gap-2 border-t border-line px-5 py-3.5', className)}
      {...props}
    />
  );
}
