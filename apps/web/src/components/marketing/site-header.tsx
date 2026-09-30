'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wordmark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * The public site header — landing and auth screens only.
 *
 * Not the dashboard's header: that one has to carry a sidebar toggle and the
 * user's menu. These are different headers that happen to sit in the same place,
 * and merging them would mean a component with a `variant` prop that changes
 * half its structure.
 *
 * This header is deliberately static in what it *knows*. Whether the visitor is
 * signed in is a client-side question (the session cookie is `httpOnly`), so
 * asking it here would make the whole page dynamic and cost the marketing page
 * its static render. Instead both actions are offered, and the auth screens
 * redirect a visitor who turns out to already have a session.
 *
 * It is a client component for one reason only: the mobile menu. That is a
 * genuine piece of interactive state, and it is cheaper to hold it here than to
 * put a second copy of the navigation in a separate component that can drift
 * out of sync with this one.
 */

const NAV = [
  { href: '/#operations', label: 'Operations' },
  { href: '/#pipeline', label: 'Pipeline' },
  { href: '/#output', label: 'Output' },
  { href: '/#architecture', label: 'Architecture' },
] as const;

export function SiteHeader({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Any navigation closes the drawer. Without this, tapping a link on mobile
  // leaves the menu covering the section it just scrolled to.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While the drawer is open the page behind it must not scroll — otherwise the
  // body scrolls under a fixed panel and the close button drifts off-screen.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <header className={cn('sticky top-0 z-40', className)}>
      <AnnouncementBar />

      <div className="glass border-b border-line/70">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
          <Link href="/" className="rounded-lg" aria-label="Shade home">
            <Wordmark tagline={false} />
          </Link>

          <nav className="hidden items-center gap-0.5 md:flex" aria-label="Product">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-[0.8125rem] text-ink-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
            <Link href="/parse">
              <Button variant="primary" size="sm">
                Start parsing
              </Button>
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="-mr-2 flex size-10 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink md:hidden"
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>

      {/* The drawer. Rendered unconditionally and hidden with `hidden`, so the
          links are in the DOM for a crawler and the transition has something to
          animate from. */}
      <div
        id="site-menu"
        hidden={!open}
        className="glass border-b border-line md:hidden"
      >
        <nav className="mx-auto w-full max-w-6xl px-5 py-4 sm:px-8" aria-label="Product">
          <ul className="flex flex-col">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block rounded-lg px-3 py-3 text-sm text-ink-muted transition-colors hover:bg-raised hover:text-ink"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
            <Link href="/login" className="contents">
              <Button variant="secondary" size="md" block>
                Sign in
              </Button>
            </Link>
            <Link href="/parse" className="contents">
              <Button variant="primary" size="md" block>
                Start parsing
              </Button>
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}

/**
 * The announcement strip.
 *
 * One line, above the navigation, carrying the only piece of time-sensitive
 * information the page has. It is not dismissible: a dismiss control means
 * state, and the strip is worth exactly one sentence — if it ever needs more
 * than that it should be a section, not a banner.
 *
 * It is the one saturated band on the page, and that is deliberate. On a canvas
 * this pale the eye needs somewhere to land before it reaches the headline, and
 * a full-width strip of the brand's lime does that in a way a tinted-off-white
 * bar never will. It is also the honest place for it: the strip is the only
 * thing above the logo, so making it the loudest costs the navigation nothing.
 */
function AnnouncementBar() {
  return (
    <div
      className="relative border-b border-[#a8c22c]"
      style={{
        backgroundImage: 'linear-gradient(90deg, #d7e86a, #c3d93f 46%, #b6d132)',
      }}
    >
      <div className="relative mx-auto flex w-full max-w-6xl items-center justify-center gap-2 px-5 py-2 sm:px-8">
        <span
          className="hidden size-1.5 shrink-0 rounded-full bg-accent-deep sm:block"
          aria-hidden="true"
        />
        <p className="text-center text-[0.75rem] text-accent-deep">
          <span className="font-semibold">Parse, Extract and Split are live.</span>{' '}
          <Link
            href="/parse"
            className="underline decoration-accent-deep/40 underline-offset-2 transition-colors hover:decoration-accent-deep"
          >
            Try it on one document
          </Link>{' '}
          — no account needed.
        </p>
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg className="size-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 6h14M3 10h14M3 14h14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="size-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="m5.5 5.5 9 9m0-9-9 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
