import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
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

/**
 * The two faces, self-hosted.
 *
 * `next/font` downloads these at build time and serves them from our own origin,
 * which is what makes a webfont acceptable here at all: no request leaves for a
 * third-party font host at runtime, and the `size-adjust` metrics Next derives
 * mean the fallback stack occupies almost exactly the same space, so the page
 * does not reflow when the real face lands.
 *
 * Inter for everything that is not code — it holds up at 12px in a table cell
 * and at 56px in a headline, which is the full range this product needs.
 * JetBrains Mono for the things that are genuinely code: JSON, filenames,
 * chunk ids, bounding boxes. A monospace that reads as *data* rather than as a
 * terminal is worth the second file.
 */
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Shade — Agentic Document Extraction',
    template: '%s · Shade',
  },
  description:
    'Shade turns complex documents into structured, agent-ready representations — clean Markdown, typed JSON, and the detected regions behind both.',
  applicationName: 'Shade',
  keywords: [
    'document extraction',
    'PDF to Markdown',
    'document intelligence',
    'structured extraction',
    'agent-ready documents',
  ],
  openGraph: {
    title: 'Shade — Agentic Document Extraction',
    description:
      'Parse, Extract and Split complex documents into clean Markdown, typed JSON and the regions behind both.',
    siteName: 'Shade',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#07070c',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-dvh antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
