'use client';

import { useMemo } from 'react';
import type { DocumentChunk } from '@shade/shared';
import { CHUNK_COLOURS, CHUNK_LABELS } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

/**
 * Page map — the detected regions drawn where they were found.
 *
 * Every box here is positioned from real data: `bounding_box` in PDF points
 * against the page's own width and height, both of which come from the API. The
 * geometry is what makes this worth looking at rather than a second list — it
 * shows *where* on the page something was found, which is the thing a reader
 * needs in order to trust that "Revenue by region" came from the table and not
 * from a paragraph that mentioned it.
 *
 * Coordinates are scaled by percentage rather than by pixels, so the map stays
 * correct at any size and the layout never has to measure anything.
 */

export interface PageGeometry {
  pageNumber: number;
  width: number;
  height: number;
}

export function PageMap({
  page,
  chunks,
  selectedChunkId,
  onSelectChunk,
  className,
}: {
  page: PageGeometry;
  /** All chunks for the document; the ones on other pages are filtered out. */
  chunks: DocumentChunk[];
  selectedChunkId: string | null;
  onSelectChunk: (chunk: DocumentChunk) => void;
  className?: string;
}) {
  const onPage = useMemo(
    () => chunks.filter((chunk) => chunk.page_number === page.pageNumber),
    [chunks, page.pageNumber],
  );

  const aspect = page.height === 0 ? 1.294 : page.width / page.height;

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-md bg-paper shadow-[0_2px_20px_-6px_rgba(0,0,0,0.45)]',
        className,
      )}
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
    >
      {/* A faint rule down the content column, so the page reads as a page
          rather than as an empty white box with coloured rectangles on it. */}
      <div
        className="absolute inset-y-[6%] left-[8.5%] w-px bg-[#ececf1]"
        style={{ aspectRatio: undefined }}
        aria-hidden="true"
      />

      {onPage.map((chunk) => {
        const colour = CHUNK_COLOURS[chunk.type];
        const selected = chunk.chunk_id === selectedChunkId;

        return (
          <button
            key={chunk.chunk_id}
            type="button"
            onClick={() => onSelectChunk(chunk)}
            title={`${CHUNK_LABELS[chunk.type]} · ${Math.round(chunk.confidence * 100)}% confidence`}
            aria-label={`${CHUNK_LABELS[chunk.type]} on page ${chunk.page_number}, ${Math.round(
              chunk.confidence * 100,
            )} percent confidence`}
            aria-pressed={selected}
            className={cn(
              'absolute rounded-[2px] border transition-all duration-150',
              'hover:z-10 hover:shadow-[0_0_0_2px_rgba(255,255,255,0.6)]',
              selected ? 'z-10 border-2 shadow-[0_0_0_2px_rgba(255,255,255,0.9)]' : 'border',
            )}
            style={{
              left: `${(chunk.bounding_box.x / page.width) * 100}%`,
              top: `${(chunk.bounding_box.y / page.height) * 100}%`,
              width: `${(chunk.bounding_box.width / page.width) * 100}%`,
              height: `${(chunk.bounding_box.height / page.height) * 100}%`,
              borderColor: `color-mix(in srgb, ${colour} ${selected ? '100%' : '60%'}, transparent)`,
              background: `color-mix(in srgb, ${colour} ${selected ? '34%' : '16%'}, transparent)`,
            }}
          />
        );
      })}

      {/* The page number, as the source document would have it. */}
      <span
        className="pointer-events-none absolute bottom-[3%] left-1/2 -translate-x-1/2 font-mono text-[0.5rem] text-[#a5a5b4]"
        aria-hidden="true"
      >
        {page.pageNumber}
      </span>
    </div>
  );
}
