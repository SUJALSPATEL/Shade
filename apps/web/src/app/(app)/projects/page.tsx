'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ApiError, relativeTime, type Project } from '@shade/shared';
import { projects as projectsApi } from '@/lib/endpoints';
import { useResource } from '@/lib/hooks/use-resource';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { SkeletonLines } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/dashboard/page-header';

/**
 * Projects.
 *
 * A project is a folder with a name and a sentence about it — deliberately not
 * a workspace, a team, or a permission boundary. This milestone has one owner
 * per account, and inventing sharing semantics before there is anyone to share
 * with would be building the hard part of a feature whose easy part nobody has
 * asked for yet.
 *
 * What a project *is* for is the thing that makes a document list usable at
 * scale: "which of these forty PDFs were the vendor contracts" is a question a
 * flat list cannot answer.
 */
export default function ProjectsPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const list = useResource('projects:all', () => projectsApi.list({ limit: 100 }));

  const projects = list.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Projects"
        description="Group documents that belong together — a vendor, a deal, a batch."
        actions={
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            New project
          </Button>
        }
      />

      <div className="p-4 sm:p-6">
        {list.error && !list.data ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : list.isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <Card key={key} className="p-4">
                <SkeletonLines lines={3} />
              </Card>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <Card>
            <EmptyState
              title="No projects yet"
              description="A project keeps related documents in one place. You can also upload a document without one — it will still show up in History."
              action={
                <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                  Create a project
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </div>

      <CreateProjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(project) => {
          // The new project is prepended rather than triggering a refetch: the
          // create response *is* the row, and a round trip to learn what the
          // server just told us would be a request for the sake of symmetry.
          list.setData({
            data: [project, ...(list.data?.data ?? [])],
            nextCursor: list.data?.nextCursor ?? null,
          });
        }}
      />
    </>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const count = project.documentCount ?? 0;

  return (
    <Link href={`/projects/${project.id}`} className="group block">
      <Card interactive className="flex h-full flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 truncate text-[0.9375rem] font-semibold text-ink">
            {project.name}
          </h2>
          <span className="shrink-0 font-mono text-[0.6875rem] tabular-nums text-ink-faint">
            {count} {count === 1 ? 'doc' : 'docs'}
          </span>
        </div>

        <p className="mt-1.5 line-clamp-2 min-h-[2.5rem] text-[0.8125rem] leading-relaxed text-ink-muted">
          {project.summary ?? 'No description.'}
        </p>

        <p className="mt-4 font-mono text-[0.6875rem] text-ink-faint">
          {project.lastActivityAt
            ? `Last activity ${relativeTime(project.lastActivityAt)}`
            : `Created ${relativeTime(project.createdAt)}`}
        </p>
      </Card>
    </Link>
  );
}

function CreateProjectDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
}) {
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setName('');
    setSummary('');
    setError(null);
    setBusy(false);
  }, []);

  const submit = useCallback(async () => {
    if (name.trim() === '') {
      setError('Give the project a name.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const project = await projectsApi.create({
        name: name.trim(),
        ...(summary.trim() ? { summary: summary.trim() } : {}),
      });
      onCreated(project);
      reset();
      onClose();
    } catch (cause) {
      setBusy(false);
      setError(
        cause instanceof ApiError ? cause.message : 'That project could not be created.',
      );
    }
  }, [name, summary, onCreated, reset, onClose]);

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return;
        reset();
        onClose();
      }}
      title="New project"
      description="A name and, if you like, a line about what belongs in it."
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Creating…' : 'Create project'}
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
              autoFocus
              maxLength={80}
              disabled={busy}
              placeholder="Vendor contracts"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submit();
              }}
            />
          )}
        </Field>

        <Field label="Description" hint="Optional. Shown on the project card.">
          {({ id, ...aria }) => (
            <Textarea
              id={id}
              {...aria}
              rows={3}
              value={summary}
              maxLength={280}
              disabled={busy}
              placeholder="Master service agreements and their amendments, 2024 onwards."
              onChange={(event) => setSummary(event.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
