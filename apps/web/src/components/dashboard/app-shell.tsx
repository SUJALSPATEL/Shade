'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/hooks/use-session';
import { Button } from '@/components/ui/button';
import { SkeletonLines } from '@/components/ui/skeleton';
import { LogoMark } from '@/components/brand/logo';
import { Sidebar } from './sidebar';
import { NewDocumentDialog } from './new-document-dialog';

/**
 * The dashboard frame: sidebar, mobile bar, content column.
 *
 * **Why the auth guard is here and not in middleware.** A Next.js middleware
 * could redirect before paint, but it would have to decide from the cookie's
 * *presence*, and presence is not validity — an expired cookie would sail
 * through and land the user on a dashboard whose every request 401s. The only
 * component that can answer "is this session real?" is the API, and the only
 * thing that asks it is `useSession`. So the shell waits for that answer and
 * redirects on the truth rather than on a guess.
 *
 * The cost is one frame of skeleton on a cold load of a protected route, which
 * is a smaller cost than a dashboard that renders and then empties itself.
 *
 * The `next` parameter carries the path being left, so signing back in returns
 * the user to the page they actually wanted rather than to the dashboard root.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { status, isAuthenticated, session } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const [newOpen, setNewOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (status !== 'ready' || isAuthenticated) return;
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, isAuthenticated, pathname, router]);

  // Any navigation closes the mobile drawer — otherwise it stays open over the
  // page the user just asked for.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  if (status === 'loading' || !isAuthenticated) {
    return <ShellSkeleton failed={status === 'error'} />;
  }

  return (
    <div className="flex min-h-dvh bg-canvas">
      <Sidebar
        className="hidden lg:flex"
        user={session?.user ?? null}
        onNewDocument={() => setNewOpen(true)}
      />

      {/* Mobile drawer. Rendered only when open so the sidebar's own state
          resets, and so the off-canvas panel is not in the tab order. */}
      {navOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          />
          <Sidebar
            className="absolute inset-y-0 left-0 w-72 animate-fade-in shadow-[0_0_60px_rgba(0,0,0,0.6)]"
            user={session?.user ?? null}
            onNewDocument={() => {
              setNavOpen(false);
              setNewOpen(true);
            }}
            onNavigate={() => setNavOpen(false)}
          />
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar — the only chrome below `lg`. */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-xl lg:hidden">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
            className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-raised hover:text-ink"
          >
            <svg className="size-4.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M3 5.5h14M3 10h14M3 14.5h14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <Link href="/dashboard" className="flex items-center gap-2">
            <LogoMark size={20} />
            <span className="text-sm font-semibold tracking-[-0.02em] text-ink">Shade</span>
          </Link>

          <Button
            variant="primary"
            size="sm"
            className="ml-auto"
            onClick={() => setNewOpen(true)}
          >
            New
          </Button>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <NewDocumentDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

/**
 * What the shell shows before it knows who you are.
 *
 * Two different jobs: while the session is in flight this is a neutral
 * placeholder that avoids a layout jump, and when the session fetch itself
 * failed it has to admit that rather than spin forever. A spinner that never
 * resolves is the worst version of this screen, so the failed branch says so
 * and offers the one action that can help.
 */
function ShellSkeleton({ failed }: { failed: boolean }) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      <div className="hidden w-64 shrink-0 border-r border-line bg-surface p-4 lg:block">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <LogoMark size={22} />
          <span className="text-sm font-semibold tracking-[-0.02em] text-ink">Shade</span>
        </div>
        <SkeletonLines lines={6} className="mt-8 px-2" />
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center p-8">
        {failed ? (
          <div className="max-w-sm text-center">
            <p className="text-sm font-medium text-ink">Could not reach the Shade API</p>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-muted">
              The dashboard needs a session, and the server did not answer. Check that the API is
              running, then try again.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-5"
              onClick={() => window.location.reload()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className={cn('w-full max-w-3xl')}>
            <SkeletonLines lines={3} className="max-w-md" />
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="h-24 rounded-[var(--radius-card)] border border-line bg-surface" />
              <div className="h-24 rounded-[var(--radius-card)] border border-line bg-surface" />
              <div className="h-24 rounded-[var(--radius-card)] border border-line bg-surface" />
            </div>
            <div className="mt-4 h-64 rounded-[var(--radius-card)] border border-line bg-surface" />
          </div>
        )}
      </div>
    </div>
  );
}
