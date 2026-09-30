'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * The hero's product shot.
 *
 * There is no screenshot here, and there cannot be one: the workspace only
 * exists behind an upload, and a marketing page has nothing to upload. So this
 * is a drawing — the parse workspace rebuilt out of DOM elements.
 *
 * Drawing it rather than shipping an image is the right trade for three
 * reasons. It stays crisp on any display without a 2x asset. It re-colours
 * itself from the design tokens, so it cannot drift out of date when a token
 * changes. And it stays legible to a screen reader and a crawler, which a PNG
 * of a user interface is not.
 *
 * The regions are laid out as *flow* blocks with an outline rather than as
 * absolutely-positioned boxes over a picture. That matters: an outline wrapping
 * the element it describes is always aligned with it, at every viewport width,
 * with no coordinates to keep in sync. The bounding boxes the engine actually
 * returns are the real thing — this is the honest cartoon of it.
 */

export function HeroPreview() {
  const [tab, setTab] = useState<'markdown' | 'json'>('markdown');

  return (
    <div className="relative">
      {/* The light the whole thing sits in. Two offset glows, blurred well past
          the frame so the panel reads as lit rather than as outlined. */}
      <div
        className="pointer-events-none absolute -inset-x-10 -top-10 bottom-0 -z-10 opacity-70 blur-3xl"
        style={{
          backgroundImage:
            'radial-gradient(38rem 18rem at 25% 12%, #6e56cf4d, transparent 62%), radial-gradient(34rem 16rem at 78% 30%, #4f9cf033, transparent 64%)',
        }}
        aria-hidden="true"
      />

      <div className="panel ring-gradient overflow-hidden">
        <WindowChrome />

        <div className="grid lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
          <DocumentPane />
          <OutputPane tab={tab} onTabChange={setTab} />
        </div>
      </div>

      {/* The one floating element. It restates the product's central claim —
          every region comes back with a type, a page and a confidence — and it
          is placed over the seam between the two panes, which is where the eye
          already is. */}
      <div className="pointer-events-none absolute -bottom-5 left-1/2 hidden -translate-x-1/2 sm:block">
        <div className="panel flex items-center gap-3 rounded-full px-4 py-2 animate-float">
          <span className="flex size-1.5 rounded-full bg-positive" aria-hidden="true" />
          <span className="font-mono text-[0.6875rem] text-ink-muted">
            <span className="text-ink">chk_004</span>
            <span className="mx-1.5 text-ink-faint">·</span>
            table
            <span className="mx-1.5 text-ink-faint">·</span>
            page 1
            <span className="mx-1.5 text-ink-faint">·</span>
            <span className="text-positive">0.98</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Chrome ──────────────────────────────────────────────────────────────── */

function WindowChrome() {
  return (
    <div className="flex items-center gap-3 border-b border-line bg-surface/80 px-4 py-3">
      <div className="flex gap-1.5" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-[#ff5f57]/70" />
        <span className="size-2.5 rounded-full bg-[#febc2e]/70" />
        <span className="size-2.5 rounded-full bg-[#28c840]/70" />
      </div>

      <div className="mx-auto flex min-w-0 items-center gap-2 rounded-md border border-line bg-canvas px-3 py-1">
        <FileIcon />
        <span className="truncate font-mono text-[0.6875rem] text-ink-muted">
          q3-annual-report.pdf
        </span>
      </div>

      <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-positive/30 bg-positive-soft px-2 py-0.5 font-mono text-[0.625rem] text-positive sm:flex">
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        READY
      </span>
    </div>
  );
}

/* ── Left: the document, with its detected regions ───────────────────────── */

function DocumentPane() {
  return (
    <div className="relative border-line bg-[#0a0a10] p-5 sm:p-6 lg:border-r">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.14em] text-ink-faint">
          Source · page 1 of 14
        </span>
        <span className="font-mono text-[0.625rem] text-ink-faint">5 regions</span>
      </div>

      {/* The paper. The one light surface in the product, and the only place on
          this page where the palette inverts — which is the point. */}
      <div className="relative rounded-lg bg-paper p-5 shadow-[0_20px_50px_-24px_#000000f2] sm:p-6">
        <div className="space-y-4">
          {/* heading */}
          <Region label="heading" tone="heading">
            <p className="font-semibold leading-tight tracking-[-0.02em] text-paper-ink text-[0.9375rem] sm:text-base">
              Q3 Annual Report
            </p>
          </Region>

          {/* paragraph */}
          <Region label="paragraph" tone="paragraph">
            <div className="space-y-1.5" aria-hidden="true">
              <Bar w="100%" />
              <Bar w="94%" />
              <Bar w="62%" />
            </div>
          </Region>

          {/* figure */}
          <Region label="figure" tone="figure">
            <div className="flex h-16 items-end gap-2 sm:h-20" aria-hidden="true">
              {[38, 56, 44, 78, 62, 92].map((height, index) => (
                <div
                  key={index}
                  className="flex-1 rounded-t-[3px]"
                  style={{
                    height: `${height}%`,
                    background: `linear-gradient(180deg, #8b78e8, #6e56cf)`,
                    opacity: 0.35 + (index / 5) * 0.65,
                  }}
                />
              ))}
            </div>
          </Region>

          {/* table */}
          <Region label="table" tone="table">
            <table className="w-full border-collapse font-mono text-[0.625rem] tabular-nums text-paper-ink">
              <thead>
                <tr className="border-b border-[#16161d]/25">
                  <th className="py-1 pr-2 text-left font-semibold">Quarter</th>
                  <th className="py-1 pr-2 text-right font-semibold">Revenue</th>
                  <th className="py-1 text-right font-semibold">Growth</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Q1', '12.4M', '8.1%'],
                  ['Q2', '14.9M', '20.2%'],
                  ['Q3', '18.2M', '22.1%'],
                ].map((row) => (
                  <tr key={row[0]} className="border-b border-[#16161d]/10 last:border-0">
                    <td className="py-1 pr-2">{row[0]}</td>
                    <td className="py-1 pr-2 text-right">{row[1]}</td>
                    <td className="py-1 text-right text-[#1f7a52]">{row[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Region>

          {/* paragraph, undetected-looking on purpose: the tail of a page is
              where a layout model is most likely to be unsure, and showing one
              region at lower confidence is more honest than five at 0.99. */}
          <Region label="caption" tone="caption">
            <div className="space-y-1.5" aria-hidden="true">
              <Bar w="88%" />
              <Bar w="46%" />
            </div>
          </Region>
        </div>
      </div>
    </div>
  );
}

/** A flow block carrying the overlay the engine would draw around it. */
function Region({
  label,
  tone,
  children,
}: {
  label: string;
  tone: 'heading' | 'paragraph' | 'figure' | 'table' | 'caption';
  children: React.ReactNode;
}) {
  const colour = `var(--color-chunk-${tone})`;

  return (
    <div
      className="relative rounded-[4px] px-2 pb-2 pt-3"
      style={{
        outline: `1px dashed color-mix(in srgb, ${colour} 55%, transparent)`,
        outlineOffset: '2px',
        background: `color-mix(in srgb, ${colour} 5%, transparent)`,
      }}
    >
      <span
        className="absolute -top-[0.6rem] left-1.5 rounded-[3px] px-1 py-px font-mono text-[0.5625rem] uppercase leading-tight tracking-[0.06em]"
        style={{
          color: colour,
          background: '#0a0a10',
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function Bar({ w }: { w: string }) {
  return <div className="h-1.5 rounded-full bg-[#dcdce4]" style={{ width: w }} />;
}

/* ── Right: the output ───────────────────────────────────────────────────── */

function OutputPane({
  tab,
  onTabChange,
}: {
  tab: 'markdown' | 'json';
  onTabChange: (tab: 'markdown' | 'json') => void;
}) {
  return (
    <div className="flex min-w-0 flex-col bg-[#0b0b12]">
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        {(['markdown', 'json'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onTabChange(value)}
            aria-pressed={tab === value}
            className={cn(
              'rounded-md px-2.5 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.08em] transition-colors',
              tab === value
                ? 'bg-raised text-ink'
                : 'text-ink-faint hover:bg-raised/60 hover:text-ink-muted',
            )}
          >
            {value}
          </button>
        ))}

        <span className="ml-auto hidden font-mono text-[0.625rem] text-ink-faint sm:block">
          {tab === 'markdown' ? '1,284 chars' : '3.1 KB'}
        </span>
      </div>

      <div className="min-h-[19rem] flex-1 overflow-hidden p-4 sm:min-h-[22rem] sm:p-5">
        {tab === 'markdown' ? <MarkdownSample /> : <JsonSample />}
      </div>
    </div>
  );
}

function MarkdownSample() {
  return (
    <pre className="overflow-x-auto font-mono text-[0.6875rem] leading-[1.85] text-ink-muted">
      <code>
        <Line n={1}>
          <Tok tone="h"># Q3 Annual Report</Tok>
        </Line>
        <Line n={2}> </Line>
        <Line n={3}>
          Shade turns a source PDF into a representation an agent can act on
          <br />
          without guessing at the layout.
        </Line>
        <Line n={4}> </Line>
        <Line n={5}>
          <Tok tone="h">## Financial summary</Tok>
        </Line>
        <Line n={6}> </Line>
        <Line n={7}>
          <Tok tone="dim">| Quarter | Revenue | Growth |</Tok>
        </Line>
        <Line n={8}>
          <Tok tone="dim">| ------- | ------: | -----: |</Tok>
        </Line>
        <Line n={9}>
          <Tok tone="dim">| Q1      |   12.4M |   8.1% |</Tok>
        </Line>
        <Line n={10}>
          <Tok tone="dim">| Q2      |   14.9M |  20.2% |</Tok>
        </Line>
        <Line n={11}>
          <Tok tone="dim">| Q3      |   18.2M |  22.1% |</Tok>
        </Line>
        <Line n={12}> </Line>
        <Line n={13}>
          <Tok tone="link">![Figure 1](/assets/fig-01.png)</Tok>
        </Line>
        <Line n={14}> </Line>
        <Line n={15}>
          <Tok tone="marker">{'<!-- page: 2 -->'}</Tok>
        </Line>
      </code>
    </pre>
  );
}

function JsonSample() {
  return (
    <pre className="overflow-x-auto font-mono text-[0.6875rem] leading-[1.85] text-ink-muted">
      <code>
        <Line n={1}>{'{'}</Line>
        <Line n={2}>
          {'  '}
          <Tok tone="key">&quot;document&quot;</Tok>: {'{'}
        </Line>
        <Line n={3}>
          {'    '}
          <Tok tone="key">&quot;filename&quot;</Tok>: <Tok tone="str">&quot;q3-annual-report.pdf&quot;</Tok>,
        </Line>
        <Line n={4}>
          {'    '}
          <Tok tone="key">&quot;pageCount&quot;</Tok>: <Tok tone="num">14</Tok>
        </Line>
        <Line n={5}>{'  },'}</Line>
        <Line n={6}>
          {'  '}
          <Tok tone="key">&quot;chunks&quot;</Tok>: [
        </Line>
        <Line n={7}>{'    {'}</Line>
        <Line n={8}>
          {'      '}
          <Tok tone="key">&quot;chunk_id&quot;</Tok>: <Tok tone="str">&quot;chk_004&quot;</Tok>,
        </Line>
        <Line n={9}>
          {'      '}
          <Tok tone="key">&quot;type&quot;</Tok>: <Tok tone="str">&quot;table&quot;</Tok>,
        </Line>
        <Line n={10}>
          {'      '}
          <Tok tone="key">&quot;page_number&quot;</Tok>: <Tok tone="num">1</Tok>,
        </Line>
        <Line n={11}>
          {'      '}
          <Tok tone="key">&quot;bounding_box&quot;</Tok>: {'{'}
        </Line>
        <Line n={12}>
          {'        '}
          <Tok tone="key">&quot;x&quot;</Tok>: <Tok tone="num">72.0</Tok>, <Tok tone="key">&quot;y&quot;</Tok>:{' '}
          <Tok tone="num">268.5</Tok>,
        </Line>
        <Line n={13}>
          {'        '}
          <Tok tone="key">&quot;width&quot;</Tok>: <Tok tone="num">451.0</Tok>, <Tok tone="key">&quot;height&quot;</Tok>:{' '}
          <Tok tone="num">96.0</Tok>
        </Line>
        <Line n={14}>{'      },'}</Line>
        <Line n={15}>
          {'      '}
          <Tok tone="key">&quot;confidence&quot;</Tok>: <Tok tone="num">0.98</Tok>
        </Line>
        <Line n={16}>{'    }'}</Line>
        <Line n={17}>{'  ]'}</Line>
        <Line n={18}>{'}'}</Line>
      </code>
    </pre>
  );
}

/** A gutter line number plus its content, so the sample reads as a file. */
function Line({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-4 shrink-0 select-none text-right text-ink-faint/50 tabular-nums">
        {n}
      </span>
      <span className="min-w-0 whitespace-pre-wrap">{children}</span>
    </div>
  );
}

const TOKENS = {
  h: 'text-accent-bright font-semibold',
  key: 'text-[#7fc4f5]',
  str: 'text-positive',
  num: 'text-warning',
  link: 'text-[#7fc4f5]',
  dim: 'text-ink-muted',
  marker: 'text-ink-faint italic',
} as const;

function Tok({ tone, children }: { tone: keyof typeof TOKENS; children: React.ReactNode }) {
  return <span className={TOKENS[tone]}>{children}</span>;
}

function FileIcon() {
  return (
    <svg className="size-3 shrink-0 text-danger" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9 1.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 14.5h6a1.5 1.5 0 0 0 1.5-1.5V5L9 1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9 1.5V5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
