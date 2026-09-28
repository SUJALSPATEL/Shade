'use client';

import { useCallback, useMemo } from 'react';
import type { DocumentChunk } from '@shade/shared';
import { documents } from '@/lib/endpoints';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { Tabs } from '@/components/ui/tabs';
import { cn } from '@/lib/cn';
import { PageMap, type PageGeometry } from './page-map';

/**
 * The document pane.
 *
 * Two ways to look at the same file, and both are honest about what they are:
 *
 * **Document** renders the actual PDF, in the browser's own viewer, served from
 * `GET /api/documents/:id/raw`. It is the source of truth — the thing every
 * claim in the other pane can be checked against.
 *
 * **Regions** draws the detected chunks over a page, positioned from real
 * bounding boxes. It is the reading of the document, and it is what makes the
 * output auditable: a table in the Markdown can be traced to the rectangle it
 * came from in two clicks.
 *
 * They are deliberately *not* composited into one view. Overlaying absolutely
 * positioned boxes on a PDF rendered by the browser's built-in viewer is not
 * possible — the viewer is a closed plugin, and its scroll position, zoom and
 * page layout are not exposed to the page. The alternative would be shipping a
 * JavaScript PDF renderer, which is a large dependency to draw boxes that the
 * region view already draws more legibly.
 */

export type ViewerMode = 'document' | 'regions';

export function DocumentViewer({
  documentId,
  filename,
  chunks,
  pages,
  mode,
  onModeChange,
  activePage,
  onPageChange,
  selectedChunkId,
  onSelectChunk,
  className,
}: {
  documentId: string;
  filename: string;
  chunks: DocumentChunk[];
  pages: PageGeometry[];
  mode: ViewerMode;
  onModeChange: (mode: ViewerMode) => void;
  activePage: number;
  onPageChange: (page: number) => void;
  selectedChunkId: string | null;
  onSelectChunk: (chunk: DocumentChunk) => void;
  className?: string;
}) {
  const pageCount = pages.length;

  const currentPage = useMemo<PageGeometry>(
    () =>
      pages.find((page) => page.pageNumber === activePage) ??
      pages[0] ?? { pageNumber: 1, width: 595, height: 842 },
    [pages, activePage],
  );

  const chunksOnPage = useMemo(
    () => chunks.filter((chunk) => chunk.page_number === currentPage.pageNumber).length,
    [chunks, currentPage.pageNumber],
  );

  // The fragment is what tells the browser's PDF viewer which page to open on.
  // Setting the whole `src` rather than poking `location.hash` inside the frame
  // avoids reaching across the origin boundary into a document this app does
  // not control.
  const rawUrl = `${documents.rawUrl(documentId)}#page=${currentPage.pageNumber}&view=FitH`;

  const step = useCallback(
    (delta: number) => {
      const next = Math.min(Math.max(currentPage.pageNumber + delta, 1), Math.max(pageCount, 1));
      onPageChange(next);
    },
    [currentPage.pageNumber, pageCount, onPageChange],
  );

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Tabs
          aria-label="Document view"
          size="sm"
          value={mode}
          onValueChange={(next) => onModeChange(next as ViewerMode)}
          items={[
            { value: 'document', label: 'Document' },
            { value: 'regions', label: 'Regions', count: chunks.length },
          ]}
        />

        <div className="ml-auto flex items-center gap-1.5">
          {pageCount > 0 ? (
            <>
              <Tooltip label="Previous page">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => step(-1)}
                  disabled={currentPage.pageNumber <= 1}
                  aria-label="Previous page"
                  className="px-2"
                >
                  <ChevronIcon direction="left" />
                </Button>
              </Tooltip>

              <span className="min-w-16 text-center font-mono text-xs tabular-nums text-ink-muted">
                {currentPage.pageNumber} / {pageCount}
              </span>

              <Tooltip label="Next page">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => step(1)}
                  disabled={currentPage.pageNumber >= pageCount}
                  aria-label="Next page"
                  className="px-2"
                >
                  <ChevronIcon direction="right" />
                </Button>
              </Tooltip>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-auto bg-canvas p-4">
        {mode === 'document' ? (
          <div className="h-full min-h-[32rem] overflow-hidden rounded-md border border-line bg-raised">
            <iframe
              // Keyed on the document only. Re-keying on the page would remount
              // the viewer and flash white on every page step; the fragment
              // below is enough to move within an already-loaded document.
              key={documentId}
              src={rawUrl}
              title={`Preview of ${filename}`}
              className="size-full"
            />
          </div>
        ) : (
          <div className="mx-auto max-w-2xl">
            <PageMap
              page={currentPage}
              chunks={chunks}
              selectedChunkId={selectedChunkId}
              onSelectChunk={onSelectChunk}
            />

            <p className="mt-4 text-center text-xs text-ink-faint">
              {chunksOnPage} {chunksOnPage === 1 ? 'region' : 'regions'} on page{' '}
              {currentPage.pageNumber}
              {selectedChunkId ? ' · click a region to inspect it' : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={direction === 'left' ? 'M10 4 6 8l4 4' : 'M6 4l4 4-4 4'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
