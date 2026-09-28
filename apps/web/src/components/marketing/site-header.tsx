import Link from 'next/link';
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
 * This header is deliberately static. Whether the visitor is signed in is a
 * client-side question (the session cookie is `httpOnly`), so asking it here
 * would make the whole page dynamic and cost the marketing page its static
 * render. Instead both actions are offered, and the auth screens redirect a
 * visitor who turns out to already have a session.
 */
export function SiteHeader({ className }: { className?: string }) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b border-line/60 bg-canvas/80 backdrop-blur-xl',
        className,
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" className="rounded-lg" aria-label="Shade home">
          <Wordmark tagline={false} />
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Product">
          <HeaderLink href="/#operations">Operations</HeaderLink>
          <HeaderLink href="/#pipeline">Pipeline</HeaderLink>
          <HeaderLink href="/#output">Output</HeaderLink>
        </nav>

        <div className="flex items-center gap-2">
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
      </div>
    </header>
  );
}

function HeaderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-2 text-[0.8125rem] text-ink-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
    >
      {children}
    </Link>
  );
}
