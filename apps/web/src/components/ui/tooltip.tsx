import { cn } from '@/lib/cn';

/**
 * Tooltip — a label for an icon-only control.
 *
 * CSS-only, driven by `group-hover` / `group-focus-within`. A JavaScript
 * tooltip library exists to solve positioning and collision, which matters for
 * a rich tooltip; for "what does this icon do?", a positioned span is the whole
 * requirement and it cannot leak an event listener.
 *
 * `focus-within` is not optional: an icon button with no visible text is
 * unusable by keyboard without it, and that is precisely the case this exists
 * for. `title` is deliberately not used instead — it is unreliable for touch
 * and cannot be styled.
 */
export function Tooltip({
  label,
  children,
  side = 'top',
  className,
}: {
  label: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}) {
  return (
    <span className={cn('group/tooltip relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap',
          'rounded-md border border-line-strong bg-overlay px-2 py-1',
          'text-[0.6875rem] font-medium text-ink shadow-[0_8px_24px_-8px_rgba(0,0,0,0.7)]',
          'opacity-0 transition-opacity duration-150 group-hover/tooltip:opacity-100',
          'group-focus-within/tooltip:opacity-100',
          side === 'top' ? 'bottom-[calc(100%+0.375rem)]' : 'top-[calc(100%+0.375rem)]',
        )}
      >
        {label}
      </span>
    </span>
  );
}
