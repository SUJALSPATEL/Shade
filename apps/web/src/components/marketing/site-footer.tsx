import Link from 'next/link';
import { LogoMark } from '@/components/brand/logo';
import { cn } from '@/lib/cn';

/**
 * The public site footer.
 *
 * Every link here resolves. A marketing footer is the easiest place in a
 * product to accumulate dead `#` anchors and routes that were planned and never
 * built, and a visitor who clicks one learns something about the product that
 * no amount of copy can undo. Where a destination does not exist yet, the item
 * is simply not listed.
 */

const COLUMNS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { href: '/parse', label: 'Parse' },
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/projects', label: 'Projects' },
      { href: '/history', label: 'History' },
    ],
  },
  {
    heading: 'How it works',
    links: [
      { href: '/#operations', label: 'Operations' },
      { href: '/#pipeline', label: 'Pipeline' },
      { href: '/#output', label: 'Output' },
      { href: '/#faq', label: 'FAQ' },
    ],
  },
  {
    heading: 'Account',
    links: [
      { href: '/login', label: 'Sign in' },
      { href: '/signup', label: 'Create account' },
      { href: '/parse', label: 'Try one document' },
    ],
  },
];

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('relative mt-8 border-t border-line', className)}>
      {/* A wash of the brand colour rising from the bottom edge, so the page
          ends on the same light it opened with rather than on a hard border. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-64"
        style={{
          backgroundImage:
            'radial-gradient(40rem 16rem at 50% 130%, #6e56cf26, transparent 70%)',
        }}
        aria-hidden="true"
      />

      <div className="relative mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2.5" aria-label="Shade home">
              <LogoMark size={26} />
              <span className="text-[0.9375rem] font-semibold tracking-[-0.025em] text-ink">
                Shade
              </span>
            </Link>

            <p className="mt-4 max-w-xs text-pretty text-[0.8125rem] leading-relaxed text-ink-muted">
              Convert complex documents into structured, agent-ready representations.
            </p>

            {/* Broken across two lines deliberately. The backronym is six
                words in a monospace face inside a narrow column, so left to
                wrap on its own it strands a single word on the second line. */}
            <p className="mt-6 font-mono text-[0.6875rem] leading-relaxed text-ink-faint">
              <span className="block">
                <span className="text-accent-bright">S</span>tructured{' '}
                <span className="text-accent-bright">H</span>arvest
              </span>
              <span className="block">
                <span className="text-accent-bright">A</span>gentic{' '}
                <span className="text-accent-bright">D</span>ocument{' '}
                <span className="text-accent-bright">E</span>xtraction
              </span>
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
                {column.heading}
              </h2>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={`${column.heading}-${link.label}`}>
                    <Link
                      href={link.href}
                      className="text-[0.8125rem] text-ink-muted transition-colors duration-150 hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-line pt-6 sm:flex-row sm:items-center">
          <p className="text-[0.75rem] text-ink-faint">
            © {new Date().getFullYear()} Shade. Built for documents that resist a template.
          </p>
          <p className="font-mono text-[0.6875rem] text-ink-faint">
            Markdown first. Everything traceable.
          </p>
        </div>
      </div>
    </footer>
  );
}
