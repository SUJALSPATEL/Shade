'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  documents as documentsApi,
  history as historyApi,
  projects as projectsApi,
} from '@/lib/endpoints';
import { useResource } from '@/lib/hooks/use-resource';
import { useSession } from '@/lib/hooks/use-session';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/states';
import { PageHeader, StatCard } from '@/components/dashboard/page-header';
import { DocumentList } from '@/components/dashboard/document-list';
import { ActivityFeed } from '@/components/dashboard/activity-feed';
import { NewDocumentDialog } from '@/components/dashboard/new-document-dialog';

/**
 * The dashboard.
 *
 * Its job is to answer three questions in the order a returning user asks them:
 * what do I have, what did I just do, and what should I do next. Hence the
 * stats, then the two most recent things, then the primary action sitting in
 * the header where it is reachable from anywhere on the page.
 *
 * Four requests on mount, and they are genuinely four different resources —
 * documents, projects, the history summary, the activity feed. They are issued
 * in parallel by four `useResource` calls rather than composed into one
 * endpoint, because a dashboard that cannot render its document list until its
 * activity feed responds would be coupling two unrelated reads for the sake of
 * one round trip.
 */
export default function DashboardPage() {
  const { session } = useSession();
  const [newOpen, setNewOpen] = useState(false);

  /**
   * One documents call, not two.
   *
   * The page needs both a count and a preview, and they come from the same
   * endpoint — asking twice would be two requests that can disagree. The list
   * is capped at 100 and `nextCursor` is what tells the stat card whether that
   * cap was hit, so the number is never presented as a total it might not be.
   */
  const documents = useResource('documents:dashboard', () =>
    documentsApi.list({ limit: 100 }),
  );
  const projects = useResource('projects:count', () => projectsApi.list({ limit: 100 }));
  const summary = useResource('history:summary', () => historyApi.summary());
  const activity = useResource('history:recent', () => historyApi.list({ limit: 8 }));

  const all = useMemo(() => documents.data?.data ?? [], [documents.data]);
  const truncated = documents.data?.nextCursor != null;

  const totals = useMemo(() => {
    const counts = summary.data?.counts ?? {};
    return {
      documents: all.length,
      projects: projects.data?.data.length ?? 0,
      parsed: counts.DOCUMENT_PARSED ?? 0,
      failed: counts.JOB_FAILED ?? 0,
    };
  }, [all, projects.data, summary.data]);

  // A failed documents fetch would otherwise render as "no documents yet",
  // which reads as a fact about the account rather than about the request.
  if (documents.error && !documents.data) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <ErrorState error={documents.error} onRetry={documents.reload} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={greeting(session?.user?.name ?? null)}
        description="Documents, extractions and splits across your workspace."
        actions={
          <>
            <Link href="/projects">
              <Button variant="secondary" size="sm">
                Projects
              </Button>
            </Link>
            <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
              New document
            </Button>
          </>
        }
      />

      <div className="space-y-6 p-4 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Documents"
            value={truncated ? `${totals.documents}+` : totals.documents}
            hint={truncated ? 'More than the first 100' : 'In your workspace'}
          />
          <StatCard label="Projects" value={totals.projects} hint="Groups of documents" />
          <StatCard label="Parse runs" value={totals.parsed} tone="accent" hint="Completed" />
          <StatCard
            label="Failed jobs"
            value={totals.failed}
            tone={totals.failed > 0 ? 'danger' : 'default'}
            hint={totals.failed > 0 ? 'Worth a look in History' : 'None'}
          />
        </div>

        <Card>
          <CardHeader
            title="Recent documents"
            description="The last six you added."
            action={
              <Link href="/history">
                <Button variant="ghost" size="sm">
                  View all
                </Button>
              </Link>
            }
          />
          <DocumentList
            documents={all.slice(0, 6)}
            isLoading={documents.isLoading}
            emptyAction={
              <Button variant="primary" size="sm" onClick={() => setNewOpen(true)}>
                Upload a PDF
              </Button>
            }
          />
        </Card>

        <Card>
          <CardHeader
            title="Activity"
            description="Everything Shade has done, newest first."
            action={
              <Link href="/history">
                <Button variant="ghost" size="sm">
                  Full history
                </Button>
              </Link>
            }
          />
          <ActivityFeed
            activity={activity.data?.data ?? []}
            isLoading={activity.isLoading}
            emptyTitle="No activity yet"
            emptyDescription="Upload a document and every job Shade runs on it lands here."
          />
        </Card>
      </div>

      <NewDocumentDialog open={newOpen} onClose={() => setNewOpen(false)} />
    </>
  );
}

/**
 * Time-aware greeting.
 *
 * A small thing that makes a dashboard feel like it knows you are there, and
 * the one piece of copy on this page that a user will notice changing between
 * visits. Rendered on the client only, because the server has no idea what time
 * it is where the reader is — a server-rendered "Good morning" is wrong for
 * half the planet.
 */
function greeting(name: string | null): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  // Only the first name: "Good morning, Ada Lovelace" is a form letter.
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}
