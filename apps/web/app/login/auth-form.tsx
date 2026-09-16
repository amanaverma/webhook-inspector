'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const MESSAGES: Record<string, string> = {
  email_taken: 'That email already has an account. Sign in instead.',
  invalid_credentials: 'That email and password do not match an account.',
  invalid_body: 'Enter a valid email and a password of at least 10 characters.',
  too_many_attempts: 'Too many attempts. Wait a minute, then try again.',
};

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    setPending(false);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(MESSAGES[body.error ?? ''] ?? 'Something went wrong. Try again.');
      return;
    }

    router.push('/');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mx-auto flex max-w-sm flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">
        {mode === 'signup' ? 'Create an account' : 'Sign in'}
      </h1>

      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          type="password"
          required
          minLength={10}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="rounded border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
        />
        <span className="text-xs text-slate-500">At least 10 characters.</span>
      </label>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {pending ? 'Working' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </button>

      <p className="text-sm text-slate-500">
        {mode === 'signup' ? (
          <>
            Already have an account? <Link href="/login" className="underline">Sign in</Link>
          </>
        ) : (
          <>
            No account yet? <Link href="/login?mode=signup" className="underline">Create one</Link>
          </>
        )}
      </p>
    </form>
  );
}
