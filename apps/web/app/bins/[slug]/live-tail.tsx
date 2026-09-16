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
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = 1_000;
    let done = false;

    const connect = () => {
      source = new EventSource(`/api/bins/${slug}/stream`);

      source.onopen = () => {
        setStatus('live');
        delay = 1_000;
      };

      source.onmessage = () => {
        setStatus('live');
        router.refresh();
      };

      source.onerror = () => {
        setStatus('offline');

        // A browser only retries by itself while the connection stays open. A
        // response that is not an event stream, which is what a restarting API
        // answers through the proxy, closes it for good, so reconnect here.
        if (done || source?.readyState !== EventSource.CLOSED) return;
        source.close();
        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      };
    };

    connect();

    return () => {
      done = true;
      clearTimeout(retry);
      source?.close();
    };
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
