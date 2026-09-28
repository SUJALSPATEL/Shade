'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ApiError,
  OPERATION_LABELS,
  formatBytes,
  formatPageCount,
  relativeTime,
  stripExtension,
  type DocumentChunk,
  type SplitMatch,
} from '@shade/shared';
import {
  documents as documentsApi,
  jobs as jobsApi,
  split as splitApi,
} from '@/lib/endpoints';
import { useResource } from '@/lib/hooks/use-resource';
import { useJobPoll } from '@/lib/hooks/use-job-poll';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { DocumentStatusBadge, JobStatusBadge } from '@/components/ui/badge';
import { CopyButton, DownloadButton } from '@/components/ui/copy-button';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { Field, Input } from '@/components/ui/input';
import { ErrorState, EmptyState } from '@/components/ui/states';
import { SkeletonLines } from '@/components/ui/skeleton';
import { DocumentViewer, type ViewerMode } from '@/components/workspace/document-viewer';
import { ChunkList } from '@/components/workspace/chunk-list';
import { MarkdownView } from '@/components/workspace/markdown-view';
import { ProcessingPanel } from '@/components/workspace/processing-panel';

/**
 * One document.
 *
 * The workspace at `/parse` answers "what does this produce?" for a file that
 * was just uploaded. This page answers "what did it produce?" for a file that
 * is already in the account — which sounds like the same question and is not:
 *
 *   - It reads the **persisted artifacts**, not a job response. The Markdown
 *     comes from `GET /markdown` and the JSON from `GET /json`, so what is on
 *     screen is what is in storage, not a re-render of it.
 *   - It reads **real page geometry** from `GET /chunks`, so the region overlay
 *     is positioned from the processor's own numbers rather than a default.
 *   - It can **run Split** against the document, which is a read-only query and
 *     therefore has no job, no queue and no polling — it is the one operation
 *     that can be answered in a request.
 *
 * The tabs are lazy: Markdown is fetched when you open the Markdown tab, not
 * before. A document nobody reads the JSON of should not cost a JSON fetch on
 * every visit, and these payloads are the largest things the API serves.
 */

type DocTab = 'regions' | 'markdown' | 'json' | 'ask';

export default function DocumentDetailPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = use(params);

  const [tab, setTab] = useState<DocTab>('regions');
  const [viewerMode, setViewerMode] = useState<ViewerMode>('document');
  const [activePage, setActivePage] = useState(1);
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const detail = useResource(`document:${documentId}`, () => documentsApi.get(documentId));
  const chunks = useResource(`chunks:${documentId}`, () => documentsApi.chunks(documentId));

  /**
   * Lazy artifacts.
   *
   * The key is `none` until the tab has been opened, which parks the hook on a
   * key it has already loaded — no request, no state churn. Once opened the key
   * becomes the real one and the fetch runs exactly once.
   */
  const markdown = useResource(tab === 'markdown' ? `md:${documentId}` : 'md:none', () =>
    tab === 'markdown' ? documentsApi.markdown(documentId) : Promise.resolve(null),
  );
  const json = useResource(tab === 'json' ? `json:${documentId}` : 'json:none', () =>
    tab === 'json' ? documentsApi.json(documentId) : Promise.resolve(null),
  );

  // Polling is only wired up once a re-run has been started from this page.
  const poll = useJobPoll(jobId);
  const rerunning = jobId !== null && (poll.job?.status === 'QUEUED' || poll.job?.status === 'PROCESSING');

  const document = detail.data?.document ?? null;
  const chunkList = useMemo(() => chunks.data?.chunks ?? [], [chunks.data]);

  const pages = useMemo(
    () =>
      chunks.data?.pages?.length
        ? chunks.data.pages
        : [{ pageNumber: 1, width: 595, height: 842 }],
    [chunks.data],
  );

  const selectChunk = useCallback((chunk: DocumentChunk) => {
    setSelectedChunkId(chunk.chunk_id);
    setActivePage(chunk.page_number);
    setViewerMode('regions');
    setTab('regions');
  }, []);

  /** Re-runs Parse against the stored file — no re-upload, no new document. */
  const reprocess = useCallback(async () => {
    if (!document) return;
    try {
      const created = await jobsApi.create({
        documentId: document.id,
        operation: 'PARSE',
        parseInput: { extractImages: true, keepFurniture: false },
      });
      setJobId(created.job.id);
    } catch (cause) {
      window.alert(
        cause instanceof ApiError ? cause.message : 'That job could not be started.',
      );
    }
  }, [document]);

  if (detail.error && !detail.data) {
    return (
      <>
        <DetailHeader />
        <ErrorState error={detail.error} onRetry={detail.reload} />
      </>
    );
  }

  if (detail.isLoading || !detail.data || !document) {
    return (
      <>
        <DetailHeader />
        <div className="space-y-6 p-4 sm:p-6">
          <SkeletonLines lines={1} className="max-w-sm" />
          <div className="h-[36rem] rounded-[var(--radius-card)] border border-line bg-surface" />
        </div>
      </>
    );
  }

  const { project, jobs, availability } = detail.data;
  const markdownText = markdown.data?.markdown ?? '';
  const base = stripExtension(document.filename);

  return (
    <>
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="border-b border-line px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {project ? (
              <Link
                href={`/projects/${project.id}`}
                className="mb-1.5 inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-muted transition-colors hover:text-ink"
              >
                <svg className="size-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M11.5 6 7.5 10l4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {project.name}
              </Link>
            ) : null}

            <h1 className="truncate text-lg font-semibold tracking-[-0.02em] text-ink">
              {document.filename}
            </h1>

            <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[0.6875rem] text-ink-faint">
              <DocumentStatusBadge status={document.status} />
              <span>{formatPageCount(document.pageCount)}</span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(document.sizeBytes)}</span>
              <span aria-hidden="true">·</span>
              <span>{availability.chunks} regions</span>
              <span aria-hidden="true">·</span>
              <span>added {relativeTime(document.createdAt)}</span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={rerunning}
              onClick={() => void reprocess()}
            >
              {rerunning ? 'Reprocessing…' : 'Reprocess'}
            </Button>
          </div>
        </div>

        {document.summary ? (
          <p className="mt-3 max-w-3xl text-[0.8125rem] leading-relaxed text-ink-muted">
            {document.summary}
          </p>
        ) : null}
      </div>

      {/* ── A re-run in flight ───────────────────────────────────────────── */}
      {rerunning && poll.job ? (
        <div className="border-b border-line px-4 py-4 sm:px-6">
          <ProcessingPanel
            filename={document.filename}
            sizeBytes={document.sizeBytes}
            operation="PARSE"
            upload={null}
            job={poll.job}
            failure={null}
            onRetry={() => void reprocess()}
            onCancel={() => setJobId(null)}
          />
        </div>
      ) : null}

      {/* A re-run that finished changes the artifacts — refetch rather than
          leaving the reader looking at the previous run's Markdown. */}
      {jobId && poll.job?.status === 'COMPLETED' ? (
        <ReloadOnComplete
          onComplete={() => {
            setJobId(null);
            detail.reload();
            chunks.reload();
            if (tab === 'markdown') markdown.reload();
            if (tab === 'json') json.reload();
          }}
        />
      ) : null}

      {/* ── Two panes ────────────────────────────────────────────────────── */}
      <div className="grid min-h-0 gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
        <div className="flex min-h-[36rem] flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface lg:min-h-[42rem]">
          <DocumentViewer
            documentId={document.id}
            filename={document.filename}
            chunks={chunkList.filter((chunk) => chunk.page_number === activePage)}
            pages={pages}
            mode={viewerMode}
            onModeChange={setViewerMode}
            activePage={activePage}
            onPageChange={(page) => {
              setActivePage(page);
              setSelectedChunkId(null);
            }}
            selectedChunkId={selectedChunkId}
            onSelectChunk={selectChunk}
            className="min-h-0 flex-1"
          />
        </div>

        <div className="flex min-h-[36rem] flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface lg:min-h-[42rem]">
          <div className="border-b border-line px-4 py-3">
            <Tabs
              aria-label="Document output"
              size="sm"
              value={tab}
              onValueChange={(next) => setTab(next as DocTab)}
              items={TABS(availability.chunks)}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {tab === 'regions' ? (
              <ChunkList
                chunks={chunkList}
                selectedChunkId={selectedChunkId}
                onSelectChunk={selectChunk}
              />
            ) : null}

            {tab === 'markdown' ? (
              <ArtifactPane
                isLoading={markdown.isLoading}
                error={markdown.error}
                onRetry={markdown.reload}
                available={availability.markdown}
                emptyDescription="This document has no Markdown artifact yet. Run a Parse job to generate one."
                toolbar={
                  markdownText ? (
                    <>
                      <CopyButton value={markdownText} />
                      <DownloadButton
                        value={markdownText}
                        filename={`${base}.md`}
                        mimeType="text/markdown;charset=utf-8"
                      />
                    </>
                  ) : null
                }
              >
                <div className="p-5">
                  <MarkdownView
                    markdown={markdownText}
                    resolveAsset={(src) => documentsApi.assetUrl(document.id, src)}
                  />
                </div>
              </ArtifactPane>
            ) : null}

            {tab === 'json' ? (
              <ArtifactPane
                isLoading={json.isLoading}
                error={json.error}
                onRetry={json.reload}
                available={availability.json}
                emptyDescription="This document has no JSON artifact yet. Run a Parse job to generate one."
                toolbar={
                  json.data ? (
                    <>
                      <CopyButton value={JSON.stringify(json.data.json, null, 2)} />
                      <DownloadButton
                        value={JSON.stringify(json.data, null, 2)}
                        filename={`${base}.json`}
                        mimeType="application/json"
                      />
                    </>
                  ) : null
                }
              >
                <pre className="overflow-x-auto p-5 font-mono text-[0.75rem] leading-relaxed text-ink-muted">
                  {json.data ? JSON.stringify(json.data.json, null, 2) : ''}
                </pre>
              </ArtifactPane>
            ) : null}

            {tab === 'ask' ? <SplitPane documentId={document.id} onSelectMatch={selectChunk} /> : null}
          </div>
        </div>
      </div>

      {/* ── Jobs ─────────────────────────────────────────────────────────── */}
      <div className="px-4 pb-6 sm:px-6">
        <Card>
          <CardHeader title="Jobs" description="Every run against this document, newest first." />
          {jobs.length === 0 ? (
            <EmptyState title="No jobs yet" />
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {jobs.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 text-[0.8125rem]"
                >
                  <JobStatusBadge status={job.status} />
                  <span className="font-medium text-ink">{OPERATION_LABELS[job.operation]}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-muted">
                    {job.error?.message ?? job.stage ?? ''}
                  </span>
                  <span className="font-mono text-[0.6875rem] tabular-nums text-ink-faint">
                    {job.progress}%
                  </span>
                  <span className="font-mono text-[0.6875rem] text-ink-faint">
                    {relativeTime(job.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

/** Fires its `onComplete` exactly once, after the completed job has rendered. */
function ReloadOnComplete({ onComplete }: { onComplete: () => void }) {
  // Held in a ref so a caller passing an inline arrow does not re-run the
  // effect on every render — the effect's whole job is to run *once*.
  const callback = useRef(onComplete);
  callback.current = onComplete;

  useEffect(() => {
    callback.current();
  }, []);

  return null;
}

function TABS(chunkCount: number): TabItem<DocTab>[] {
  return [
    { value: 'regions', label: 'Regions', count: chunkCount },
    { value: 'markdown', label: 'Markdown' },
    { value: 'json', label: 'JSON' },
    { value: 'ask', label: 'Ask' },
  ];
}

function DetailHeader() {
  return (
    <div className="border-b border-line px-4 py-5 sm:px-6">
      <h1 className="text-lg font-semibold tracking-[-0.02em] text-ink">Document</h1>
    </div>
  );
}

/**
 * Wrapper for a lazily-fetched artifact.
 *
 * Three states that look similar and are not: still loading, the artifact does
 * not exist (no Parse has run), and the fetch failed. Rendering the third as
 * the second is the classic mistake here — "no Markdown" when the truth is
 * "we could not reach the server" sends the user looking for a job to run when
 * the problem is the network.
 */
function ArtifactPane({
  isLoading,
  error,
  onRetry,
  available,
  emptyDescription,
  toolbar,
  children,
}: {
  isLoading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  available: boolean;
  emptyDescription: string;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (error) {
    return <ErrorState error={error} onRetry={onRetry} compact />;
  }

  if (!available) {
    return (
      <EmptyState
        title="Nothing generated yet"
        description={emptyDescription}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="p-5">
        <SkeletonLines lines={12} />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      {toolbar ? (
        <div className="sticky top-0 z-10 flex items-center justify-end gap-2 border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur">
          {toolbar}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Ask — Split, run interactively.
 *
 * Split is the one operation that does not need a job: it reads artifacts that
 * already exist and ranks passages against a question, which is a request-sized
 * amount of work. So it is a search box rather than an upload, and the answer
 * is a list of citations rather than an artifact.
 *
 * Matches carry `chunk_id`, so clicking one drives the same selection the region
 * map uses — the retrieved passage and its rectangle are the same object.
 */
function SplitPane({
  documentId,
  onSelectMatch,
}: {
  documentId: string;
  onSelectMatch: (chunk: DocumentChunk) => void;
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ matches: SplitMatch[]; tookMs: number } | null>(null);

  const run = useCallback(async () => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setError('Ask a question — at least a few words.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await splitApi.query({ documentId, query: trimmed, limit: 8 });
      setResult({ matches: response.matches, tookMs: response.tookMs });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That search could not be run.');
    } finally {
      setBusy(false);
    }
  }, [documentId, query]);

  return (
    <div className="p-4">
      <Field
        label="What are you looking for?"
        hint="Shade ranks the passages that answer this and shows you where each one is."
        error={error}
      >
        {({ id, ...aria }) => (
          <div className="flex gap-2">
            <Input
              id={id}
              {...aria}
              value={query}
              disabled={busy}
              maxLength={400}
              placeholder="What are the payment terms?"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void run();
              }}
            />
            <Button
              variant="primary"
              size="md"
              disabled={busy}
              className="shrink-0"
              onClick={() => void run()}
            >
              {busy ? 'Searching…' : 'Search'}
            </Button>
          </div>
        )}
      </Field>

      {result ? (
        result.matches.length === 0 ? (
          <EmptyState
            className="mt-2"
            title="Nothing matched"
            description="No passage in this document scored against that question. Try different wording."
          />
        ) : (
          <>
            <p className="mt-4 font-mono text-[0.6875rem] text-ink-faint">
              {result.matches.length} {result.matches.length === 1 ? 'passage' : 'passages'} ·{' '}
              {result.tookMs} ms
            </p>

            <ul className="mt-2 space-y-2">
              {result.matches.map((match) => (
                <li key={match.chunk_id}>
                  <button
                    type="button"
                    onClick={() =>
                      onSelectMatch({
                        chunk_id: match.chunk_id,
                        text: match.text,
                        page_number: match.page_number,
                        bounding_box: match.bounding_box,
                        type: match.type,
                        confidence: match.score,
                      })
                    }
                    className={cn(
                      'block w-full rounded-[var(--radius-card)] border border-line bg-raised p-3 text-left',
                      'transition-colors duration-150 ease-[var(--ease-out-soft)]',
                      'hover:border-accent-line hover:bg-accent-soft',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[0.625rem] tabular-nums text-ink-faint">
                        p{match.page_number}
                      </span>
                      <span className="font-mono text-[0.625rem] tabular-nums text-accent-bright">
                        {match.score.toFixed(2)}
                      </span>
                      <span className="ml-auto text-[0.6875rem] text-ink-faint">
                        {match.rationale}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-3 text-[0.8125rem] leading-relaxed text-ink-muted">
                      {match.text}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )
      ) : (
        <p className="mt-6 text-center text-xs text-ink-faint">
          Split reads the artifacts this document already has — no job, no waiting.
        </p>
      )}
    </div>
  );
}
