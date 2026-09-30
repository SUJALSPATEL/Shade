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
 *
 * The primary button is a gradient rather than a flat fill. Against a near-black
 * canvas a solid violet reads as a swatch; the same violet with a vertical
 * gradient and a one-pixel inner highlight along its top edge reads as a
 * physical key, which is what makes it look pressable before anyone hovers it.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'text-white bg-[linear-gradient(180deg,#8168e0,#6e56cf)] border border-[#8b78e8]/40 ' +
    'shadow-[0_1px_0_0_#ffffff2e_inset,0_10px_24px_-10px_#6e56cfcc] ' +
    'hover:bg-[linear-gradient(180deg,#8f78ea,#7860d8)] hover:shadow-[0_1px_0_0_#ffffff38_inset,0_14px_32px_-10px_#6e56cfe6] ' +
    'active:bg-[linear-gradient(180deg,#6e56cf,#5d47b8)]',
  secondary:
    'bg-raised text-ink border border-line-strong ' +
    'shadow-[0_1px_0_0_#ffffff0f_inset] ' +
    'hover:bg-overlay hover:border-[#3f3f50] active:bg-raised',
  outline:
    'bg-transparent text-ink border border-line-strong hover:bg-raised hover:border-[#3f3f50]',
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
        'transition-all duration-150 ease-[var(--ease-out-soft)]',
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
