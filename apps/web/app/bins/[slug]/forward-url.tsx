'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ForwardUrl({ slug, current }: { slug: string; current: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const response = await fetch(`/api/bins/${slug}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ forwardUrl: value.trim() === '' ? null : value.trim() }),
    });

    if (!response.ok) {
      setError('Enter an http or https URL, or leave it empty to stop forwarding.');
      return;
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <label htmlFor="forward-url" className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Forward every request to
      </label>
      <div className="flex gap-2">
        <input
          id="forward-url"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="http://localhost:4000/webhooks"
          className="flex-1 rounded border border-slate-300 px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
        />
        <button type="submit" className="rounded border border-slate-300 px-3 py-2 text-xs font-medium dark:border-slate-700">
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </form>
  );
}
