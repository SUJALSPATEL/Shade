'use client';

import { use, useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, formatBytes, relativeTime } from '@shade/shared';
import { projects as projectsApi } from '@/lib/endpoints';
import { useResource } from '@/lib/hooks/use-resource';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Menu } from '@/components/ui/menu';
import { Field, Input, Textarea } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/states';
import { SkeletonLines } from '@/components/ui/skeleton';
import { PageHeader, StatCard } from '@/components/dashboard/page-header';
import { DocumentList } from '@/components/dashboard/document-list';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { NewDocumentDialog } from '@/components/dashboard/new-document-dialog';

/**
 * One project.
 *
 * The document list comes from `GET /api/projects/:projectId`, which returns
 * the project, its documents, its recent activity and its stats together. That
 * is one endpoint rather than four because all four are scoped to the same
 * project and rendered on the same screen — four requests here would be four
 * chances to show a page that is half one project and half another.
 *
 * `params` is unwrapped with `use()` rather than received as a prop because in
 * Next 15 a client component's `params` is a promise. Awaiting it inside the
 * component body would suspend before the first paint in a way that hides the
 * loading state; `use()` lets the rest of the component render.
 */
export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();

  const [newOpen, setNewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const resource = useResource(`project:${projectId}`, () =>
    projectsApi.get(projectId),
  );

  const remove = useCallback(async () => {
    try {
      await projectsApi.remove(projectId);
      // Back to the list rather than staying on a page for a project that no
      // longer exists — and `replace`, so Back does not return to the 404.
      router.replace('/projects');
    } catch (cause) {
      // A failed delete leaves the user where they are; the page still exists
      // and a reload will show the truth. Surfacing it as a page-level error
      // would throw away the project they are still looking at.
      window.alert(
        cause instanceof ApiError ? cause.message : 'That project could not be deleted.',
      );
    }
  }, [projectId, router]);

  if (resource.error && !resource.data) {
    return (
      <>
        <PageHeader
          title="Project"
          breadcrumb={<BackLink />}
        />
        <ErrorState
          error={resource.error}
          onRetry={resource.reload}
        />
      </>
    );
  }

  if (resource.isLoading || !resource.data) {
    return (
      <>
        <PageHeader title="Project" breadcrumb={<BackLink />} />
        <div className="space-y-6 p-4 sm:p-6">
          <SkeletonLines lines={2} className="max-w-lg" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((key) => (
              <div key={key} className="h-24 rounded-[var(--radius-card)] border border-line bg-surface" />
            ))}
          </div>
          <div className="h-72 rounded-[var(--radius-card)] border border-line bg-surface" />
        </div>
      </>
    );
  }

  const { project, documents, activity, stats } = resource.data;

  return (
    <>
      <PageHeader
        breadcrumb={<BackLink />}
        title={project.name}
        description={project.summary ?? 'No description yet.'}
        actions={
          <>
            <Menu
              label="Project actions"
              items={[
                { label: 'Edit details', onSelect: () => setEditOpen(true) },
                'separator',
                {
                  label: 'Delete project',
                  tone: 'danger',
                  onSelect: () => {
                    if (
                      window.confirm(
                        `Delete "${project.name}"? Its documents are kept — they just stop belonging to a project.`,
                      )
                    ) {
                      void remove();
                    }
                  },
                },
              ]}
              trigger={
                <span className="flex size-8 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-raised hover:text-ink">
                  <svg className="size-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path
                      d="M5 10h.01M10 10h.01M15 10h.01"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              }
            />
            <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
              Add document
            </Button>
          </>
        }
      />

      <div className="space-y-6 p-4 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Documents" value={stats.documentCount} />
          <StatCard label="Parsed" value={stats.parsedCount} tone="accent" />
          <StatCard
            label="Stored output"
            value={formatBytes(stats.artifactsBytes)}
            hint="Markdown, JSON and assets"
          />
          <StatCard
            label="Last activity"
            value={
              stats.lastActivityAt ? (
                <span className="text-base">{relativeTime(stats.lastActivityAt)}</span>
              ) : (
                '—'
              )
            }
          />
        </div>

        <Card>
          <CardHeader
            title="Documents"
            description={`${stats.documentCount} in this project.`}
          />
          <DocumentList
            documents={documents}
            emptyTitle="Nothing in this project yet"
            emptyDescription="Upload a PDF and it will be filed here instead of going to the general list."
            emptyAction={
              <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
                Add a document
              </Button>
            }
          />
        </Card>

        <Card>
          <CardHeader title="Activity" description="What has happened in this project." />
          <ActivityFeed
            activity={activity}
            emptyTitle="No activity yet"
            emptyDescription="Jobs run on this project's documents will show up here."
          />
        </Card>
      </div>

      <NewDocumentDialog
        open={newOpen}
        projectId={projectId}
        onClose={() => setNewOpen(false)}
      />

      <EditProjectDialog
        open={editOpen}
        projectId={projectId}
        initialName={project.name}
        initialSummary={project.summary ?? ''}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          resource.reload();
        }}
      />
    </>
  );
}

function BackLink() {
  return (
    <Link
      href="/projects"
      className="inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-muted transition-colors hover:text-ink"
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
      Projects
    </Link>
  );
}

function EditProjectDialog({
  open,
  projectId,
  initialName,
  initialSummary,
  onClose,
  onSaved,
}: {
  open: boolean;
  projectId: string;
  initialName: string;
  initialSummary: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [summary, setSummary] = useState(initialSummary);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (name.trim() === '') {
      setError('A project needs a name.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await projectsApi.update(projectId, {
        name: name.trim(),
        // An emptied description is sent as `null`, not `''` — the column is
        // nullable and "no description" is a different thing from "a
        // description that happens to be blank".
        summary: summary.trim() === '' ? null : summary.trim(),
      });
      setBusy(false);
      onSaved();
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof ApiError ? cause.message : 'Those changes could not be saved.');
    }
  }, [name, summary, projectId, onSaved]);

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      title="Edit project"
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required error={error}>
          {({ id, ...aria }) => (
            <Input
              id={id}
              {...aria}
              value={name}
              maxLength={80}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>

        <Field label="Description" hint="Leave empty to remove the description.">
          {({ id, ...aria }) => (
            <Textarea
              id={id}
              {...aria}
              rows={3}
              value={summary}
              maxLength={280}
              disabled={busy}
              onChange={(event) => setSummary(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
