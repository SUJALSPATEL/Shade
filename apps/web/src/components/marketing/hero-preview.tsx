import { cn } from '@/lib/cn';

/**
 * The landing page's hero visual.
 *
 * A static, hand-built picture of the workspace — not the workspace itself. The
 * real one is behind a click, and embedding it here would mean the marketing
 * page pays for the PDF viewer, the polling loop and the whole result tree.
 *
 * It is worth building carefully rather than screenshotting, because it has to
 * make one specific claim in about two seconds: *the boxes on the left and the
 * text on the right are the same thing.* So the overlay colours and the
 * highlighted tokens on the right come from the same `--color-chunk-*` tokens
 * the real preview uses, and the table row that is tinted on the page is the
 * table row that is bolded in the Markdown. A generic "AI reading a document"
 * illustration would communicate none of that.
 */

export function HeroPreview({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface',
        'shadow-[0_40px_120px_-40px_rgba(110,86,207,0.5),0_8px_32px_-16px_rgba(0,0,0,0.8)]',
        className,
      )}
      // Decorative: the same information is in the copy beneath it, and a screen
      // reader reading out forty lines of fake Markdown helps nobody.
      aria-hidden="true"
    >
      {/* Window chrome */}
      <div className="flex items-center gap-3 border-b border-line bg-raised px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ef5f68]/70" />
          <span className="size-2.5 rounded-full bg-warning/70" />
          <span className="size-2.5 rounded-full bg-positive/70" />
        </div>
        <div className="mx-auto flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1">
          <PageIcon />
          <span className="font-mono text-[0.6875rem] text-ink-muted">q3-annual-report.pdf</span>
          <span className="font-mono text-[0.6875rem] text-ink-faint">14 pages</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)]">
        {/* ── The page ───────────────────────────────────────────────────── */}
        <div className="relative border-line bg-[#f4f4f7] p-5 sm:border-r">
          <div className="relative mx-auto aspect-[1/1.28] w-full max-w-[19rem] rounded-md bg-paper p-5 shadow-[0_2px_16px_-4px_rgba(0,0,0,0.25)]">
            {/* Header band */}
            <Box
              colour="var(--color-chunk-furniture)"
              className="left-5 right-5 top-4 h-2"
              label="header"
              showLabel={false}
            />

            {/* Heading */}
            <Overlay colour="var(--color-chunk-heading)" className="left-5 top-[3.25rem] h-4 w-3/5" />
            <div className="mt-[3.25rem] h-4 w-3/5 rounded-sm bg-[#16161d]" />

            {/* Intro paragraph */}
            <Overlay colour="var(--color-chunk-paragraph)" className="left-5 top-[5.5rem] h-7 w-full" />
            <Lines className="mt-[5.5rem]" count={3} widths={['100%', '94%', '62%']} />

            {/* The table — the region the Markdown on the right is rendering */}
            <Overlay colour="var(--color-chunk-table)" className="left-5 right-5 top-[9.5rem] h-[4.75rem]" />
            <div className="mt-[9.5rem] overflow-hidden rounded-sm border border-[#e2e2ea]">
              <div className="grid grid-cols-3 gap-2 border-b-2 border-[#16161d] px-2 py-1.5">
                <Bar width="80%" dark />
                <Bar width="60%" dark />
                <Bar width="70%" dark />
              </div>
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className={cn(
                    'grid grid-cols-3 gap-2 px-2 py-1.5',
                    row < 2 && 'border-b border-[#eeeef3]',
                    // Last row is the total — the same row the Markdown bolds.
                    row === 2 && 'bg-[#fafafc]',
                  )}
                >
                  <Bar width="70%" />
                  <Bar width="52%" />
                  <Bar width="64%" strong={row === 2} />
                </div>
              ))}
            </div>

            {/* The figure */}
            <Overlay colour="var(--color-chunk-figure)" className="left-5 right-5 top-[15.75rem] h-[3.5rem]" />
            <div className="mt-[15.75rem] flex h-[3.5rem] items-end gap-1.5 rounded-sm bg-[#fafafc] px-2.5 pb-2 pt-2">
              {[38, 62, 47, 84, 56, 71].map((height, index) => (
                <div
                  key={index}
                  className="flex-1 rounded-t-[2px] bg-accent"
                  style={{ height: `${height}%`, opacity: 0.35 + index * 0.11 }}
                />
              ))}
            </div>

            {/* Caption */}
            <Overlay colour="var(--color-chunk-caption)" className="left-5 right-5 top-[20rem] h-3" />
            <Lines className="mt-[20rem]" count={1} widths={['58%']} />
          </div>

          {/* Legend, floating over the page's lower-left corner */}
          <div className="absolute bottom-4 left-4 rounded-lg border border-line bg-surface/95 px-2.5 py-2 backdrop-blur-sm">
            <p className="font-mono text-[0.5625rem] uppercase tracking-[0.1em] text-ink-faint">
              Regions
            </p>
            <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
              {[
                ['heading', 'var(--color-chunk-heading)'],
                ['paragraph', 'var(--color-chunk-paragraph)'],
                ['table', 'var(--color-chunk-table)'],
                ['figure', 'var(--color-chunk-figure)'],
              ].map(([label, colour]) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-[2px]" style={{ background: colour }} />
                  <span className="font-mono text-[0.5625rem] text-ink-muted">{label}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── The output ─────────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col bg-canvas">
          <div className="flex items-center gap-1 border-b border-line px-3 py-2">
            <PaneTab active>Markdown</PaneTab>
            <PaneTab>JSON</PaneTab>
            <span className="ml-auto font-mono text-[0.5625rem] text-ink-faint">9.4 KB</span>
          </div>

          <div className="flex-1 overflow-hidden p-4 font-mono text-[0.6875rem] leading-[1.75]">
            <Code colour="var(--color-chunk-heading)">{'# Q3 Annual Report'}</Code>
            <Code colour="var(--color-chunk-furniture)">{'<!-- page: 1 -->'}</Code>
            <Code>{''}</Code>
            <Code>
              <span className="text-ink-muted">Shade is a platform for </span>
              <span className="text-ink">agent-ready documents</span>
              <span className="text-ink-muted">.</span>
            </Code>
            <Code>{''}</Code>
            <Code colour="var(--color-chunk-heading)">{'## Financial summary'}</Code>
            <Code>{''}</Code>
            <Code colour="var(--color-chunk-table)">{'| Quarter | Revenue | Growth |'}</Code>
            <Code colour="var(--color-chunk-table)">{'| :------ | ------: | -----: |'}</Code>
            <Code colour="var(--color-chunk-table)">{'| Q1      |  12.4 M |   8.1% |'}</Code>
            <Code colour="var(--color-chunk-table)">{'| Q2      |  14.9 M |  20.2% |'}</Code>
            <Code colour="var(--color-chunk-table)">
              <span className="font-semibold text-ink">{'| Total   |  27.3 M |  14.1% |'}</span>
            </Code>
            <Code>{''}</Code>
            <Code colour="var(--color-chunk-figure)">{'![Revenue by quarter](assets/fig-1.svg)'}</Code>
            <Code colour="var(--color-chunk-caption)">{'*Figure 1 — Revenue by quarter.*'}</Code>
            <Code>{''}</Code>
            <Code>
              <span className="text-ink-faint">{'<!-- 14 pages · 212 regions · 9 tables -->'}</span>
            </Code>

            <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
              <span className="rounded-md border border-line bg-raised px-2 py-1 text-[0.5625rem] text-ink-muted">
                Copy
              </span>
              <span className="rounded-md border border-line bg-raised px-2 py-1 text-[0.5625rem] text-ink-muted">
                Download .md
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function Overlay({
  colour,
  className,
}: {
  colour: string;
  className?: string;
}) {
  return (
    <span
      className={cn('absolute rounded-[3px] border', className)}
      style={{
        borderColor: `color-mix(in srgb, ${colour} 55%, transparent)`,
        background: `color-mix(in srgb, ${colour} 13%, transparent)`,
      }}
    />
  );
}

function Box({
  colour,
  className,
  label,
  showLabel = true,
}: {
  colour: string;
  className?: string;
  label: string;
  showLabel?: boolean;
}) {
  return (
    <span className={cn('absolute rounded-[3px]', className)} style={{ background: colour }}>
      {showLabel ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

function Lines({
  count,
  widths,
  className,
}: {
  count: number;
  widths: string[];
  className?: string;
}) {
  return (
    <div className={cn('space-y-[0.3rem]', className)}>
      {Array.from({ length: count }, (_, index) => (
        // A caller that passes no widths still gets a plausible paragraph rather
        // than nothing, so this mock never renders as an empty box.
        <Bar key={index} width={widths[index % widths.length] ?? '100%'} />
      ))}
    </div>
  );
}

function Bar({
  width,
  dark = false,
  strong = false,
}: {
  width: string;
  dark?: boolean;
  strong?: boolean;
}) {
  return (
    <span
      className={cn('block h-[0.3rem] rounded-full', strong && 'h-[0.34rem]')}
      style={{
        width,
        background: dark ? '#16161d' : strong ? '#3a3a48' : '#c9c9d4',
      }}
    />
  );
}

function PaneTab({ active = false, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-md px-2 py-1 text-[0.625rem] font-medium',
        active ? 'bg-raised text-ink' : 'text-ink-faint',
      )}
    >
      {children}
    </span>
  );
}

function Code({ colour, children }: { colour?: string; children: React.ReactNode }) {
  return (
    <div className="truncate" style={colour ? { color: colour } : undefined}>
      {children}
    </div>
  );
}

function PageIcon() {
  return (
    <svg className="size-3 text-ink-faint" viewBox="0 0 16 16" fill="none">
      <path
        d="M4 2h5l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
