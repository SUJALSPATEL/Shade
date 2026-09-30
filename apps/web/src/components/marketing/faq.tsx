import { cn } from '@/lib/cn';

/**
 * FAQ.
 *
 * Built on `<details>` rather than on a client component holding an `openIndex`.
 * The native element already has the behaviour — keyboard operation, the
 * expanded state exposed to assistive technology, in-page find opening a closed
 * answer — and reproducing it in React would be more code that is worse at the
 * job. It also means this section costs no JavaScript at all, which on the page
 * a stranger lands on is worth having.
 *
 * `name` groups them, so opening one closes the others. That is the behaviour
 * an accordion is expected to have, and it is now one attribute.
 */

const QUESTIONS = [
  {
    q: 'How is this different from OCR plus an LLM?',
    a: 'OCR returns a stream of text with the page geometry thrown away, and an LLM asked to reconstruct structure from it is guessing. Shade keeps the geometry: it detects regions, classifies each one, and builds the Markdown and JSON from those regions. Every value in the output can be traced back to a rectangle on a page, which is what makes the result checkable instead of merely plausible.',
  },
  {
    q: 'What happens to the PDF I upload?',
    a: 'It is processed and then discarded. The PDF is never stored as a permanent record — what persists is the Markdown, the typed JSON and the chunks, which is the part with any downstream value. That keeps the storage footprint proportional to the text a document contains rather than to the size of the scan it arrived in.',
  },
  {
    q: 'Which formats can it read?',
    a: 'PDF is the first format and the one the current pipeline is built around, including scanned documents. The processing contract is format-agnostic — a document goes in, regions and structure come out — so additional formats are additions to the pipeline rather than changes to the product around it.',
  },
  {
    q: 'What does the Markdown actually preserve?',
    a: 'Structure that carries meaning: headings and their hierarchy, paragraphs, lists, tables with their alignment, captions, links, and figure references. Page boundaries survive as markers so a passage can still be cited by page. What it deliberately drops is layout noise — column gutters, ruling lines, running headers — because that is the part a model has to spend attention ignoring.',
  },
  {
    q: 'Do I need an account?',
    a: 'Not for your first document. The workspace opens without one, and the first parse is metered server-side rather than by a flag in your browser, so clearing storage does not reset it. An account is what turns the result into something you keep: projects, history, and results you can return to after the PDF itself is gone.',
  },
  {
    q: 'Where does processing actually run?',
    a: 'In a separate service from the API, and deliberately so. The API handles identity, ownership and job state and never opens a document; the processor reads documents and holds no database credentials. Either can be replaced without touching the other, and neither can quietly acquire the other’s responsibilities.',
  },
] as const;

export function Faq({ className }: { className?: string }) {
  return (
    <div className={cn('divide-y divide-line overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface/40', className)}>
      {QUESTIONS.map((item, index) => (
        <details key={item.q} name="shade-faq" className="group" open={index === 0}>
          <summary
            className={cn(
              'flex cursor-pointer list-none items-center gap-4 px-5 py-4 sm:px-6',
              'transition-colors duration-150 hover:bg-raised/60',
              // Safari renders its own disclosure triangle; this hides it so the
              // custom indicator below is the only one drawn.
              '[&::-webkit-details-marker]:hidden',
            )}
          >
            <span className="flex-1 text-[0.9375rem] font-medium text-ink">{item.q}</span>

            <span
              className="relative flex size-5 shrink-0 items-center justify-center text-ink-faint transition-colors group-open:text-accent-bright"
              aria-hidden="true"
            >
              {/* One horizontal rule, plus a vertical one that rotates flat when
                  open — so the indicator is a plus becoming a minus rather than
                  two different glyphs swapping. */}
              <span className="absolute h-px w-3 bg-current" />
              <span className="absolute h-3 w-px bg-current transition-transform duration-200 group-open:rotate-90 group-open:opacity-0" />
            </span>
          </summary>

          <div className="px-5 pb-5 sm:px-6">
            <p className="max-w-3xl text-pretty text-[0.875rem] leading-relaxed text-ink-muted">
              {item.a}
            </p>
          </div>
        </details>
      ))}
    </div>
  );
}
