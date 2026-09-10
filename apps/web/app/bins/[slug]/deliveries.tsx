'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Delivery } from '@/lib/api';

const STATE_STYLES: Record<Delivery['state'], string> = {
  sent: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  failed: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  dead: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  sending: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
};

export function Deliveries({ requestId, deliveries }: { requestId: string; deliveries: Delivery[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function replay() {
    const response = await fetch(`/api/requests/${requestId}/replay`, { method: 'POST' });
    if (!response.ok) {
      setError(
        response.status === 409
          ? 'Set a forward URL for this bin before replaying.'
          : 'Could not queue the replay.',
      );
      return;
    }
    setError(null);
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center justify-between text-sm font-semibold uppercase tracking-wide text-slate-500">
        Deliveries
        <button onClick={replay} className="rounded border border-slate-300 px-2 py-1 text-xs font-medium normal-case dark:border-slate-700">
          Replay
        </button>
      </h2>

      {error ? <p className="text-xs text-rose-600">{error}</p> : null}

      {deliveries.length === 0 ? (
        <p className="text-sm text-slate-500">Not forwarded. This bin has no forward URL.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-200 rounded border border-slate-200 text-xs dark:divide-slate-800 dark:border-slate-800">
          {deliveries.map((delivery) => (
            <li key={delivery.id} className="flex items-center gap-3 px-3 py-2">
              <span className="text-slate-500">#{delivery.attempt}</span>
              <span className={`rounded px-1.5 py-0.5 font-medium ${STATE_STYLES[delivery.state]}`}>
                {delivery.state}
              </span>
              <span className="font-mono">
                {delivery.responseStatus ?? delivery.error?.split(':')[0] ?? 'waiting'}
              </span>
              {delivery.durationMs !== null ? <span className="text-slate-500">{delivery.durationMs} ms</span> : null}
              {delivery.state === 'failed' ? (
                <span className="text-slate-500">retry at {new Date(delivery.nextAttemptAt).toLocaleTimeString()}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
