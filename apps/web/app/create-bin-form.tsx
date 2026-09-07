'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CreateBinForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch('/api/bins', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() || undefined }),
    });

    setPending(false);
    if (!response.ok) {
      setError('Could not create the bin. Check that the API is running.');
      return;
    }

    const bin = (await response.json()) as { slug: string };
    router.push(`/bins/${bin.slug}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name this bin, for example Stripe test"
        className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {pending ? 'Creating' : 'Create bin'}
      </button>
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </form>
  );
}
