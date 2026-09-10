import Link from 'next/link';
import type { RequestSummary } from '@/lib/api';

const METHOD_COLOURS: Record<string, string> = {
  GET: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  POST: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  PUT: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  PATCH: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  DELETE: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function RequestList({
  slug,
  requests,
  selectedId,
}: {
  slug: string;
  requests: RequestSummary[];
  selectedId: string | null;
}) {
  if (requests.length === 0) {
    return (
      <p className="rounded border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700">
        Waiting for the first request. Send one to the URL above.
      </p>
    );
  }

  return (
    <ul className="flex max-h-[32rem] flex-col divide-y divide-slate-200 overflow-y-auto rounded border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
      {requests.map((request) => (
        <li key={request.id}>
          <Link
            href={`/bins/${slug}?request=${request.id}`}
            className={`flex flex-col gap-1 px-3 py-2 text-sm ${
              request.id === selectedId ? 'bg-slate-100 dark:bg-slate-900' : 'hover:bg-slate-50 dark:hover:bg-slate-900'
            }`}
          >
            <span className="flex items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${METHOD_COLOURS[request.method] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                {request.method}
              </span>
              <span className="truncate font-mono text-xs">{request.path}</span>
            </span>
            <span className="flex gap-2 text-xs text-slate-500">
              <time dateTime={request.receivedAt}>{new Date(request.receivedAt).toLocaleTimeString()}</time>
              <span>{formatSize(request.bodySize)}</span>
              {request.truncated ? <span className="text-amber-600">truncated</span> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
