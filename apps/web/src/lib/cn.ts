import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names with Tailwind conflict resolution.
 *
 * `clsx` handles the conditionals; `tailwind-merge` resolves conflicts so that
 * a caller's override actually wins — `cn('px-4', 'px-6')` is `px-6`, not both.
 * Without the merge step, a component's own padding would beat every override
 * and the only way to change it would be to edit the component.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
