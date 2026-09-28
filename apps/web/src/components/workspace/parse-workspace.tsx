'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ApiError, formatPageCount, type DocumentChunk, type ParseResult } from '@shade/shared';
import { documents, jobs as jobsApi } from '@/lib/endpoints';
import { useSession } from '@/lib/hooks/use-session';
import { useJobPoll } from '@/lib/hooks/use-job-poll';
import { useResource } from '@/lib/hooks/use-resource';
import { uploadAndProcess, type UploadProgress } from '@/lib/upload';
import { Button } from '@/components/ui/button';
import { JobStatusBadge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/states';
import { UploadDropzone } from './upload-dropzone';
import { ProcessingPanel, type ProcessingFailure } from './processing-panel';
import { DocumentViewer, type ViewerMode } from './document-viewer';
import { ResultPanel, ResultMeta, type ResultTab } from './result-panel';

/**
 * The anonymous Parse workspace.
 *
 * The whole point of this screen is that it works before the user has an
 * account. That constraint shapes everything here: the "who are you" question
 * is answered by a server-issued anonymous session, the quota is enforced by
 * the API rather than by a flag in `localStorage`, and the sign-up prompt
 * appears only once there is something worth keeping.
 *
 * The state machine is deliberately linear — pick a file, upload it, poll the
 * job, show the result — because that is genuinely what happens. The one
 * non-obvious part is that the upload progress and the job progress are two
 * different measurements displayed by one panel: the first is bytes leaving the
 * browser, the second is a real percentage from the worker, and there is a
 * brief, honest, indeterminate gap between them.
 */

type Phase = 'idle' | 'working' | 'done';

export function ParseWorkspace() {
  const { session, isAnonymous, status: sessionStatus } = useSession();

  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [failure, setFailure] = useState<ProcessingFailure>(null);

  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState(1);
  const [viewerMode, setViewerMode] = useState<ViewerMode>('document');
  const [tab, setTab] = useState<ResultTab>('regions');

  const abort = useRef<AbortController | null>(null);

  const poll = useJobPoll(jobId);

  // The document record is fetched once the job is done, so the viewer knows
  // the page count. Keyed on `none` until then so the hook has a stable key
  // that does not fire a request for a document that does not exist yet.
  const document = useResource(
    phase === 'done' && documentId ? `document:${documentId}` : 'document:none',
    (signal) => (documentId ? documents.get(documentId, signal) : Promise.resolve(null)),
  );
  /* ── Upload ─────────────────────────────────────────────────────────────── */

  const start = useCallback(
    async (next: File) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      setFile(next);
      setFailure(null);
      setUpload({ phase: 'preparing', fraction: 0 });
      setPhase('working');
      setDocumentId(null);
      setJobId(null);

      try {
        const outcome = await uploadAndProcess({
          file: next,
          operation: 'PARSE',
          parseInput: { extractImages: true, keepFurniture: false },
          signal: controller.signal,
          onProgress: setUpload,
        });

        setDocumentId(outcome.document.id);
        // A document is created with a job in the same request, so a null job
        // here would mean the API accepted the upload and enqueued nothing —
        // which is a bug worth showing rather than a state to sit in.
        if (outcome.job) {
          setJobId(outcome.job.id);
        } else {
          setFailure({
            message: 'The document was saved but no processing job was created.',
            retryable: false,
          });
        }
        setUpload(null);
      } catch (cause) {
        if (controller.signal.aborted) return;

        setUpload(null);
        const error = cause instanceof ApiError ? cause : null;
        setFailure({
          message:
            error?.message ??
            (cause instanceof Error ? cause.message : 'The upload could not be completed.'),
          // A quota rejection is not retryable — trying again hits the same
          // wall. Signing up is the fix, and the UI says so separately.
          retryable: error ? error.retryable : true,
        });
      }
    },
    [],
  );

  const reset = useCallback(() => {
    abort.current?.abort();
    setPhase('idle');
    setFile(null);
    setUpload(null);
    setDocumentId(null);
    setJobId(null);
    setFailure(null);
    setSelectedChunkId(null);
    setActivePage(1);
    setViewerMode('document');
    setTab('regions');
  }, []);

  /* ── Job outcome ────────────────────────────────────────────────────────── */

  useEffect(() => {
    const job = poll.job;
    if (!job) return;

    if (job.status === 'FAILED') {
      setFailure({
        message: job.error?.message ?? 'Processing failed.',
        retryable: job.error?.retryable ?? false,
        stage: job.stage,
      });
      return;
    }

    // Polling has no way to be cancelled from here — the hook owns its loop —
    // so the phase change is what stops the UI from reading a stale failure.
    if (job.status === 'COMPLETED') {
      setFailure(null);
      setPhase('done');
    }
  }, [poll.job]);

  useEffect(() => {
    if (poll.error) {
      setFailure({ message: poll.error.message, retryable: poll.error.retryable });
    }
  }, [poll.error]);

  /**
   * Re-runs the job against the document that is already uploaded.
   *
   * A fresh upload would be the easy retry and the wrong one: the bytes are
   * already in storage and the document row already exists, so re-sending them
   * costs the user their bandwidth and the quota a second slot. A new job
   * against the same document is what "try again" actually means here.
   */
  const retryJob = useCallback(async () => {
    if (!documentId) {
      reset();
      return;
    }

    setFailure(null);
    setUpload(null);

    try {
      const created = await jobsApi.create({
        documentId,
        operation: 'PARSE',
        parseInput: { extractImages: true, keepFurniture: false },
      });
      // A new id is what restarts the poll loop — the hook re-runs on the id,
      // and the old job is terminal so it would never poll again.
      setJobId(created.job.id);
      setPhase('working');
    } catch (cause) {
      const error = cause instanceof ApiError ? cause : null;
      setFailure({
        message: error?.message ?? 'That job could not be restarted.',
        retryable: error?.retryable ?? false,
      });
    }
  }, [documentId, reset]);

  const result = poll.result as ParseResult | null;
  const chunks: DocumentChunk[] = useMemo(() => result?.chunks ?? [], [result]);
  const pages = useMemo(
    () =>
      document.data?.document.pageCount
        ? buildPages(document.data.document.pageCount)
        : buildPages(1),
    [document.data],
  );

  const chunksOnPage = useMemo(
    () => chunks.filter((chunk) => chunk.page_number === activePage),
    [chunks, activePage],
  );

  /* ── Selection ──────────────────────────────────────────────────────────── */

  const selectChunk = useCallback(
    (chunk: DocumentChunk) => {
      setSelectedChunkId(chunk.chunk_id);
      setActivePage(chunk.page_number);
      // Selecting a region is a request to see where it is, so the pane that
      // can show that becomes the pane that is showing.
      setViewerMode('regions');
    },
    [],
  );

  // Clicking a box in the page map should also reveal its row in the list.
  const selectFromMap = useCallback((chunk: DocumentChunk) => {
    setSelectedChunkId(chunk.chunk_id);
    setTab('regions');
  }, []);

  const quotaExhausted =
    failure !== null && failure.message.toLowerCase().includes('free account');

  return (
    <div className="flex min-h-dvh flex-col">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-[110rem] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="shrink-0 rounded-lg" aria-label="Shade home">
            <span className="flex items-center gap-2">
              <LogoMarkSmall />
              <span className="text-sm font-semibold tracking-[-0.02em] text-ink">Shade</span>
            </span>
          </Link>

          <span className="hidden font-mono text-[0.6875rem] text-ink-faint sm:inline">
            / parse
          </span>

          <div className="ml-auto flex items-center gap-2">
            {isAnonymous && session?.jobsRemaining !== null && session?.jobsRemaining !== undefined ? (
              <span className="hidden font-mono text-[0.6875rem] text-ink-faint sm:inline">
                {session.jobsRemaining} anonymous{' '}
                {session.jobsRemaining === 1 ? 'document' : 'documents'} left
              </span>
            ) : null}

            {isAnonymous ? (
              <>
                <Link href="/login?next=/parse">
                  <Button variant="ghost" size="sm">
                    Sign in
                  </Button>
                </Link>
                <Link href="/signup?next=/dashboard">
                  <Button variant="primary" size="sm">
                    Create account
                  </Button>
                </Link>
              </>
            ) : (
              <Link href="/dashboard">
                <Button variant="secondary" size="sm">
                  Dashboard
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <main className="flex min-h-0 flex-1 flex-col">
        {phase === 'idle' ? (
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-5 py-16">
            <div className="text-center">
              <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
                Parse a document
              </h1>
              <p className="mx-auto mt-3 max-w-md text-pretty text-[0.9375rem] leading-relaxed text-ink-muted">
                Drop in a PDF. Shade returns clean Markdown, structured JSON, and every detected
                region with its page and position.
              </p>
            </div>

            <UploadDropzone className="mt-8" onFile={(next) => void start(next)} />

            {failure ? (
              <div
                role="alert"
                className="mt-5 rounded-[var(--radius-card)] border border-[#ef5f6840] bg-danger-soft px-4 py-3.5 text-center"
              >
                <p className="text-[0.8125rem] text-danger">{failure.message}</p>
                {quotaExhausted ? (
                  <Link href="/signup?next=/dashboard" className="mt-3 inline-block">
                    <Button variant="primary" size="sm">
                      Create a free account
                    </Button>
                  </Link>
                ) : null}
              </div>
            ) : null}

            <p className="mt-6 text-center text-xs text-ink-faint">
              {sessionStatus === 'loading'
                ? 'Checking your session…'
                : 'Your first document does not need an account.'}
            </p>
          </div>
        ) : null}

        {phase === 'working' ? (
          <div className="flex flex-1 items-center justify-center px-5 py-16">
            <ProcessingPanel
              filename={file?.name ?? 'document.pdf'}
              sizeBytes={file?.size ?? 0}
              operation="PARSE"
              upload={upload}
              job={poll.job}
              failure={failure}
              onRetry={retryJob}
              onCancel={reset}
            />
          </div>
        ) : null}

        {phase === 'done' && result ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* ── Result header ──────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold text-ink">
                  {result.document.filename}
                </h1>
                <p className="mt-0.5 flex items-center gap-2 font-mono text-[0.6875rem] text-ink-faint">
                  <span>{formatPageCount(result.document.pageCount)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{chunks.length} regions</span>
                  <span aria-hidden="true">·</span>
                  <span>{result.assets.length} assets</span>
                </p>
              </div>

              <JobStatusBadge status={poll.job?.status ?? 'COMPLETED'} />

              <div className="ml-auto flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={reset}>
                  New document
                </Button>
              </div>
            </div>

            {/* ── Keep-it prompt ─────────────────────────────────────────── */}
            {isAnonymous ? (
              <div className="flex flex-wrap items-center gap-3 border-b border-line bg-accent-soft px-4 py-2.5 sm:px-6">
                <p className="text-[0.8125rem] text-ink-muted">
                  This document lives in your browser session. Create an account to keep it — your
                  uploads move across automatically.
                </p>
                <Link href="/signup?next=/dashboard" className="ml-auto shrink-0">
                  <Button variant="primary" size="sm">
                    Save it
                  </Button>
                </Link>
              </div>
            ) : null}

            <div className="px-4 pt-4 sm:px-6">
              <ResultMeta result={result} />
            </div>

            {/* ── Two panes ──────────────────────────────────────────────── */}
            <div className="grid min-h-0 flex-1 gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
              <div className="flex min-h-[36rem] flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface lg:min-h-0">
                <DocumentViewer
                  documentId={documentId ?? ''}
                  filename={result.document.filename}
                  chunks={chunksOnPage}
                  pages={pages}
                  mode={viewerMode}
                  onModeChange={setViewerMode}
                  activePage={activePage}
                  onPageChange={(page) => {
                    setActivePage(page);
                    setSelectedChunkId(null);
                  }}
                  selectedChunkId={selectedChunkId}
                  onSelectChunk={selectFromMap}
                  className="min-h-0 flex-1"
                />
              </div>

              <div className="flex min-h-[36rem] flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface lg:min-h-0">
                <ResultPanel
                  documentId={documentId ?? ''}
                  filename={result.document.filename}
                  result={result}
                  selectedChunkId={selectedChunkId}
                  onSelectChunk={selectChunk}
                  tab={tab}
                  onTabChange={setTab}
                  className="min-h-0 flex-1"
                />
              </div>
            </div>
          </div>
        ) : null}

        {/* A completed job whose result never arrived would otherwise render an
            empty screen with no explanation. */}
        {phase === 'done' && !result ? (
          <div className="flex flex-1 items-center justify-center">
            <ErrorState
              error={null}
              onRetry={reset}
              compact={false}
            />
          </div>
        ) : null}
      </main>
    </div>
  );
}

/**
 * Page geometry.
 *
 * The processor reports per-page dimensions in the chunks artifact, and the
 * API returns them from `GET /chunks`. This screen does not call that endpoint
 * — the job response already carries every chunk, and a second request for the
 * same page box would be a round trip to learn a constant. A4 in PDF points is
 * what the fixture engine emits and what the API's own fallback uses; when a
 * real engine reports per-page sizes, the workspace switches to `GET /chunks`
 * and this function goes away.
 */
function buildPages(pageCount: number): Array<{ pageNumber: number; width: number; height: number }> {
  return Array.from({ length: Math.max(pageCount, 1) }, (_, index) => ({
    pageNumber: index + 1,
    width: 595,
    height: 842,
  }));
}

function LogoMarkSmall() {
  return (
    <svg width={20} height={20} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <rect x="11" y="9" width="16" height="19" rx="3.5" fill="#4c3a9e" />
      <rect x="5" y="4" width="16" height="19" rx="3.5" fill="#ffffff" />
      <rect x="8" y="9" width="10" height="1.6" rx="0.8" fill="#6e56cf" />
      <rect x="8" y="13" width="8" height="1.6" rx="0.8" fill="#b9b9c8" />
      <rect x="8" y="17" width="9.5" height="1.6" rx="0.8" fill="#b9b9c8" />
    </svg>
  );
}
