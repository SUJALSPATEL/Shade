'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { Button, type ButtonSize, type ButtonVariant } from './button';

/**
 * CopyButton — copies text and says so.
 *
 * The confirmation is inline and local rather than a toast. A toast needs a
 * provider at the root, a queue, timers and a portal; the actual requirement is
 * "did that work?", and a button that becomes "Copied" for two seconds answers
 * it at the exact point the user is looking.
 *
 * `navigator.clipboard` is unavailable on insecure origins, which includes
 * `http://localhost` on some browsers and any plain-HTTP deployment. The
 * `execCommand` fallback keeps the button honest there instead of failing
 * silently — this is the single most-used control in the result view.
 */

export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  variant = 'secondary',
  size = 'sm',
  className,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    const ok = await writeToClipboard(value);

    setState(ok ? 'copied' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }, [value]);

  return (
    <Button
      variant={variant}
      size={size}
      className={cn('tabular-nums', className)}
      onClick={() => void copy()}
      icon={<CopyIcon state={state} />}
      aria-live="polite"
    >
      {state === 'copied' ? copiedLabel : state === 'failed' ? 'Press Ctrl+C' : label}
    </Button>
  );
}

async function writeToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission denied or an insecure origin — fall through to the legacy path.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    // Off-screen but still focusable: `display: none` cannot be selected.
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * DownloadButton — saves a string as a file.
 *
 * Built from a Blob rather than a server round trip, because the content is
 * already in the browser: the Markdown the user is looking at is the Markdown
 * they get. Going back to the API for it would let the file and the view
 * disagree if the document were reprocessed in between.
 */
export function DownloadButton({
  value,
  filename,
  mimeType = 'text/plain;charset=utf-8',
  label = 'Download',
  variant = 'secondary',
  size = 'sm',
  className,
}: {
  value: string;
  filename: string;
  mimeType?: string;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      icon={<DownloadIcon />}
      onClick={() => downloadText(value, filename, mimeType)}
    >
      {label}
    </Button>
  );
}

export function downloadText(value: string, filename: string, mimeType: string): void {
  const blob = new Blob([value], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoking immediately can cancel the download in some browsers; one tick is
  // enough for the click to have been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function CopyIcon({ state }: { state: 'idle' | 'copied' | 'failed' }) {
  if (state === 'copied') {
    return (
      <svg className="size-3.5 text-positive" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="m3.5 8.5 3 3 6-7"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2v8m0 0 3-3m-3 3-3-3M2.5 12.5h11"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
