'use client';

import { useEffect, useRef } from 'react';
import type { DocumentChunk } from '@shade/shared';
import { ChunkTypeChip } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

/**
 * The detected regions, in reading order.
 *
 * Ordered by chunk id rather than by position, because the processor emits them
 * in reading order and that is the order a person checks them in. Each row
 * carries what a reader needs to judge it: what kind of region it is, which
 * page it came from, how confident the detector was, and enough text to
 * recognise it.
 *
 * Low-confidence rows are marked rather than hidden. A detector that quietly
 * drops the regions it is unsure about is one you cannot calibrate — the whole
 * point of returning a confidence is that a human gets to decide what to do
 * with a 0.62.
 */

/** Below this, a region is flagged as worth a second look. */
const LOW_CONFIDENCE = 0.75;

export function ChunkList({
  chunks,
  selectedChunkId,
  onSelectChunk,
  className,
}: {
  chunks: DocumentChunk[];
  selectedChunkId: string | null;
  onSelectChunk: (chunk: DocumentChunk) => void;
  className?: string;
}) {
  const selectedRef = useRef<HTMLLIElement>(null);

  // Selecting a region in the page map has to bring its row into view —
  // otherwise clicking a box near the bottom of the page appears to do nothing
  // at all, because the row it highlights is off-screen.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedChunkId]);

  if (chunks.length === 0) {
    return (
      <p className={cn('px-5 py-10 text-center text-[0.8125rem] text-ink-muted', className)}>
        No regions were detected in this document.
      </p>
    );
  }

  return (
    <ul className={cn('divide-y divide-line', className)}>
      {chunks.map((chunk) => {
        const selected = chunk.chunk_id === selectedChunkId;
        const lowConfidence = chunk.confidence < LOW_CONFIDENCE;

        return (
          <li key={chunk.chunk_id} ref={selected ? selectedRef : undefined}>
            <button
              type="button"
              onClick={() => onSelectChunk(chunk)}
              aria-pressed={selected}
              className={cn(
                'block w-full px-5 py-3.5 text-left transition-colors duration-150',
                selected ? 'bg-accent-soft' : 'hover:bg-raised',
              )}
            >
              <div className="flex items-center gap-2">
                <ChunkTypeChip type={chunk.type} />

                <span className="font-mono text-[0.625rem] tabular-nums text-ink-faint">
                  p{chunk.page_number}
                </span>

                <span
                  className={cn(
                    'ml-auto font-mono text-[0.625rem] tabular-nums',
                    lowConfidence ? 'text-warning' : 'text-ink-faint',
                  )}
                  title={`Detection confidence ${Math.round(chunk.confidence * 100)}%`}
                >
                  {Math.round(chunk.confidence * 100)}%
                </span>
              </div>

              <p
                className={cn(
                  'mt-1.5 line-clamp-3 text-[0.8125rem] leading-relaxed wrap-anywhere',
                  selected ? 'text-ink' : 'text-ink-muted',
                )}
              >
                {chunk.text}
              </p>

              {chunk.heading_level ? (
                <p className="mt-1 font-mono text-[0.625rem] text-ink-faint">
                  heading level {chunk.heading_level}
                </p>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
