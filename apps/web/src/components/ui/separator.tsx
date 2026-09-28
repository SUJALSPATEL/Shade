import { cn } from '@/lib/cn';

/**
 * Separator.
 *
 * `decorative` defaults to true, which maps to `role="none"` — a rule drawn
 * between two visual groups is not a boundary in the document's structure, and
 * announcing it would add noise to every list in the app. A separator that
 * genuinely divides sections passes `decorative={false}` and is announced.
 */
export function Separator({
  orientation = 'horizontal',
  decorative = true,
  className,
}: {
  orientation?: 'horizontal' | 'vertical';
  decorative?: boolean;
  className?: string;
}) {
  return (
    <div
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      className={cn(
        'shrink-0 bg-line',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
    />
  );
}
