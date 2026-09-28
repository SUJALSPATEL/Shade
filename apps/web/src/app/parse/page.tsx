import type { Metadata } from 'next';
import { ParseWorkspace } from '@/components/workspace/parse-workspace';

export const metadata: Metadata = {
  title: 'Parse a document',
  description:
    'Upload a PDF and get clean Markdown, structured JSON, and every detected region with its page and position.',
};

/**
 * The anonymous workspace.
 *
 * A server component whose only job is to be a route: everything below it is
 * client-side, because the session is a cookie the server cannot read from
 * here and the whole flow — upload, poll, render — happens in the browser.
 *
 * The page itself stays static. `ParseWorkspace` reads the session on mount, so
 * there is nothing to render conditionally on the server and no reason to give
 * up the prerender.
 */
export default function ParsePage() {
  return <ParseWorkspace />;
}
