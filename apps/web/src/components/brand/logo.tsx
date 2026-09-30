import { cn } from '@/lib/cn';

/**
 * The Shade mark.
 *
 * The name resolves as **S**tructured **H**arvest · **A**gentic **D**ocument
 * **E**xtraction — five letters, five words, and the two halves of the product:
 * the part that reads a document, and the part that hands the result to an
 * agent.
 *
 * The mark is the name taken literally. A white page sits in front; the same
 * page, offset down and to the right and dimmed, sits behind it. That offset
 * copy is the shade — what the document casts once something has read it, and
 * the structured representation that outlives the original. It is also the
 * product's core claim in one shape: the page is still there, and now there is
 * something behind it.
 *
 * Drawn rather than typeset. A wordmark in a system font would be a different
 * logo on every operating system, which for a product whose whole subject is
 * faithful reproduction would be an odd thing to accept.
 */
export function LogoMark({
  className,
  size = 28,
  /** Set on the landing page's dark hero, where the shadow needs more contrast. */
  glow = false,
}: {
  className?: string;
  size?: number;
  glow?: boolean;
}) {
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
        <linearGradient id="shade-page" x1="6" y1="4" x2="20" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" />
          <stop offset="1" stopColor="#dcdce8" />
        </linearGradient>
        <linearGradient id="shade-cast" x1="12" y1="10" x2="26" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9d8bf5" />
          <stop offset="1" stopColor="#4c3a9e" />
        </linearGradient>
      </defs>

      {/* The cast shape. Drawn first so the page overlaps it. */}
      <rect
        x="11"
        y="9"
        width="16"
        height="19"
        rx="3.5"
        fill="url(#shade-cast)"
        opacity={glow ? 1 : 0.9}
      />

      {/* The page. */}
      <rect x="5" y="4" width="16" height="19" rx="3.5" fill="url(#shade-page)" />

      {/* Three lines of text on the page — enough to read as a document, few
          enough to survive being rendered at 16px in a browser tab. The first
          is the accent because the first thing the engine finds in a document
          is its heading. */}
      <rect x="8" y="9" width="10" height="1.6" rx="0.8" fill="#6e56cf" />
      <rect x="8" y="13" width="8" height="1.6" rx="0.8" fill="#bcbccb" />
      <rect x="8" y="17" width="9.5" height="1.6" rx="0.8" fill="#bcbccb" />
    </svg>
  );
}

/**
 * The wordmark.
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
            'font-semibold leading-none tracking-[-0.025em] text-ink',
            size === 'lg' ? 'text-lg' : size === 'md' ? 'text-[0.9375rem]' : 'text-sm',
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
