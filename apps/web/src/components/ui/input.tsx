'use client';

import { forwardRef, useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * Form primitives.
 *
 * `Field` exists so no screen has to remember the three things a labelled input
 * needs: an id wired to the label, `aria-describedby` covering both the hint
 * and the error, and `aria-invalid` on the control itself. Those are the parts
 * that get skipped when a form is written by hand, and they are exactly the
 * parts a screen reader depends on.
 */

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  /** Receives the generated ids so the control can wire itself up. */
  children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
    invalid: boolean;
  }) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="flex items-center gap-1 text-[0.8125rem] font-medium text-ink">
        {label}
        {required ? (
          <span className="text-accent-bright" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        invalid: Boolean(error),
      })}

      {hint && !error ? (
        <p id={hintId} className="text-xs leading-relaxed text-ink-faint">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="text-xs leading-relaxed text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid = false, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-9.5 w-full rounded-lg border bg-raised px-3 text-sm text-ink',
        'placeholder:text-ink-faint',
        'transition-colors duration-150 ease-[var(--ease-out-soft)]',
        'hover:border-line-strong focus:border-accent focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid ? 'border-[#ef5f6880] focus:border-danger' : 'border-line',
        className,
      )}
      {...props}
    />
  );
});

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid = false, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full resize-y rounded-lg border bg-raised px-3 py-2.5 text-sm leading-relaxed text-ink',
        'placeholder:text-ink-faint',
        'transition-colors duration-150 ease-[var(--ease-out-soft)]',
        'hover:border-line-strong focus:border-accent focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid ? 'border-[#ef5f6880] focus:border-danger' : 'border-line',
        className,
      )}
      {...props}
    />
  );
});

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid = false, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'h-9.5 w-full appearance-none rounded-lg border bg-raised pl-3 pr-9 text-sm text-ink',
          'transition-colors duration-150 ease-[var(--ease-out-soft)]',
          'hover:border-line-strong focus:border-accent focus:outline-none',
          'disabled:cursor-not-allowed disabled:opacity-50',
          invalid ? 'border-[#ef5f6880]' : 'border-line',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="m4 6 4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
});
