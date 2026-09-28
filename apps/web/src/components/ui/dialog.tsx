'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

/**
 * Dialog, built on the native `<dialog>` element.
 *
 * This is one of the few places where the platform primitive is strictly better
 * than a hand-rolled portal: `showModal()` gives a real top layer (so no
 * `z-index` arms race with the sticky sidebar), real focus trapping, and Escape
 * to close — all behaviours that a custom implementation typically gets
 * approximately right. The only thing left to do by hand is closing on a
 * backdrop click, because the backdrop is not a DOM node you can listen on.
 *
 * `onClose` fires for every dismissal path — Escape, backdrop, the close
 * button — because the browser fires `close` on the element in all three cases.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      // The dialog element itself fills the viewport with its own box; the
      // visible card is the inner panel. Clicking the element rather than the
      // panel means the click landed on the backdrop.
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        // A column with a scrolling body: a dialog whose content is taller than
        // the viewport must scroll *inside* the panel, or the header and the
        // action row scroll away with it and the buttons become unreachable.
        'm-auto flex max-h-[calc(100dvh-3rem)] w-[calc(100vw-2rem)] flex-col',
        'rounded-[var(--radius-panel)] border border-line bg-overlay p-0',
        'text-ink shadow-[0_24px_64px_-16px_rgba(0,0,0,0.7)]',
        'backdrop:bg-black/60 backdrop:backdrop-blur-[2px]',
        'open:animate-fade-up',
        size === 'sm' && 'max-w-sm',
        size === 'md' && 'max-w-md',
        size === 'lg' && 'max-w-2xl',
      )}
    >
      <div className="shrink-0 border-b border-line px-5 py-4">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-muted">{description}</p>
        ) : null}
      </div>

      {children ? <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div> : null}

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3.5">
        {footer ?? (
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    </dialog>
  );
}
