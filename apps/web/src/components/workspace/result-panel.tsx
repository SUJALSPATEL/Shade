'use client';

import { useMemo, useState } from 'react';
import type { DocumentChunk, ParseResult } from '@shade/shared';
import { stripExtension } from '@shade/shared';
import { documents } from '@/lib/endpoints';
import { useResource } from '@/lib/hooks/use-resource';
import { CopyButton, DownloadButton } from '@/components/ui/copy-button';
import { Tabs } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { SkeletonLines } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { ChunkList } from './chunk-list';
import { MarkdownView } from './markdown-view';

/**
 * The result pane: the three representations of the same reading.
 *
 * **Regions** — what was detected, where.
 * **Markdown** — the primary output, and the thing an agent is most likely to
 * be handed.
 * **JSON** — the same structure with types.
 *
 * All three are rendered from data the job already returned, with one
 * exception: the Markdown body is its own storage artifact, so it is fetched
 * separately. That is the storage rule showing through the UI — the two
 * representations are versioned and cached independently, which is the reason
 * the API does not inline the Markdown into the job response.
 *
 * The Markdown tab opens on the *rendered* view, with the exact source one
 * click away. Rendered is what a person wants to see; source is what they need
 * when they are about to paste it somewhere, and both are the same bytes.
 */

export type ResultTab = 'regions' | 'markdown' | 'json';

export function ResultPanel({
  documentId,
  filename,
  result,
  selectedChunkId,
  onSelectChunk,
  tab,
  onTabChange,
  className,
}: {
  documentId: string;
  filename: string;
  /** The completed ParseResult, straight from the job status response. */
  result: ParseResult;
  selectedChunkId: string | null;
  onSelectChunk: (chunk: DocumentChunk) => void;
  tab: ResultTab;
  onTabChange: (tab: ResultTab) => void;
  className?: string;
}) {
  const [markdownView, setMarkdownView] = useState<'rendered' | 'source'>('rendered');

  const markdown = useResource(`markdown:${documentId}`, () => documents.markdown(documentId));

  const base = stripExtension(filename);
  // The JSON tab shows the whole ParseResult — the same bytes the download
  // produces. Anything narrower would mean the thing on screen and the thing in
  // the file disagree, which is exactly the discrepancy a JSON view exists to
  // rule out.
  const jsonText = useMemo(() => JSON.stringify(result, null, 2), [result]);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Tabs
          aria-label="Result view"
          size="sm"
          value={tab}
          onValueChange={(next) => onTabChange(next as ResultTab)}
          items={[
            { value: 'regions', label: 'Regions', count: result.chunks.length },
            { value: 'markdown', label: 'Markdown' },
            { value: 'json', label: 'JSON' },
          ]}
        />

        <div className="ml-auto flex items-center gap-2">
          {tab === 'markdown' && markdown.data ? (
            <>
              <Tabs
                aria-label="Markdown view"
                size="sm"
                value={markdownView}
                onValueChange={(next) => setMarkdownView(next as 'rendered' | 'source')}
                items={[
                  { value: 'rendered', label: 'Rendered' },
                  { value: 'source', label: 'Source' },
                ]}
              />
              <CopyButton value={markdown.data.markdown} label="Copy Markdown" variant="ghost" />
              <DownloadButton
                value={markdown.data.markdown}
                filename={`${base}.md`}
                mimeType="text/markdown;charset=utf-8"
                label=".md"
                variant="ghost"
              />
            </>
          ) : null}

          {tab === 'json' ? (
            <>
              <CopyButton value={jsonText} label="Copy JSON" variant="ghost" />
              <DownloadButton
                value={jsonText}
                filename={`${base}.json`}
                mimeType="application/json"
                label=".json"
                variant="ghost"
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'regions' ? (
          <ChunkList
            chunks={result.chunks}
            selectedChunkId={selectedChunkId}
            onSelectChunk={onSelectChunk}
          />
        ) : null}

        {tab === 'json' ? (
          <pre className="overflow-x-auto px-5 py-4 font-mono text-[0.6875rem] leading-[1.7] text-ink-muted">
            <code>{jsonText}</code>
          </pre>
        ) : null}

        {tab === 'markdown' ? (
          <>
            {markdown.isLoading ? (
              <div className="p-6">
                <SkeletonLines lines={8} />
              </div>
            ) : null}

            {markdown.error ? (
              <ErrorState error={markdown.error} onRetry={markdown.reload} compact />
            ) : null}

            {markdown.data ? (
              markdownView === 'rendered' ? (
                <div className="bg-paper p-6 sm:p-8">
                  <MarkdownView
                    markdown={markdown.data.markdown}
                    // The generator writes asset references relative to the
                    // document, so a bare filename has to be resolved against
                    // the document that produced it.
                    resolveAsset={(src) =>
                      documents.assetUrl(documentId, src.replace(/^\.?\/?assets\//, ''))
                    }
                  />
                </div>
              ) : (
                <pre className="overflow-x-auto px-5 py-4 font-mono text-[0.6875rem] leading-[1.75] text-ink-muted">
                  <code>{markdown.data.markdown}</code>
                </pre>
              )
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The metadata strip under the result header.
 *
 * Kept as a separate component because it is the one place the UI admits what
 * produced the output. `mocked: true` is rendered as a visible chip rather than
 * hidden — a demo that shows fixture data without saying so is a demo that has
 * taught the user something false about the product.
 */
export function ResultMeta({ result, className }: { result: ParseResult; className?: string }) {
  const { metadata, assets, json } = result;

  return (
    <Card className={cn('flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3', className)}>
      <Meta label="Engine" value={`${metadata.engine} ${metadata.version}`} />
      <Meta label="Pages" value={String(json.page_count)} />
      <Meta label="Sections" value={String(json.sections.length)} />
      <Meta label="Tables" value={String(json.tables.length)} />
      <Meta label="Assets" value={String(assets.length)} />
      <Meta label="Took" value={`${metadata.durationMs} ms`} />

      {metadata.mocked ? (
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning-soft px-2 py-0.5 text-[0.6875rem] font-medium text-warning">
          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
          Fixture output — processing is mocked in this milestone
        </span>
      ) : null}
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-[0.625rem] uppercase tracking-[0.08em] text-ink-faint">
        {label}
      </span>
      <span className="text-[0.8125rem] tabular-nums text-ink-muted">{value}</span>
    </span>
  );
}
