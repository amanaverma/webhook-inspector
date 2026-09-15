'use client';

import { useRouter } from 'next/navigation';

export function SignOut({ email }: { email: string }) {
  const router = useRouter();

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <span className="flex items-center gap-3 text-sm">
      <span className="text-slate-500">{email}</span>
      <button onClick={signOut} className="text-sm font-medium underline">
        Sign out
      </button>
    </span>
  );
}
