import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Source_Serif_4 } from 'next/font/google';
import './globals.css';
import { SessionProvider } from '@/lib/hooks/use-session';

/**
 * The root layout.
 *
 * It does three things and deliberately no more: sets the document shell,
 * declares the metadata, and mounts the session provider.
 *
 * There is no theme provider and no theme toggle. The product is light by
 * construction — the subject is paper, and everything around it is the desk the
 * paper sits on — so a dark mode would not be a second theme, it would be a
 * second design. `color-scheme: light` is set in `globals.css` so form controls
 * and scrollbars follow.
 *
 * `SessionProvider` is mounted here rather than in the dashboard layout because
 * the anonymous workspace needs it too: the pre-auth Parse flow is metered by
 * the server, and the quota has to be visible before the user has an account.
 */

/**
 * The three faces, self-hosted.
 *
 * `next/font` downloads these at build time and serves them from our own origin,
 * which is what makes a webfont acceptable here at all: no request leaves for a
 * third-party font host at runtime, and the `size-adjust` metrics Next derives
 * mean the fallback stack occupies almost exactly the same space, so the page
 * does not reflow when the real face lands.
 *
 * Source Serif 4 carries the display headings. A document product with a serif
 * headline is not nostalgia, it is the correct register: the subject is text
 * that was typeset, and a serif at 56px reads as authored where a grotesque
 * reads as assembled. Both styles are requested because the emphasised half of
 * a headline is set in *italic* rather than in a heavier weight — a real italic
 * has different letterforms (a single-storey `a`, a descending `f`), which is
 * what makes it read as emphasis instead of as the same word leaning over.
 *
 * Inter for everything that is not code or a headline — it holds up at 12px in
 * a table cell, which is the range the interface actually lives in.
 *
 * JetBrains Mono for the things that are genuinely code: JSON, filenames, chunk
 * ids, bounding boxes. A monospace that reads as *data* rather than as a
 * terminal is worth the third file.
 */
const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-source-serif',
  style: ['normal', 'italic'],
  display: 'swap',
});

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
  themeColor: '#f5f7ec',
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sourceSerif.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-dvh antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
