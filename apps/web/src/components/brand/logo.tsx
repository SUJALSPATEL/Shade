import { cn } from '@/lib/cn';

/**
 * The Shade mark.
 *
 * The name resolves as **S**tructured **H**arvest · **A**gentic **D**ocument
 * **E**xtraction — five letters, five words, and the two halves of the product:
 * the part that reads a document, and the part that hands the result to an
 * agent.
 *
 * The mark is a shop awning: a striped canopy that curves over the top, breaks
 * on a bright gap, and finishes in a row of scallops. It is the name taken
 * literally — the thing that makes shade — and it is the shape a document
 * product wants anyway, because an awning is a *cover*: something laid over
 * what is underneath, which is exactly the relationship between the source PDF
 * and the structure Shade returns.
 *
 * Drawn rather than typeset, and built from one loop rather than from
 * hand-placed rectangles. A wordmark in a system font would be a different logo
 * on every operating system, which for a product whose whole subject is
 * faithful reproduction would be an odd thing to accept.
 */

/** Alternating leaf and lime. Two values, one loop, so the mark stays regular. */
const LEAF = '#7fae3a';
const LIME = '#c3d93f';

/**
 * The geometry, derived once.
 *
 * Every number in the drawing comes off three constants — the radius of the
 * dome, the number of stripes, and the height of the gap — so the mark cannot
 * drift out of proportion when one of them changes. Nine stripes because an odd
 * count starts and ends on leaf, which makes the mark symmetrical; an even
 * count would leave lime on one edge and leaf on the other and read as a
 * mistake at 16px, which is the size most people will meet it at.
 */
const STRIPES = 9;

const AWNING = (() => {
  const r = 13; // dome radius
  const cx = 16; // centre
  const flat = 21; // where the dome meets the gap
  const band = 1.6; // the gap between canopy and scallops
  const left = cx - r;
  const right = cx + r;
  const w = (right - left) / STRIPES;
  const sr = w / 2; // scallop radius
  const sy = flat + band; // the line the scallops hang from

  return {
    r,
    cx,
    flat,
    left,
    right,
    w,
    sr,
    sy,
    /** The canopy: a half-disc sitting on `flat`. */
    dome: `M${left} ${flat}A${r} ${r} 0 0 1 ${right} ${flat}Z`,
    stripes: Array.from({ length: STRIPES }, (_, i) => ({
      x: left + i * w,
      cx: left + (i + 0.5) * w,
      fill: i % 2 === 0 ? LEAF : LIME,
    })),
    /** One scallop, hanging below `sy`. Sweep 0 so the arc bulges downward. */
    scallop: (at: number) => `M${at - sr} ${sy}a${sr} ${sr} 0 0 0 ${sr * 2} 0Z`,
  };
})();

export function LogoMark({
  className,
  size = 28,
}: {
  className?: string;
  size?: number;
}) {
  /**
   * The mask is what makes the shape work.
   *
   * The stripes are full-height rectangles running past both ends of the mark;
   * the mask is the awning silhouette itself. Everything outside that silhouette
   * — above the dome, below the scallops, and the gap between them — is simply
   * never painted, which means the gap shows whatever is behind the mark rather
   * than a hardcoded white. That is the difference between a logo that works on
   * the app's off-white canvas and one that only works on the one background it
   * was drawn against.
   *
   * The id is static rather than unique per instance. Every instance defines the
   * byte-identical mask, so a second copy in the document resolving to the first
   * one's definition renders the same pixels; `useId` would buy nothing and
   * would force this component to be a client component.
   */
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn('shrink-0', className)}
      role="img"
      aria-label="Shade"
    >
      <defs>
        <mask id="shade-awning" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
          <path d={AWNING.dome} fill="#fff" />
          {AWNING.stripes.map((stripe) => (
            <path key={`s${stripe.cx}`} d={AWNING.scallop(stripe.cx)} fill="#fff" />
          ))}
        </mask>
      </defs>

      <g mask="url(#shade-awning)">
        {AWNING.stripes.map((stripe) => (
          <rect
            key={`b${stripe.cx}`}
            x={stripe.x}
            y="0"
            width={AWNING.w}
            height="32"
            fill={stripe.fill}
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * The wordmark.
 *
 * Set in the display serif, not the interface sans. The name and the headline
 * are the same voice — a stranger who reads "Shade" in the header and then reads
 * the headline below it should not be meeting two different products.
 *
 * `block` stacks the tagline under the name, which is what the landing page and
 * the auth screens use; the default inline form is for the sidebar and the
 * header, where vertical space is the scarce resource.
 */
export function Wordmark({
  className,
  size = 'md',
  block = false,
  tagline = true,
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  block?: boolean;
  tagline?: boolean;
}) {
  const markSize = size === 'lg' ? 34 : size === 'md' ? 26 : 20;

  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark size={markSize} />
      <span className={cn('flex min-w-0 flex-col', block ? 'gap-0.5' : 'gap-0')}>
        <span
          className={cn(
            'font-serif font-semibold leading-none tracking-[-0.02em] text-ink',
            size === 'lg' ? 'text-xl' : size === 'md' ? 'text-base' : 'text-sm',
          )}
        >
          Shade
        </span>
        {tagline ? (
          <span
            className={cn(
              'truncate leading-tight text-ink-faint',
              size === 'lg' ? 'text-xs' : 'text-[0.625rem] tracking-[0.02em]',
            )}
          >
            Agentic Document Extraction
          </span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * The backronym, spelled out.
 *
 * Used once — on the landing page — where it does real work: it tells a visitor
 * what the product is before they have read a sentence of copy. Repeating it in
 * the sidebar or the footer would turn a piece of naming into a tic.
 */
export function Backronym({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-xs', className)}>
      <span className="text-ink">
        <span className="text-accent-bright">S</span>tructured
      </span>
      <span className="text-ink">
        <span className="text-accent-bright">H</span>arvest
      </span>
      <span className="text-ink-faint">·</span>
      <span className="text-ink-muted">
        <span className="text-accent-bright">A</span>gentic
      </span>
      <span className="text-ink-muted">
        <span className="text-accent-bright">D</span>ocument
      </span>
      <span className="text-ink-muted">
        <span className="text-accent-bright">E</span>xtraction
      </span>
    </div>
  );
}
