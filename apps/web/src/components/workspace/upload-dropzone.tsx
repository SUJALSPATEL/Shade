'use client';

import { useCallback, useRef, useState } from 'react';
import { formatBytes } from '@shade/shared';
import { ACCEPT_ATTRIBUTE, describeUploadProblem, MAX_UPLOAD_BYTES } from '@/lib/upload';
import { cn } from '@/lib/cn';

/**
 * File dropzone, and the client-side half of upload validation.
 *
 * The drop target is the whole card, including the parts that look like
 * decoration — a dropzone that only accepts a drop on the visible dashed
 * rectangle is one users miss. `dragenter`/`dragleave` are counted rather than
 * toggled, because dragging over a child element fires `dragleave` on the
 * parent and a naive boolean flickers the highlight off mid-drag.
 *
 * The checks here duplicate the server's, and that is the point: rejecting a
 * 60 MB file in the picker takes no time at all, while rejecting it after the
 * upload takes a minute. The server still re-checks everything — a client-side
 * rule is a courtesy, never a control.
 */
export function UploadDropzone({
  onFile,
  disabled = false,
  compact = false,
  className,
}: {
  onFile: (file: File) => void;
  disabled?: boolean;
  /** Shorter padding and no format line — for use inside a dialog. */
  compact?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const accept = useCallback(
    (file: File | undefined) => {
      if (!file) return;

      const issue = describeUploadProblem(file);
      if (issue) {
        setProblem(issue);
        return;
      }

      setProblem(null);
      onFile(file);
    },
    [onFile],
  );

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;

    // `dataTransfer.files` can hold several; the first is the one the user
    // meant, and silently uploading the rest would be a surprise.
    accept(event.dataTransfer.files[0]);
  };

  return (
    <div className={className}>
      <div
        onDragEnter={(event) => {
          event.preventDefault();
          if (disabled) return;
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          // Without this the browser navigates to the file on drop.
          event.preventDefault();
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(dragDepth.current - 1, 0);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={onDrop}
        className={cn(
          'relative rounded-[var(--radius-panel)] border-2 border-dashed text-center',
          compact ? 'p-5' : 'p-10',
          'transition-colors duration-200 ease-[var(--ease-out-soft)]',
          disabled
            ? 'border-line bg-surface opacity-60'
            : dragging
              ? 'border-accent bg-accent-soft'
              : 'border-line-strong bg-surface hover:border-accent-line hover:bg-raised',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            accept(event.target.files?.[0]);
            // Reset so choosing the same file twice in a row still fires.
            event.target.value = '';
          }}
        />

        <div
          className={cn(
            'mx-auto flex items-center justify-center rounded-xl border border-line bg-raised text-accent-bright',
            compact ? 'size-9' : 'size-12',
          )}
        >
          <UploadIcon />
        </div>

        <p className={cn('font-medium text-ink', compact ? 'mt-3 text-[0.8125rem]' : 'mt-4 text-sm')}>
          {dragging ? 'Drop to upload' : 'Drop a PDF here'}
        </p>
        <p className={cn('text-ink-muted', compact ? 'mt-1 text-xs' : 'mt-1.5 text-[0.8125rem]')}>
          or{' '}
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="rounded text-accent-bright underline underline-offset-4 decoration-accent-line transition-colors hover:decoration-accent-bright disabled:opacity-50"
          >
            choose a file
          </button>{' '}
          from your computer
        </p>

        {compact ? null : (
          <p className="mt-4 font-mono text-[0.6875rem] text-ink-faint">
            PDF · up to {formatBytes(MAX_UPLOAD_BYTES)}
          </p>
        )}
      </div>

      {problem ? (
        <p role="alert" className="mt-3 text-center text-[0.8125rem] text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function UploadIcon() {
  return (
    <svg className="size-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M3 13v2.5A1.5 1.5 0 0 0 4.5 17h11a1.5 1.5 0 0 0 1.5-1.5V13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
