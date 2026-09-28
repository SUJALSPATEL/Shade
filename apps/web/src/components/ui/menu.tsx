'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Menu — a small popover anchored to a trigger.
 *
 * Deliberately not a full dropdown-menu implementation. It covers what the
 * product actually needs — a row of actions, one of which is usually
 * destructive — and stops there: no submenus, no typeahead, no collision
 * detection beyond flipping the anchor side.
 *
 * What it does get right is dismissal. A menu that only closes on an outside
 * click leaves keyboard users stuck inside it, so Escape closes and returns
 * focus to the trigger, and focus moves into the menu when it opens.
 */

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: React.ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

export function Menu({
  trigger,
  items,
  align = 'end',
  label,
}: {
  trigger: React.ReactNode;
  items: ReadonlyArray<MenuItem | 'separator'>;
  align?: 'start' | 'end';
  /** Accessible name for the menu, e.g. "Document actions". */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Focus the first actionable item rather than the panel, so a keyboard user
    // is one Enter away from the action they opened the menu for.
    panelRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex rounded-lg focus-visible:outline-none"
      >
        {trigger}
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          className={cn(
            'absolute top-[calc(100%+0.375rem)] z-40 min-w-48 overflow-hidden rounded-xl',
            'border border-line bg-overlay p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.75)]',
            'animate-fade-up',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, index) =>
            item === 'separator' ? (
              <div key={`sep-${index}`} role="none" className="my-1 h-px bg-line" />
            ) : (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.8125rem]',
                  'transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40',
                  item.tone === 'danger'
                    ? 'text-danger hover:bg-danger-soft'
                    : 'text-ink-muted hover:bg-raised hover:text-ink',
                )}
              >
                {item.icon ? <span className="shrink-0 opacity-80">{item.icon}</span> : null}
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
