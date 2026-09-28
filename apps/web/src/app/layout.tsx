import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SessionProvider } from '@/lib/hooks/use-session';

/**
 * The root layout.
 *
 * It does three things and deliberately no more: sets the document shell,
 * declares the metadata, and mounts the session provider.
 *
 * There is no theme provider and no theme toggle. The product is dark by
 * construction — the paper metaphor only works if the page is the light thing
 * and the machinery around it is not — so a light mode would not be a second
 * theme, it would be a second design. `color-scheme: dark` is set in
 * `globals.css` so form controls and scrollbars follow.
 *
 * `SessionProvider` is mounted here rather than in the dashboard layout because
 * the anonymous workspace needs it too: the pre-auth Parse flow is metered by
 * the server, and the quota has to be visible before the user has an account.
 */

export const metadata: Metadata = {
  title: {
    default: 'Shade — Agentic Document Extraction',
    template: '%s · Shade',
  },
  description:
    'Shade turns complex documents into structured, agent-ready representations — clean Markdown, typed JSON, and the detected regions behind both.',
  applicationName: 'Shade',
  // The product's own output is text; there is nothing here worth a social card
  // until there is a real brand asset to put on one.
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0a0a0e',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
