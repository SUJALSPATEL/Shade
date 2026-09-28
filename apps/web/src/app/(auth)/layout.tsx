import Link from 'next/link';
import { Backronym, LogoMark } from '@/components/brand/logo';

/**
 * The auth shell.
 *
 * Two panes: the form on the right, and on the left something worth looking at
 * while the form loads. That is not decoration for its own sake — the sign-in
 * screen is where an anonymous user commits to an account, and it is the last
 * place the product gets to remind them what they are signing up for.
 *
 * On narrow screens the left pane drops and the form centres, because a
 * decorative panel that pushes the only interactive element below the fold is
 * a worse screen than a plain one.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="ambient" aria-hidden="true" />
        <div className="grid-dots" aria-hidden="true" />

        <div className="relative">
          <Link href="/" className="inline-flex rounded-lg" aria-label="Shade home">
            <span className="flex items-center gap-2.5">
              <LogoMark size={28} />
              <span className="text-[0.9375rem] font-semibold tracking-[-0.02em] text-ink">
                Shade
              </span>
            </span>
          </Link>
        </div>

        <div className="relative max-w-md">
          <Backronym />

          <p className="mt-6 text-pretty text-2xl font-semibold leading-snug tracking-[-0.02em] text-ink">
            The document is the input.
            <br />
            <span className="text-ink-muted">The structure is the product.</span>
          </p>

          <div className="mt-8 space-y-3">
            {[
              'Every region returned with a page and a bounding box.',
              'Each extracted value carries its own confidence.',
              'Raw bytes stay in object storage — never in the database.',
            ].map((line) => (
              <p key={line} className="flex gap-2.5 text-[0.8125rem] leading-relaxed text-ink-muted">
                <span className="mt-[0.45rem] size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                {line}
              </p>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-ink-faint">
          Structured Harvest · Agentic Document Extraction
        </p>
      </aside>

      <main className="flex items-center justify-center px-5 py-14 sm:px-8">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
