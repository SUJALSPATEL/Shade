import Link from 'next/link';
import { Wordmark } from '@/components/brand/logo';

/**
 * The public site footer.
 *
 * The "mocked today" note is deliberate and belongs here rather than in a
 * README. A visitor who uploads a PDF and gets a beautifully structured result
 * in two seconds has been told something that is not true about what the
 * product can currently do, and the honest place to correct that is on the page
 * they are already reading — not in a file they will never open.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <Wordmark block />
            <p className="mt-4 text-[0.8125rem] leading-relaxed text-ink-muted">
              A document engineering platform. Upload a PDF, get Markdown, typed JSON, and the
              regions behind both.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-12 gap-y-8 sm:grid-cols-3">
            <FooterColumn
              title="Product"
              links={[
                { href: '/parse', label: 'Workspace' },
                { href: '/dashboard', label: 'Dashboard' },
                { href: '/projects', label: 'Projects' },
                { href: '/history', label: 'History' },
              ]}
            />
            <FooterColumn
              title="Operations"
              links={[
                { href: '/#operations', label: 'Parse' },
                { href: '/#operations', label: 'Extract' },
                { href: '/#operations', label: 'Split' },
              ]}
            />
            <FooterColumn
              title="Account"
              links={[
                { href: '/login', label: 'Sign in' },
                { href: '/signup', label: 'Create account' },
              ]}
            />
          </div>
        </div>

        <div className="rule-fade my-8" />

        <div className="flex flex-col gap-3 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <p>Shade — Structured Harvest · Agentic Document Extraction</p>
          <p className="text-ink-faint">
            First milestone: processing is mocked. The pipeline, contracts and storage are real.
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: Array<{ href: string; label: string }>;
}) {
  return (
    <div>
      <p className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ink-faint">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map((link) => (
          <li key={`${link.href}-${link.label}`}>
            <Link
              href={link.href}
              className="rounded text-[0.8125rem] text-ink-muted transition-colors duration-150 hover:text-ink"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
