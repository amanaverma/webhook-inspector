'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type Status = 'connecting' | 'live' | 'offline';

/**
 * Subscribes to the bin's event stream and refreshes the page when a request
 * arrives.
 *
 * Refreshing rather than appending keeps the server components authoritative,
 * so the list, the counter and the detail pane cannot drift apart.
 */
export function LiveTail({ slug }: { slug: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('connecting');

  useEffect(() => {
    const source = new EventSource(`/api/bins/${slug}/stream`);

    source.onopen = () => setStatus('live');
    source.onerror = () => setStatus('offline');
    source.onmessage = () => {
      setStatus('live');
      router.refresh();
    };

    return () => source.close();
  }, [slug, router]);

  const label = { connecting: 'Connecting', live: 'Live', offline: 'Reconnecting' }[status];
  const dot = {
    connecting: 'bg-slate-400',
    live: 'bg-emerald-500',
    offline: 'bg-amber-500',
  }[status];

  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}
