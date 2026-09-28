import Link from 'next/link';
import { Backronym } from '@/components/brand/logo';
import { HeroPreview } from '@/components/marketing/hero-preview';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { Button } from '@/components/ui/button';
import { OPERATION_BLURBS, OPERATION_LABELS, OPERATIONS, JOB_STAGE_LABELS } from '@shade/shared';

/**
 * The landing page.
 *
 * Static, and it stays that way. Nothing here reads a cookie or a database, so
 * it renders once at build time and is served as HTML — which is the right
 * property for the page a stranger lands on.
 *
 * The argument the page makes, in order: *what it is* (the hero), *what it can
 * do* (the three operations), *how* (the pipeline), and *what you actually get*
 * (the output). Everything a visitor needs in order to decide is above the
 * fold or one scroll below it; there is no fifth section explaining the fourth.
 */

const PIPELINE = [
  'ACCEPTED',
  'FETCHING',
  'PARSING',
  'LAYOUT',
  'TEXT',
  'TABLES',
  'IMAGES',
  'STRUCTURE',
  'MARKDOWN',
  'JSON',
  'PERSISTING',
] as const;

const OPERATION_DETAIL: Record<(typeof OPERATIONS)[number], { points: string[] }> = {
  PARSE: {
    points: [
      'Markdown with headings, lists, tables and captions reconstructed',
      'A typed JSON tree of sections, tables and assets',
      'Every region returned with a page and a bounding box',
    ],
  },
  EXTRACT: {
    points: [
      'You declare the schema; every field comes back typed',
      'Each value carries a confidence and the chunks that support it',
      'A field that is not in the document returns null — never a guess',
    ],
  },
  SPLIT: {
    points: [
      'Ask a question, get the passages that answer it',
      'Every match explains why it matched',
      'The same retrieval that will back agent tool calls',
    ],
  },
};

export default function LandingPage() {
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <div className="ambient" aria-hidden="true" />
      <div className="grid-dots" aria-hidden="true" />

      <div className="relative">
        <SiteHeader />

        <main>
          {/* ── Hero ─────────────────────────────────────────────────────── */}
          <section className="mx-auto w-full max-w-6xl px-5 pb-16 pt-16 sm:px-8 sm:pt-24">
            <div className="mx-auto max-w-3xl text-center">
              <Backronym className="justify-center animate-fade-in" />

              <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-ink animate-fade-up sm:text-5xl md:text-6xl">
                Documents in.
                <br />
                <span className="text-ink-muted">Agent-ready structure out.</span>
              </h1>

              <p className="mx-auto mt-6 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-muted animate-fade-up sm:text-base">
                Shade reads a complex document and returns clean Markdown, typed JSON, and the
                detected regions behind both — with a page and a bounding box on every one, so the
                output can be checked against the source rather than trusted.
              </p>

              <div className="mt-9 flex flex-col items-center justify-center gap-3 animate-fade-up sm:flex-row">
                <Link href="/parse" className="w-full sm:w-auto">
                  <Button variant="primary" size="lg" block icon={<ArrowIcon />}>
                    Parse a document
                  </Button>
                </Link>
                <Link href="/login" className="w-full sm:w-auto">
                  <Button variant="secondary" size="lg" block>
                    Sign in
                  </Button>
                </Link>
              </div>

              <p className="mt-4 text-xs text-ink-faint">
                No account needed for your first document. PDF up to 50 MB.
              </p>
            </div>

            <div className="mt-14 animate-fade-up sm:mt-20">
              <HeroPreview />
            </div>
          </section>

          {/* ── Operations ───────────────────────────────────────────────── */}
          <Section
            id="operations"
            eyebrow="Three operations"
            title="One document, three questions"
            description="The same uploaded file is read once and can be asked for structure, for values, or for evidence. None of them re-uploads anything."
          >
            <div className="grid gap-4 md:grid-cols-3">
              {OPERATIONS.map((operation) => (
                <div
                  key={operation}
                  className="group flex flex-col rounded-[var(--radius-card)] border border-line bg-surface p-5 transition-colors duration-200 hover:border-accent-line hover:bg-raised"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 items-center justify-center rounded-lg border border-accent-line bg-accent-soft font-mono text-[0.6875rem] font-semibold text-accent-bright">
                      {operation.slice(0, 2)}
                    </span>
                    <h3 className="text-sm font-semibold text-ink">
                      {OPERATION_LABELS[operation]}
                    </h3>
                  </div>

                  <p className="mt-3 text-[0.8125rem] leading-relaxed text-ink-muted">
                    {OPERATION_BLURBS[operation]}
                  </p>

                  <div className="rule-fade my-4" />

                  <ul className="space-y-2">
                    {OPERATION_DETAIL[operation].points.map((point) => (
                      <li key={point} className="flex gap-2.5 text-[0.8125rem] leading-relaxed text-ink-muted">
                        <CheckIcon />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>

          {/* ── Pipeline ─────────────────────────────────────────────────── */}
          <Section
            id="pipeline"
            tone="raised"
            eyebrow="The pipeline"
            title="It tells you what it is doing"
            description="A parse is not one opaque call. Each stage is reported as it completes, so a long document shows progress you can actually read — and a failure lands on the stage that caused it."
          >
            <ol className="flex flex-wrap gap-2">
              {PIPELINE.map((stage, index) => (
                <li
                  key={stage}
                  className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2"
                >
                  <span className="font-mono text-[0.625rem] tabular-nums text-ink-faint">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[0.8125rem] text-ink-muted">
                    {JOB_STAGE_LABELS[stage]}
                  </span>
                </li>
              ))}
            </ol>

            <p className="mt-6 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-faint">
              Stages that do not apply are skipped rather than shown as stalled — a Split job never
              extracts tables, and it does not pretend to.
            </p>
          </Section>

          {/* ── Output ───────────────────────────────────────────────────── */}
          <Section
            id="output"
            eyebrow="The output"
            title="Markdown first. JSON when you need it."
            description="Markdown is the primary representation because it is what a model reads best and what a person can still edit. JSON is the secondary view of the same structure, for when something downstream needs types rather than prose."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <OutputPanel
                title="Markdown"
                caption="Rendered, not raw — headings, lists and tables reconstructed from the detected regions."
                tone="paper"
              >
                <div className="prose-document">
                  <h1>Q3 Annual Report</h1>
                  <p>
                    Shade is a platform for <strong>agent-ready documents</strong>. It reads a
                    source PDF and returns a representation an agent can act on without guessing at
                    the layout.
                  </p>
                  <h2>Financial summary</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Quarter</th>
                        <th style={{ textAlign: 'right' }}>Revenue</th>
                        <th style={{ textAlign: 'right' }}>Growth</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Q1</td>
                        <td style={{ textAlign: 'right' }}>12.4 M</td>
                        <td style={{ textAlign: 'right' }}>8.1%</td>
                      </tr>
                      <tr>
                        <td>Q2</td>
                        <td style={{ textAlign: 'right' }}>14.9 M</td>
                        <td style={{ textAlign: 'right' }}>20.2%</td>
                      </tr>
                      <tr>
                        <td>Total</td>
                        <td style={{ textAlign: 'right' }}>27.3 M</td>
                        <td style={{ textAlign: 'right' }}>14.1%</td>
                      </tr>
                    </tbody>
                  </table>
                  <p>
                    <em>Figure 1 — Revenue by quarter.</em>
                  </p>
                </div>
              </OutputPanel>

              <OutputPanel
                title="JSON"
                caption="The same document as a typed tree: sections, tables, assets, and every region with its geometry."
                tone="code"
              >
                <pre className="overflow-x-auto font-mono text-[0.6875rem] leading-[1.7]">
                  <code>{`{
  "document": {
    "filename": "q3-annual-report.pdf",
    "pageCount": 14,
    "pageCountSource": "detected"
  },
  "sections": [
    {
      "id": "sec_01",
      "level": 2,
      "heading": "Financial summary",
      "page_number": 1,
      "table_refs": ["tbl_01"]
    }
  ],
  "tables": [
    {
      "id": "tbl_01",
      "headers": ["Quarter", "Revenue", "Growth"],
      "rows": [
        ["Q1", "12.4 M", "8.1%"],
        ["Q2", "14.9 M", "20.2%"],
        ["Total", "27.3 M", "14.1%"]
      ],
      "align": ["left", "right", "right"]
    }
  ],
  "chunks": [
    {
      "chunk_id": "chk_004",
      "type": "table",
      "page_number": 1,
      "bounding_box": {
        "x": 72.0, "y": 268.5,
        "width": 451.0, "height": 96.0
      },
      "confidence": 0.98
    }
  ]
}`}</code>
                </pre>
              </OutputPanel>
            </div>
          </Section>

          {/* ── Boundaries ───────────────────────────────────────────────── */}
          <Section
            tone="raised"
            eyebrow="Under the hood"
            title="Four planes, four jobs"
            description="The API never parses a document and the processor never talks to a browser. Keeping those separate is what makes the processing engine replaceable without touching the rest of the product."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  name: 'Web',
                  detail: 'Next.js. Renders, uploads, polls. Never parses.',
                },
                {
                  name: 'API',
                  detail: 'Fastify. Auth, ownership, quotas, job state. Never reads a PDF.',
                },
                {
                  name: 'Worker',
                  detail: 'Python. Consumes jobs, writes artifacts. Never serves a request.',
                },
                {
                  name: 'Storage',
                  detail: 'PDFs and artifacts by key. Bytes never enter PostgreSQL.',
                },
              ].map((plane, index) => (
                <div key={plane.name} className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
                  <span className="font-mono text-[0.625rem] uppercase tracking-[0.1em] text-accent-bright">
                    Plane {index + 1}
                  </span>
                  <p className="mt-2 text-sm font-semibold text-ink">{plane.name}</p>
                  <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-muted">
                    {plane.detail}
                  </p>
                </div>
              ))}
            </div>
          </Section>

          {/* ── CTA ──────────────────────────────────────────────────────── */}
          <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <div className="relative overflow-hidden rounded-[var(--radius-panel)] border border-accent-line bg-surface px-6 py-14 text-center sm:px-12">
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    'radial-gradient(40rem 20rem at 50% 0%, #6e56cf33, transparent 70%)',
                }}
                aria-hidden="true"
              />
              <div className="relative">
                <h2 className="text-balance text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
                  Point it at a document
                </h2>
                <p className="mx-auto mt-3 max-w-md text-pretty text-[0.9375rem] leading-relaxed text-ink-muted">
                  The workspace opens with a file picker. Drop in a PDF and watch the regions come
                  back.
                </p>
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Link href="/parse" className="w-full sm:w-auto">
                    <Button variant="primary" size="lg" block icon={<ArrowIcon />}>
                      Open the workspace
                    </Button>
                  </Link>
                  <Link href="/signup" className="w-full sm:w-auto">
                    <Button variant="ghost" size="lg" block>
                      Create an account
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </section>
        </main>

        <SiteFooter />
      </div>
    </div>
  );
}

/* ── Layout pieces ───────────────────────────────────────────────────────── */

function Section({
  id,
  eyebrow,
  title,
  description,
  children,
  tone = 'canvas',
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  tone?: 'canvas' | 'raised';
}) {
  return (
    <section
      id={id}
      // `scroll-mt` clears the sticky header when an anchor link jumps here —
      // otherwise every in-page link lands with its heading hidden behind the
      // 64px header.
      className={cnSection(tone)}
    >
      <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-accent-bright">
          {eyebrow}
        </p>
        <h2 className="mt-3 max-w-2xl text-balance text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
          {title}
        </h2>
        <p className="mt-4 max-w-2xl text-pretty text-[0.9375rem] leading-relaxed text-ink-muted">
          {description}
        </p>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

function cnSection(tone: 'canvas' | 'raised'): string {
  return tone === 'raised'
    ? 'scroll-mt-16 border-y border-line bg-surface/40'
    : 'scroll-mt-16';
}

function OutputPanel({
  title,
  caption,
  tone,
  children,
}: {
  title: string;
  caption: string;
  tone: 'paper' | 'code';
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-3">
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-ink-muted">
          {title}
        </span>
      </div>

      <div
        className={
          tone === 'paper'
            ? 'flex-1 bg-paper px-6 py-6 sm:px-8'
            : 'flex-1 overflow-x-auto bg-canvas px-5 py-5 text-ink-muted'
        }
      >
        {children}
      </div>

      <p className="border-t border-line bg-surface px-4 py-3 text-[0.75rem] leading-relaxed text-ink-faint">
        {caption}
      </p>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      className="mt-[0.2rem] size-3.5 shrink-0 text-accent-bright"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m3.5 8.5 3 3 6-7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 8h9m0 0L8.5 4.5M12 8l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
