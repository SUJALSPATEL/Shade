import { cn } from '@/lib/cn';

/**
 * The strip of document types, scrolling under the hero.
 *
 * What this is *not* is a wall of customer logos. Shade has no customers yet,
 * and drawing a row of other companies' marks onto a page that has not earned
 * them would be a lie told in the most expensive place on the site. The honest
 * version of the same section says what the thing has actually been pointed at,
 * which is also the more useful sentence for a visitor deciding whether their
 * document is covered.
 *
 * The track is rendered twice and translated by exactly half its width, so the
 * second copy lands where the first began and the loop has no seam. The copy is
 * `aria-hidden` because a screen reader has no use for the second pass.
 */

const DOCUMENT_TYPES = [
  'Invoices',
  'Contracts',
  'Research papers',
  'Bank statements',
  'Insurance claims',
  'Financial reports',
  'Purchase orders',
  'Leases',
  'SEC filings',
  'Clinical notes',
  'Policy documents',
  'Technical manuals',
] as const;

export function TrustMarquee({ className }: { className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <p className="text-center text-[0.75rem] text-ink-faint">
        Built for the documents that resist a template
      </p>

      <div className="mask-fade-x mt-5 overflow-hidden">
        <div className="flex w-max animate-marquee gap-3 hover:[animation-play-state:paused]">
          <Row />
          <Row aria-hidden />
        </div>
      </div>
    </div>
  );
}

function Row({ 'aria-hidden': ariaHidden }: { 'aria-hidden'?: boolean }) {
  return (
    <div className="flex shrink-0 gap-3" aria-hidden={ariaHidden}>
      {DOCUMENT_TYPES.map((type) => (
        <span
          key={type}
          className="flex items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface/70 px-4 py-2 text-[0.8125rem] text-ink-muted"
        >
          <span className="size-1 rounded-full bg-line-strong" aria-hidden="true" />
          {type}
        </span>
      ))}
    </div>
  );
}
