import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/auth-form';
import { SkeletonLines } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Create account',
  description: 'Create a Shade account to keep your documents and projects.',
};

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <SkeletonLines lines={2} widths={['w-2/3', 'w-full']} />
          <SkeletonLines lines={5} widths={['w-full', 'w-full', 'w-full', 'w-full', 'w-1/3']} />
        </div>
      }
    >
      <AuthForm mode="signup" />
    </Suspense>
  );
}
