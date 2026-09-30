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
 * The primary button is the deepest green in the palette, with a slight vertical
 * gradient and a one-pixel inner highlight along its top edge. On a light page
 * the temptation is to make the primary action the *brightest* thing on screen;
 * that is backwards. Brightness is cheap here — everything around it is already
 * light — so the button that carries the weight is the one that goes dark. It is
 * also the single highest-contrast object on the page, which is what a primary
 * action should be.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'text-white bg-[linear-gradient(180deg,#33590c,#274708)] border border-[#274708] ' +
    'shadow-[0_1px_0_0_#ffffff26_inset,0_8px_20px_-10px_#27470899] ' +
    'hover:bg-[linear-gradient(180deg,#3d661a,#2e5210)] hover:shadow-[0_1px_0_0_#ffffff33_inset,0_12px_26px_-10px_#274708b3] ' +
    'active:bg-[linear-gradient(180deg,#234006,#1d3a05)]',
  secondary:
    'bg-surface text-ink border border-line-strong ' +
    'shadow-[0_1px_2px_-1px_#161c111a] ' +
    'hover:bg-raised hover:border-[#b0bd92] active:bg-raised',
  outline:
    'bg-transparent text-ink border border-line-strong hover:bg-raised hover:border-[#b0bd92]',
  ghost: 'text-ink-muted hover:text-ink hover:bg-raised active:bg-overlay',
  danger:
    'bg-danger-soft text-danger border border-danger/30 hover:bg-danger/15 hover:border-danger/50',
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
