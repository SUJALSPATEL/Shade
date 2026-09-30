'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError } from '@shade/shared';
import { auth } from '@/lib/endpoints';
import { useSession } from '@/lib/hooks/use-session';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

/**
 * Sign in / create account.
 *
 * One component for both, because the two forms differ by one field and the
 * surrounding copy — and because an error on sign-up ("that email is already
 * registered") is most useful with a link that switches to sign-in, which is
 * trivial when both live in the same place and awkward when they do not.
 *
 * Validation is client-side first and server-side always. The client rules here
 * mirror `signUpRequestSchema` so the user is not made to wait for a round trip
 * to learn their password is too short; the server re-checks everything,
 * because a client-side rule is a convenience and never a control.
 */

export type AuthMode = 'login' | 'signup';

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, status, adopt } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // `next` is where the user was headed when they hit the auth wall. It is
  // validated below rather than trusted: an open redirect is a real bug, and
  // `?next=https://evil.example` costs nothing to type.
  const next = safeRedirect(searchParams.get('next'));

  // Someone who already has a session should not be looking at a sign-in form.
  // This runs on the client because the cookie is httpOnly — the server
  // rendering this page cannot know.
  const redirected = useRef(false);
  useEffect(() => {
    if (status !== 'ready' || !isAuthenticated || redirected.current) return;
    redirected.current = true;
    router.replace(next);
  }, [status, isAuthenticated, next, router]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const problems: Record<string, string> = {};
    if (!email.includes('@')) problems.email = 'Enter a valid email address.';
    if (mode === 'signup' && password.length < 10) {
      problems.password = 'Use at least 10 characters.';
    } else if (mode === 'login' && password.length === 0) {
      problems.password = 'Enter your password.';
    }
    if (mode === 'signup' && name.trim().length === 0) problems.name = 'Enter your name.';

    setFieldErrors(problems);
    setFormError(null);
    if (Object.keys(problems).length > 0) return;

    setSubmitting(true);
    try {
      const session =
        mode === 'signup'
          ? await auth.register({ email, password, name: name.trim() })
          : await auth.login({ email, password });

      // Adopt before navigating: the dashboard's first render reads the session
      // from context, and without this it would briefly render the anonymous
      // state — including the quota banner the new account does not have.
      adopt(session);

      // A sign-up claims any documents uploaded anonymously in this browser.
      // The count is carried in the URL rather than in a store, so the
      // destination can say "we moved 2 documents into your workspace" — which
      // is the difference between a user believing their uploads survived and
      // believing they were lost.
      const claimed = mode === 'signup' ? (session.claimedDocumentCount ?? 0) : 0;

      router.replace(claimed > 0 ? `${next}?claimed=${claimed}` : next);
    } catch (cause) {
      const error = cause instanceof ApiError ? cause : null;
      if (error?.details) setFieldErrors(error.details);
      setFormError(error?.message ?? 'Something went wrong. Try again.');
      setSubmitting(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-xl font-semibold tracking-[-0.02em] text-ink">
        {isSignup ? 'Create your account' : 'Sign in to Shade'}
      </h1>
      <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-muted">
        {isSignup
          ? 'Documents you uploaded in this browser move into your account.'
          : 'Welcome back. Your projects and documents are where you left them.'}
      </p>

      <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
        {isSignup ? (
          <Field label="Name" error={fieldErrors.name} required>
            {(props) => (
              <Input
                {...props}
                name="name"
                autoComplete="name"
                placeholder="Ada Lovelace"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
        ) : null}

        <Field label="Email" error={fieldErrors.email} required>
          {(props) => (
            <Input
              {...props}
              name="email"
              type="email"
              autoComplete="email"
              // `inputMode` keeps mobile keyboards from capitalising the first
              // letter of an address, which is the single most common
              // self-inflicted sign-in failure.
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          )}
        </Field>

        <Field
          label="Password"
          error={fieldErrors.password}
          hint={isSignup ? 'At least 10 characters.' : undefined}
          required
        >
          {(props) => (
            <Input
              {...props}
              name="password"
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              placeholder={isSignup ? 'At least 10 characters' : '••••••••••'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>

        {formError ? (
          <div
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-[0.8125rem] leading-relaxed text-danger"
          >
            {formError}
            {formError.toLowerCase().includes('already exists') ? (
              <>
                {' '}
                <Link href="/login" className="underline underline-offset-2">
                  Sign in instead
                </Link>
                .
              </>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          {isSignup ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-6 text-center text-[0.8125rem] text-ink-muted">
        {isSignup ? 'Already have an account? ' : 'No account yet? '}
        <Link
          href={isSignup ? '/login' : '/signup'}
          className="text-accent-bright underline underline-offset-4 decoration-accent-line hover:decoration-accent-bright"
        >
          {isSignup ? 'Sign in' : 'Create one'}
        </Link>
      </p>

      <div className={cn('mt-8 border-t border-line pt-6 text-center')}>
        <Link href="/parse" className="text-xs text-ink-faint hover:text-ink-muted">
          Or keep going without an account →
        </Link>
      </div>
    </div>
  );
}

/**
 * Only same-origin paths are honoured.
 *
 * Rejecting anything else — rather than sanitising it — is the right default
 * here: `next` is always a path this app produced, so a value that is not one
 * means the link was tampered with, and falling back to the dashboard is both
 * safe and what the user wanted anyway.
 */
function safeRedirect(value: string | null): string {
  if (!value) return '/dashboard';
  if (!value.startsWith('/')) return '/dashboard';
  // `//evil.example` is a protocol-relative URL and would leave the origin.
  if (value.startsWith('//')) return '/dashboard';
  return value;
}
