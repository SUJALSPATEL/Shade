import { AppShell } from '@/components/dashboard/app-shell';

/**
 * The authenticated application shell.
 *
 * A server component so every dashboard route inherits the frame without
 * repeating it, and so the individual pages below can stay focused on their own
 * data. The shell itself is client-side, because the answer to "is there a
 * session?" lives behind an `httpOnly` cookie that only the API can read — see
 * the note in `app-shell.tsx` for why the guard is not a middleware.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
