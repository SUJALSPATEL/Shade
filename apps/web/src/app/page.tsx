import Link from 'next/link';
import { Backronym } from '@/components/brand/logo';
import { Faq } from '@/components/marketing/faq';
import { HeroPreview } from '@/components/marketing/hero-preview';
import { OperationsShowcase } from '@/components/marketing/operations-showcase';
import { PipelineRail } from '@/components/marketing/pipeline-rail';
import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';
import { TrustMarquee } from '@/components/marketing/trust-marquee';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * The landing page.
 *
 * Static, and it stays that way. Nothing here reads a cookie or a database, so
 * it renders once at build time and is served as HTML — which is the right
 * property for the page a stranger lands on.
 *
 * The argument the page makes, in order: *what it is* (the hero), *what it can
 * do* (the three operations), *how* (the pipeline), *what you actually get*
 * (the output), *why you can trust it* (proof), and *what it is made of*
 * (architecture). Everything a visitor needs in order to decide is above the
 * fold or one scroll below it; there is no seventh section explaining the
 * sixth.
 */

export default function LandingPage() {
  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <SiteHeader />

      <main>
        <Hero />
        <TrustMarquee className="mx-auto w-full max-w-6xl px-5 pb-20 pt-16 sm:px-8 sm:pb-24" />

        <Section
          id="operations"
          eyebrow="Three operations"
          title="One document, three questions"
          description="The same uploaded file is read once and can be asked for structure, for values, or for evidence. None of them re-uploads anything."
        >
          <OperationsShowcase />
        </Section>

        <Section
          id="pipeline"
          tone="raised"
          eyebrow="The pipeline"
          title="It tells you what it is doing"
          description="A parse is not one opaque call. Each stage is reported as it completes, so a long document shows progress you can actually read — and a failure lands on the stage that caused it."
        >
          <PipelineRail />
        </Section>

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
                  Shade is a platform for <strong>agent-ready documents</strong>. It reads a source
                  PDF and returns a representation an agent can act on without guessing at the
                  layout.
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
                      <td>Q3</td>
                      <td style={{ textAlign: 'right' }}>18.2 M</td>
                      <td style={{ textAlign: 'right' }}>22.1%</td>
                    </tr>
                  </tbody>
                </table>
                <p>
                  <em>Figure 1 — Revenue by quarter.</em>
                </p>
                <h3>Outlook</h3>
                <ul>
                  <li>Growth is expected to continue through the fourth quarter.</li>
                  <li>Two additional regions open in the next fiscal year.</li>
                  <li>Headcount remains flat against the revised plan.</li>
                </ul>
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
        ["Q3", "18.2 M", "22.1%"]
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

        <Section
          tone="raised"
          eyebrow="Why it can be trusted"
          title="Results come with proof"
          description="An extraction you cannot check is a guess with better formatting. Three properties make the difference between output you read and output you rely on."
        >
          <div className="grid gap-4 md:grid-cols-3">
            {PRINCIPLES.map((principle) => (
              <div key={principle.title} className="panel panel-hover p-6">
                <span className="flex size-9 items-center justify-center rounded-lg border border-accent-line bg-accent-soft">
                  <PrincipleIcon name={principle.icon} />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-ink">{principle.title}</h3>
                <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">
                  {principle.body}
                </p>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="architecture"
          eyebrow="Under the hood"
          title="Four planes, four jobs"
          description="The API never parses a document and the processor never talks to a browser. Keeping those separate is what makes the processing engine replaceable without touching the rest of the product."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLANES.map((plane, index) => (
              <div key={plane.name} className="panel panel-hover p-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-accent-bright">
                    Plane {index + 1}
                  </span>
                  <span className="font-mono text-[0.625rem] text-ink-faint">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold text-ink">{plane.name}</p>
                <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-muted">
                  {plane.detail}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-6 max-w-3xl text-[0.8125rem] leading-relaxed text-ink-faint">
            Bytes never enter PostgreSQL. The database holds identity, ownership, job state and the
            processed output; the documents themselves live in the plane built for them and are
            discarded once they have been read.
          </p>
        </Section>

        <Section
          id="faq"
          tone="raised"
          eyebrow="Questions"
          title="The things worth asking"
          description="Short answers to the questions that decide whether this fits what you are building."
        >
          <Faq />
        </Section>

        <ClosingCta />
      </main>

      <SiteFooter />
    </div>
  );
}

/* ── Hero ────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden pb-16 pt-16 sm:pb-20 sm:pt-24">
      <div className="ambient ambient-drift" aria-hidden="true" />
      <div className="grid-lines" aria-hidden="true" />

      <div className="relative mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="mx-auto max-w-3xl text-center">
          {/* The badge carries the backronym where there is room for it and the
              three operation names where there is not. The backronym is six
              words in a monospace face, so on a phone it wraps to a second line
              with one orphaned word on it — which reads as a mistake rather
              than as a name. */}
          <div className="flex justify-center animate-fade-in">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1 backdrop-blur sm:px-3.5 sm:py-1.5">
              <span className="flex size-1.5 rounded-full bg-positive" aria-hidden="true" />
              <span className="font-mono text-[0.6875rem] text-ink-muted sm:hidden">
                Parse · Extract · Split
              </span>
              <Backronym className="hidden sm:flex" />
            </span>
          </div>

          <h1 className="mt-7 text-4xl font-semibold leading-[1.05] tracking-[-0.035em] animate-fade-up sm:text-5xl md:text-[3.5rem]">
            Documents in.
            <br />
            <span className="text-gradient">Agent-ready structure out.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-muted animate-fade-up sm:text-base">
            Shade reads a complex document and returns clean Markdown, typed JSON, and the detected
            regions behind both — with a page and a bounding box on every one, so the output can be
            checked against the source rather than trusted.
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
      </div>
    </section>
  );
}

/* ── Sections ────────────────────────────────────────────────────────────── */

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
      className={cn(
        'scroll-mt-20',
        tone === 'raised' && 'relative border-y border-line bg-surface/30',
      )}
    >
      {tone === 'raised' ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(50rem 22rem at 50% 0%, #6e56cf14, transparent 68%)',
          }}
          aria-hidden="true"
        />
      ) : null}

      <div className="relative mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <header className="max-w-2xl">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.028em] text-ink sm:text-[2rem] sm:leading-[1.15]">
            {title}
          </h2>
          <p className="mt-4 text-pretty text-[0.9375rem] leading-relaxed text-ink-muted">
            {description}
          </p>
        </header>

        <div className="reveal mt-10">{children}</div>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
      <div className="ring-gradient relative overflow-hidden rounded-[var(--radius-panel)] border border-accent-line bg-surface px-6 py-14 text-center sm:px-12 sm:py-16">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(38rem 20rem at 50% 0%, #6e56cf40, transparent 70%)',
          }}
          aria-hidden="true"
        />
        <div className="grid-lines opacity-40" aria-hidden="true" />

        <div className="relative">
          <h2 className="text-balance text-2xl font-semibold tracking-[-0.028em] text-ink sm:text-[2rem]">
            Point it at a document
          </h2>
          <p className="mx-auto mt-3 max-w-md text-pretty text-[0.9375rem] leading-relaxed text-ink-muted">
            The workspace opens with a file picker. Drop in a PDF and watch the regions come back.
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

          <p className="mt-4 text-xs text-ink-faint">
            One document before you sign up. Nothing to install.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── Content ─────────────────────────────────────────────────────────────── */

const PRINCIPLES: { icon: 'trace' | 'structure' | 'null'; title: string; body: string }[] = [
  {
    icon: 'trace',
    title: 'Every value is traceable',
    body: 'A field is not just a string. It points at the page and the rectangle it was read from, so you can put the answer next to the source and see for yourself.',
  },
  {
    icon: 'structure',
    title: 'Structure, not transcription',
    body: 'Headings keep their hierarchy, tables keep their headers and alignment, lists stay lists. What gets dropped is layout noise — gutters, rules, running heads.',
  },
  {
    icon: 'null',
    title: 'Nothing is invented',
    body: 'A field the document does not answer comes back null rather than as a plausible guess. That one property is what makes the output safe to hand to an agent.',
  },
];

const PLANES: { name: string; detail: string }[] = [
  { name: 'Web', detail: 'Next.js. Renders, uploads, polls. Never parses.' },
  { name: 'API', detail: 'Node. Auth, ownership, quotas, job state. Never reads a PDF.' },
  { name: 'Worker', detail: 'Python. Consumes jobs, writes artifacts. Never serves a request.' },
  { name: 'Storage', detail: 'PDFs and artifacts by key. Bytes never enter PostgreSQL.' },
];

/* ── Small components ────────────────────────────────────────────────────── */

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
    <div className="ring-gradient flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-3">
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-ink-muted">
          {title}
        </span>
      </div>

      <div
        className={
          tone === 'paper'
            ? 'flex-1 bg-paper px-6 py-6 sm:px-8'
            : 'flex-1 overflow-x-auto bg-[#0a0a10] px-5 py-5 text-ink-muted'
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

function PrincipleIcon({ name }: { name: 'trace' | 'structure' | 'null' }) {
  return (
    <svg
      className="size-4 text-accent-bright"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      {name === 'trace' ? (
        <>
          <rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
          <rect x="5" y="6" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.4" />
        </>
      ) : null}
      {name === 'structure' ? (
        <>
          <path d="M3 4h10M5.5 8h7.5M5.5 12h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : null}
      {name === 'null' ? (
        <>
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M4.2 11.8 11.8 4.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </>
      ) : null}
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
