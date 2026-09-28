import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/auth-form';
import { SkeletonLines } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your Shade workspace.',
};

/**
 * `AuthForm` reads `?next=` with `useSearchParams`, which opts the subtree out
 * of static rendering. Without a Suspense boundary above it, Next cannot
 * prerender the page at all and the whole route is forced dynamic — so the
 * fallback here is what keeps the sign-in page a static asset.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <AuthForm mode="login" />
    </Suspense>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-6">
      <SkeletonLines lines={2} widths={['w-2/3', 'w-full']} />
      <SkeletonLines lines={4} widths={['w-full', 'w-full', 'w-full', 'w-1/3']} />
    </div>
  );
}
