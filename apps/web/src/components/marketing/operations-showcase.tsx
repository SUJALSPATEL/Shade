'use client';

import { useState } from 'react';
import Link from 'next/link';
import { OPERATION_BLURBS, OPERATION_LABELS, OPERATIONS, type Operation } from '@shade/shared';
import { cn } from '@/lib/cn';

/**
 * The three operations, as one interactive panel rather than three cards.
 *
 * Three static cards would say the same thing three times and make the visitor
 * read all of it. One panel makes the *difference* between them the point: the
 * document never changes, only the question being asked of it, which is exactly
 * the product's claim. Switching tabs is the argument.
 *
 * Each tab's detail is a small drawing of the real output shape for that
 * operation, so the section is evidence rather than adjectives.
 */

const DETAIL: Record<Operation, { points: string[]; href: string; cta: string }> = {
  PARSE: {
    points: [
      'Headings, lists, tables and captions rebuilt as Markdown',
      'A typed JSON tree of sections, tables and assets',
      'Every region with its page, bounding box and confidence',
    ],
    href: '/parse',
    cta: 'Open Parse',
  },
  EXTRACT: {
    points: [
      'You declare the schema; every field comes back typed',
      'Values carry a confidence and the chunks that support them',
      'A field that is not in the document returns null — never a guess',
    ],
    href: '/parse',
    cta: 'Open Extract',
  },
  SPLIT: {
    points: [
      'Ask a question in a sentence; get the passages that answer it',
      'Every match explains why it matched and where it came from',
      'The same retrieval that will back agent tool calls',
    ],
    href: '/parse',
    cta: 'Open Split',
  },
};

export function OperationsShowcase() {
  const [active, setActive] = useState<Operation>('PARSE');
  const detail = DETAIL[active];

  return (
    <div className="panel overflow-hidden">
      <div className="grid lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/* ── The three operations ─────────────────────────────────────────── */}
        <div
          className="flex flex-col border-line p-2 lg:border-r"
          role="tablist"
          aria-label="Operations"
        >
          {OPERATIONS.map((operation) => {
            const selected = operation === active;

            return (
              <button
                key={operation}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`operation-panel-${operation}`}
                id={`operation-tab-${operation}`}
                onClick={() => setActive(operation)}
                className={cn(
                  'group relative rounded-[var(--radius-card)] px-4 py-4 text-left transition-colors duration-200',
                  selected ? 'bg-raised' : 'hover:bg-raised/50',
                )}
              >
                {/* The selected marker. A left rule rather than a filled block,
                    so the active row reads as chosen without shouting across
                    the whole panel. */}
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-8 w-0.5 -translate-y-1/2 rounded-full transition-all duration-200',
                    selected ? 'bg-accent-bright opacity-100' : 'opacity-0',
                  )}
                  aria-hidden="true"
                />

                <div className="flex items-center gap-2.5">
                  <OperationIcon operation={operation} active={selected} />
                  <span
                    className={cn(
                      'text-sm font-semibold transition-colors',
                      selected ? 'text-ink' : 'text-ink-muted group-hover:text-ink',
                    )}
                  >
                    {OPERATION_LABELS[operation]}
                  </span>
                </div>

                <p
                  className={cn(
                    'mt-1.5 pl-[1.875rem] text-[0.8125rem] leading-relaxed transition-colors',
                    selected ? 'text-ink-muted' : 'text-ink-faint',
                  )}
                >
                  {OPERATION_BLURBS[operation]}
                </p>
              </button>
            );
          })}

          <div className="mt-1 border-t border-line p-4">
            <Link
              href={detail.href}
              className="inline-flex items-center gap-1.5 text-[0.8125rem] font-medium text-accent-bright transition-colors hover:text-ink"
            >
              {detail.cta}
              <ArrowIcon />
            </Link>
          </div>
        </div>

        {/* ── What that operation returns ──────────────────────────────────── */}
        <div
          id={`operation-panel-${active}`}
          role="tabpanel"
          aria-labelledby={`operation-tab-${active}`}
          className="min-w-0 bg-raised p-5 sm:p-7"
        >
          <ul className="grid gap-2 sm:grid-cols-3">
            {detail.points.map((point) => (
              <li
                key={point}
                className="flex gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-[0.75rem] leading-relaxed text-ink-muted"
              >
                <CheckIcon />
                <span>{point}</span>
              </li>
            ))}
          </ul>

          {/* `key` remounts the visual on tab change, which restarts its entry
              animation. Without it the new panel appears with no transition at
              all and the switch reads as a glitch. */}
          <div key={active} className="mt-5 animate-fade-up">
            {active === 'PARSE' ? <ParseVisual /> : null}
            {active === 'EXTRACT' ? <ExtractVisual /> : null}
            {active === 'SPLIT' ? <SplitVisual /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Parse: the document becomes structure ───────────────────────────────── */

function ParseVisual() {
  const regions = [
    { type: 'heading', label: 'Q3 Annual Report', page: 1, box: '72, 88, 451×24' },
    { type: 'table', label: 'Financial summary', page: 1, box: '72, 268, 451×96' },
    { type: 'figure', label: 'Figure 1 — Revenue', page: 2, box: '96, 142, 402×188' },
    { type: 'paragraph', label: 'Outlook and risks', page: 3, box: '72, 96, 451×162' },
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <div className="panel overflow-hidden">
        <PanelLabel>Regions</PanelLabel>
        <ul className="divide-y divide-line">
          {regions.map((region) => (
            <li key={region.label} className="flex items-center gap-3 px-3 py-2.5">
              <span
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: `var(--color-chunk-${region.type})` }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8125rem] text-ink">{region.label}</span>
                <span className="block font-mono text-[0.625rem] text-ink-faint">
                  {region.box}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[0.625rem] text-ink-faint">
                p.{region.page}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel overflow-hidden">
        <PanelLabel>Markdown</PanelLabel>
        <pre className="overflow-x-auto px-4 py-3 font-mono text-[0.6875rem] leading-[1.9] text-ink-muted">
          <code>
            <span className="text-accent-bright font-semibold"># Q3 Annual Report</span>
            {'\n\n'}
            Shade turns a source PDF into a representation{'\n'}
            an agent can act on.{'\n\n'}
            <span className="text-accent-bright font-semibold">## Financial summary</span>
            {'\n\n'}
            <span className="text-ink-faint">| Quarter | Revenue | Growth |</span>
            {'\n'}
            <span className="text-ink-faint">| ------- | ------: | -----: |</span>
            {'\n'}
            <span className="text-ink-faint">| Q1      |   12.4M |   8.1% |</span>
            {'\n\n'}
            <span className="text-ink-faint italic">{'<!-- page: 2 -->'}</span>
          </code>
        </pre>
      </div>
    </div>
  );
}

/* ── Extract: a declared schema gets filled ──────────────────────────────── */

function ExtractVisual() {
  const fields = [
    { name: 'institution_name', value: 'Northgate University', confidence: 0.99 },
    { name: 'degree_program', value: 'BSc Computer Science', confidence: 0.97 },
    { name: 'location', value: 'Edinburgh, UK', confidence: 0.94 },
    { name: 'start_date', value: '2019-09-01', confidence: 0.91 },
    { name: 'end_date', value: null, confidence: 0 },
  ];

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ink-faint">
          education
        </span>
        <span className="font-mono text-[0.625rem] text-ink-faint">
          5 fields · 4 resolved
        </span>
      </div>

      <ul className="divide-y divide-line">
        {fields.map((field) => (
          <li key={field.name} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-40 shrink-0 truncate font-mono text-[0.6875rem] text-info">
              {field.name}
            </span>

            {field.value === null ? (
              // The null case is the one worth showing: a field the document
              // does not answer comes back empty rather than invented, and that
              // is the property a downstream agent depends on.
              <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] italic text-ink-faint">
                null — not present in document
              </span>
            ) : (
              <span className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-ink">
                {field.value}
              </span>
            )}

            <ConfidenceBar value={field.confidence} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  if (value === 0) {
    return <span className="w-16 shrink-0 text-right font-mono text-[0.625rem] text-ink-faint">—</span>;
  }

  const tone = value >= 0.95 ? 'bg-positive' : value >= 0.9 ? 'bg-warning' : 'bg-danger';

  return (
    <span className="flex w-16 shrink-0 items-center justify-end gap-2">
      <span className="h-1 w-6 overflow-hidden rounded-full bg-line-strong" aria-hidden="true">
        <span
          className={cn('block h-full rounded-full', tone)}
          style={{ width: `${value * 100}%` }}
        />
      </span>
      <span className="font-mono text-[0.625rem] tabular-nums text-ink-muted">
        {value.toFixed(2)}
      </span>
    </span>
  );
}

/* ── Split: a question becomes ranked passages ───────────────────────────── */

function SplitVisual() {
  const matches = [
    {
      page: 7,
      score: 0.94,
      text: 'Either party may terminate this agreement on ninety (90) days written notice to the other party.',
    },
    {
      page: 7,
      score: 0.88,
      text: 'Termination for cause is effective immediately upon written notice describing the material breach.',
    },
    {
      page: 12,
      score: 0.71,
      text: 'Upon termination, all licences granted under this agreement shall immediately cease.',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="panel flex items-center gap-3 px-4 py-3">
        <SearchIcon />
        <span className="text-[0.8125rem] text-ink">Find clauses related to termination.</span>
        <span className="ml-auto shrink-0 font-mono text-[0.625rem] text-ink-faint">
          3 of 214 chunks
        </span>
      </div>

      <ul className="space-y-2">
        {matches.map((match, index) => (
          <li key={index} className="panel px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-[0.625rem] text-ink-faint">
                chk_{String(index + 1).padStart(3, '0')}
              </span>
              <span className="font-mono text-[0.625rem] text-ink-faint">p.{match.page}</span>
              <span className="ml-auto flex items-center gap-2">
                <span className="h-1 w-16 overflow-hidden rounded-full bg-line-strong" aria-hidden="true">
                  <span
                    className="block h-full rounded-full bg-accent-bright"
                    style={{ width: `${match.score * 100}%` }}
                  />
                </span>
                <span className="font-mono text-[0.625rem] tabular-nums text-accent-bright">
                  {match.score.toFixed(2)}
                </span>
              </span>
            </div>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">{match.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Shared bits ─────────────────────────────────────────────────────────── */

function PanelLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-line px-4 py-2.5">
      <span className="font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ink-faint">
        {children}
      </span>
    </div>
  );
}

function OperationIcon({ operation, active }: { operation: Operation; active: boolean }) {
  const tone = active ? 'text-accent-bright' : 'text-ink-faint';

  return (
    <span
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors',
        active ? 'border-accent-line bg-accent-soft' : 'border-line bg-surface',
      )}
    >
      <svg
        className={cn('size-3.5 transition-colors', tone)}
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        {operation === 'PARSE' ? (
          <>
            <path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </>
        ) : null}
        {operation === 'EXTRACT' ? (
          <>
            <rect x="2.5" y="3" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M6 6.5h4M6 9.5h2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </>
        ) : null}
        {operation === 'SPLIT' ? (
          <>
            <path d="M2.5 4.5h11M2.5 8h7M2.5 11.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </>
        ) : null}
      </svg>
    </span>
  );
}

function CheckIcon() {
  return (
    <svg
      className="mt-[0.15rem] size-3.5 shrink-0 text-accent-bright"
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

function SearchIcon() {
  return (
    <svg className="size-4 shrink-0 text-ink-faint" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg className="size-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
