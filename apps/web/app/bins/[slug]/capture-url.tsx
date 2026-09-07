'use client';

import { useState } from 'react';

export function CaptureUrl({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === 'undefined' ? `/i/${slug}` : `${window.location.origin}/i/${slug}`;

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 truncate rounded bg-slate-100 px-3 py-2 font-mono text-xs dark:bg-slate-900">
        {url}
      </code>
      <button
        onClick={copy}
        className="rounded border border-slate-300 px-3 py-2 text-xs font-medium dark:border-slate-700"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
