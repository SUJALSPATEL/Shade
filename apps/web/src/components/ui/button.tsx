'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

/**
 * Button.
 *
 * Variants are a closed set rather than a `className` free-for-all, because the
 * point of a design system is that the same intent looks the same everywhere.
 * `className` is still accepted for layout — margins and widths — so a button
 * can be placed without being re-skinned.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset,0_8px_20px_-8px_var(--color-accent-deep)] hover:bg-accent-bright active:bg-accent-deep',
  secondary:
    'bg-raised text-ink border border-line-strong hover:bg-overlay hover:border-[#3d3d4c] active:bg-raised',
  ghost: 'text-ink-muted hover:text-ink hover:bg-raised active:bg-overlay',
  danger:
    'bg-danger-soft text-danger border border-[#ef5f6840] hover:bg-[#ef5f6826] hover:border-[#ef5f6866]',
  link: 'text-accent-bright hover:text-ink underline underline-offset-4 decoration-accent-line hover:decoration-accent-bright px-0',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[0.8125rem] gap-1.5 rounded-lg',
  md: 'h-9.5 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[0.9375rem] gap-2 rounded-xl',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Swaps the label for a spinner and blocks interaction. */
  loading?: boolean;
  /** Stretches to the container — the common case in a form or a card footer. */
  block?: boolean;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    block = false,
    icon,
    iconRight,
    className,
    children,
    disabled,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      // Defaulting to `type="button"` matters: a bare <button> inside a form
      // submits it, so every icon-only control in the app would silently submit
      // whatever form it happened to be nested in.
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-colors duration-150 ease-[var(--ease-out-soft)]',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
      {!loading && iconRight}
    </button>
  );
});

function Spinner() {
  return (
    <svg
      className="size-3.5 shrink-0 animate-spin"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M14.5 8A6.5 6.5 0 0 0 8 1.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
