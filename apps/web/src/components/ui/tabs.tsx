'use client';

import { useCallback, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Tabs.
 *
 * Controlled rather than uncontrolled, because the workspace needs to move the
 * selection from outside the tab strip — clicking a chunk in the preview jumps
 * to the JSON tab, and clicking a citation in an extracted field jumps back to
 * the preview. A component that owns its own index cannot be driven that way.
 *
 * Keyboard behaviour is the full ARIA pattern: arrows move and select, Home and
 * End jump to the ends, and only the selected tab is in the tab order, so Tab
 * moves past the strip rather than through every tab in it.
 */

export interface TabItem<T extends string = string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** Rendered as a superscript count — used for the chunk and asset counts. */
  count?: number;
  disabled?: boolean;
}

export function Tabs<T extends string>({
  items,
  value,
  onValueChange,
  className,
  size = 'md',
  id,
  'aria-label': ariaLabel,
}: {
  items: ReadonlyArray<TabItem<T>>;
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
  /**
   * Shared with `TabPanel` so a panel can be associated with its tab.
   * Optional: when omitted the component generates one, which is fine for a
   * strip whose panels live inside the same component.
   */
  id?: string;
  'aria-label': string;
}) {
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const listRef = useRef<HTMLDivElement>(null);

  const enabled = items.filter((item) => !item.disabled);
  const currentIndex = items.findIndex((item) => item.value === value);

  const move = useCallback(
    (delta: number | 'first' | 'last') => {
      if (enabled.length === 0) return;

      const activeIndex = enabled.findIndex((item) => item.value === value);
      const from = activeIndex === -1 ? 0 : activeIndex;

      const nextIndex =
        delta === 'first'
          ? 0
          : delta === 'last'
            ? enabled.length - 1
            : (from + delta + enabled.length) % enabled.length;

      // `enabled` is non-empty (guarded above) and `nextIndex` is always within
      // it, so this read cannot actually be out of range.
      const next = enabled[nextIndex];
      if (!next) return;

      onValueChange(next.value);
      // Focus follows selection, so the arrow keys and the mouse leave the
      // keyboard in the same place.
      listRef.current
        ?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${baseId}-tab-${next.value}`)}`)
        ?.focus();
    },
    [baseId, enabled, onValueChange, value],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        move('first');
        break;
      case 'End':
        event.preventDefault();
        move('last');
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex items-center gap-1 rounded-lg border border-line bg-surface p-1',
        className,
      )}
    >
      {items.map((item, index) => {
        const selected = item.value === value;
        const tabId = `${baseId}-tab-${item.value}`;

        return (
          <button
            key={item.value}
            id={tabId}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${baseId}-panel-${item.value}`}
            aria-disabled={item.disabled || undefined}
            disabled={item.disabled}
            // Roving tabindex: Tab enters the strip once, at the selected tab.
            tabIndex={selected || (currentIndex === -1 && index === 0) ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            className={cn(
              'inline-flex items-center gap-2 rounded-md font-medium transition-colors duration-150 ease-[var(--ease-out-soft)]',
              size === 'sm' ? 'h-7 px-3 text-[0.8125rem]' : 'h-8 px-3.5 text-sm',
              selected
                ? 'bg-raised text-ink shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]'
                : 'text-ink-muted hover:bg-raised/60 hover:text-ink',
              item.disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-ink-muted',
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-px font-mono text-[0.625rem] tabular-nums',
                  selected ? 'bg-accent-soft text-accent-bright' : 'bg-raised text-ink-faint',
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Wraps tab content so it is associated with its tab for assistive tech. */
export function TabPanel({
  id,
  value,
  children,
  className,
}: {
  /** The same `id` passed to `Tabs`. */
  id: string;
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      id={`${id}-panel-${value}`}
      role="tabpanel"
      aria-labelledby={`${id}-tab-${value}`}
      tabIndex={0}
      className={cn('focus:outline-none', className)}
    >
      {children}
    </div>
  );
}

/**
 * A local tab index, for the common case where nothing outside the strip needs
 * to change it.
 *
 * `initial` is read once — a caller that wants the tab to survive a re-render
 * should use `Tabs` directly and own the state.
 */
export function useTabState<T extends string>(initial: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(initial);
  return [value, setValue];
}
