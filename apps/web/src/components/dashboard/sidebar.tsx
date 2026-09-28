'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import type { User } from '@shade/shared';
import { useSession } from '@/lib/hooks/use-session';
import { Button } from '@/components/ui/button';
import { Menu } from '@/components/ui/menu';
import { LogoMark } from '@/components/brand/logo';

/**
 * The sidebar.
 *
 * Four destinations, and the discipline is in what is *not* here. Projects,
 * History and the Parse workspace are the whole product surface for this
 * milestone; a nav that also listed Settings, Schemas, Team and Billing would
 * be advertising four screens that do not exist, and every one of them would be
 * a dead link a user could click.
 *
 * `match` rather than a plain href comparison, because `/projects/prj_123` is
 * still "Projects" as far as a reader is concerned — a nav item that stops
 * being highlighted one level deep is a nav that looks broken.
 */

interface NavItem {
  href: string;
  label: string;
  /** Paths that should keep this item lit. */
  match: string[];
  icon: React.ReactNode;
}

const NAV: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    match: ['/dashboard'],
    icon: (
      <path
        d="M3.5 9.2 10 4l6.5 5.2V16a1 1 0 0 1-1 1h-3.2v-4.2H7.7V17H4.5a1 1 0 0 1-1-1V9.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    href: '/projects',
    label: 'Projects',
    match: ['/projects'],
    icon: (
      <path
        d="M3 6.5A1.5 1.5 0 0 1 4.5 5h2.7l1.4 1.8h6.9A1.5 1.5 0 0 1 17 8.3v5.2a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 13.5v-7Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    href: '/history',
    label: 'History',
    match: ['/history'],
    icon: (
      <>
        <path
          d="M10 5.2V10l3 1.8"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path d="M16.6 2.6v3.1h-3.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
];

export function Sidebar({
  user,
  onNewDocument,
  onNavigate,
  className,
}: {
  user: User | null;
  onNewDocument: () => void;
  /** Called after a nav click — used by the mobile drawer to close itself. */
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const { signOut } = useSession();

  return (
    <aside
      className={cn(
        'flex w-64 shrink-0 flex-col border-r border-line bg-surface',
        className,
      )}
    >
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2.5 rounded-lg"
          aria-label="Shade dashboard"
        >
          <LogoMark size={22} />
          <span className="flex flex-col">
            <span className="text-sm font-semibold leading-none tracking-[-0.02em] text-ink">
              Shade
            </span>
            <span className="mt-0.5 text-[0.625rem] leading-none text-ink-faint">
              Agentic Document Extraction
            </span>
          </span>
        </Link>
      </div>

      <div className="px-3 pt-1">
        <Button variant="primary" size="sm" className="w-full" onClick={onNewDocument}>
          <svg className="size-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M10 4.5v11M4.5 10h11"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          New document
        </Button>
      </div>

      <nav aria-label="Main" className="mt-4 flex-1 space-y-0.5 px-3">
        {NAV.map((item) => {
          const active = item.match.some(
            (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
          );

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] font-medium',
                'transition-colors duration-150 ease-[var(--ease-out-soft)]',
                active
                  ? 'bg-raised text-ink'
                  : 'text-ink-muted hover:bg-raised/60 hover:text-ink',
              )}
            >
              <svg className="size-4 shrink-0" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                {item.icon}
              </svg>
              {item.label}
            </Link>
          );
        })}

        {/* The anonymous workspace is not a sibling of these — it is the same
            product before the account exists, so it sits under a rule. */}
        <div className="!mt-4 border-t border-line pt-3">
          <Link
            href="/parse"
            onClick={onNavigate}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] font-medium text-ink-muted transition-colors duration-150 ease-[var(--ease-out-soft)] hover:bg-raised/60 hover:text-ink"
          >
            <svg className="size-4 shrink-0" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M10 3.5 3.5 7 10 10.5 16.5 7 10 3.5Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <path
                d="m3.5 12 6.5 3.5 6.5-3.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Quick parse
          </Link>
        </div>
      </nav>

      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-raised font-mono text-[0.6875rem] uppercase text-ink-muted"
          >
            {initials(user)}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.8125rem] font-medium text-ink">
              {user?.name ?? 'Your workspace'}
            </p>
            <p className="truncate text-[0.6875rem] text-ink-faint">{user?.email ?? ''}</p>
          </div>

          <Menu
            label="Account"
            items={[
              {
                label: 'Sign out',
                tone: 'danger',
                onSelect: () => {
                  // `signOut` re-reads the session rather than nulling it: the
                  // API answers a logout by issuing a fresh anonymous session,
                  // and the shell's guard is what turns that into a redirect.
                  void signOut().then(() => {
                    window.location.href = '/';
                  });
                },
              },
            ]}
            trigger={
              <span className="flex size-7 items-center justify-center rounded-lg text-ink-faint hover:bg-raised hover:text-ink">
                <svg className="size-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M10 5.5v9M6 8l-2.5 2L6 12M14 8l2.5 2L14 12"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            }
          />
        </div>
      </div>
    </aside>
  );
}

/** `Ada Lovelace` → `AL`; a nameless account falls back to its address. */
function initials(user: User | null): string {
  const source = user?.name?.trim() || user?.email || '';
  if (!source) return '—';

  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? (parts[1]?.[0] ?? '') : '';
  return (first + second).toUpperCase() || '—';
}
