import {
  JOB_STAGE_LABELS,
  OPERATION_LABELS,
  OPERATION_STAGES,
  type Operation,
} from '@shade/shared';
import { cn } from '@/lib/cn';

/**
 * The pipeline, as a rail.
 *
 * A parse is not one opaque call, and the thing that makes that legible is
 * showing the itinerary rather than the vocabulary. The rail draws Parse's
 * stages and marks where Extract and Split leave it early — a Split job never
 * extracts tables, and a progress view that pretends otherwise makes every
 * Split look like a Parse that stalled two thirds of the way through.
 *
 * That divergence is the reason this is a drawing and not a bulleted list: the
 * interesting information is *where the three operations stop agreeing*, and
 * only a shared axis can show that.
 */

const PARSE = OPERATION_STAGES.PARSE;

/**
 * The two operations that leave the rail early, and where.
 *
 * Derived from `OPERATION_STAGES` rather than written out by hand. The list of
 * skipped stages is precisely the thing that goes stale when a processor gains
 * a stage, and a sentence describing what a pipeline does is wrong the moment
 * the pipeline changes. Reading it off the shared constant means this section
 * cannot describe an itinerary the worker does not walk.
 */
const DIVERGENCE = (['EXTRACT', 'SPLIT'] as const).map((operation: Operation) => ({
  operation,
  label: OPERATION_LABELS[operation],
  count: OPERATION_STAGES[operation].length,
  skipped: PARSE.filter((stage) => !OPERATION_STAGES[operation].includes(stage)),
}));

export function PipelineRail() {
  return (
    <div className="panel overflow-hidden">
      {/* ── The rail ───────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto p-5 sm:p-7">
        <ol className="relative flex min-w-[46rem] items-start gap-0">
          {/* The track. Drawn behind the nodes, spanning from the first centre
              to the last, so it does not overhang either end. */}
          <span
            className="absolute left-[1.125rem] right-[1.125rem] top-[1.125rem] h-px bg-line"
            aria-hidden="true"
          />
          {/* The travelling light. Purely decorative, and the only moving thing
              in the section — which is what makes it read as progress rather
              than as decoration. */}
          <span
            className="absolute left-[1.125rem] right-[1.125rem] top-[1.125rem] h-px overflow-hidden"
            aria-hidden="true"
          >
            <span
              className="block h-px w-24 animate-sweep"
              style={{
                background:
                  'linear-gradient(90deg, transparent, var(--color-accent-bright), transparent)',
              }}
            />
          </span>

          {PARSE.map((stage, index) => (
            <li key={stage} className="relative flex flex-1 flex-col items-center">
              <span className="flex size-9 items-center justify-center rounded-full border border-line bg-canvas">
                <span
                  className={cn(
                    'font-mono text-[0.625rem] tabular-nums',
                    index === 0 ? 'text-accent-bright' : 'text-ink-faint',
                  )}
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
              </span>
              <span className="mt-3 max-w-[6.5rem] text-center text-[0.6875rem] leading-tight text-ink-muted">
                {JOB_STAGE_LABELS[stage]}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* ── Where the operations diverge ───────────────────────────────────── */}
      <div className="border-t border-line px-5 py-5 sm:px-7">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-[0.8125rem] font-semibold text-ink">Parse</dt>
            <dd className="mt-1 text-[0.75rem] leading-relaxed text-ink-muted">
              Walks all {PARSE.length} stages — the only operation that produces Markdown.
            </dd>
          </div>

          {DIVERGENCE.map(({ operation, label, count, skipped }) => (
            <div key={operation}>
              <dt className="text-[0.8125rem] font-semibold text-ink">{label}</dt>
              <dd className="mt-1 text-[0.75rem] leading-relaxed text-ink-muted">
                Runs {count} of the {PARSE.length}. Skips{' '}
                {skipped.map((stage) => JOB_STAGE_LABELS[stage].toLowerCase()).join(', ')}.
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-5 border-t border-line pt-5 text-[0.75rem] leading-relaxed text-ink-faint">
          Skipped stages are reported as skipped, not as stalled. A failure lands on the stage that
          caused it, and the artifact written before it is still there.
        </p>
      </div>
    </div>
  );
}
