import type { RequestDetail } from '@/lib/api';

/** Pretty prints JSON, and returns the input unchanged when it does not parse. */
function formatBody(request: RequestDetail): string {
  if (request.bodyEncoding === 'base64') return request.body;
  if (!request.contentType?.includes('json')) return request.body;

  try {
    return JSON.stringify(JSON.parse(request.body), null, 2);
  } catch {
    return request.body;
  }
}

export function RequestDetailPane({ request }: { request: RequestDetail | null }) {
  if (!request) {
    return (
      <p className="rounded border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700">
        Select a request to see its headers and body.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Request</h2>
        <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-y-1 text-sm">
          <dt className="text-slate-500">Received</dt>
          <dd>{new Date(request.receivedAt).toLocaleString()}</dd>
          <dt className="text-slate-500">Path</dt>
          <dd className="truncate font-mono text-xs">{request.path}</dd>
          <dt className="text-slate-500">Source IP</dt>
          <dd className="font-mono text-xs">{request.sourceIp ?? 'unknown'}</dd>
          <dt className="text-slate-500">Content type</dt>
          <dd className="font-mono text-xs">{request.contentType ?? 'none'}</dd>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Headers</h2>
        <div className="overflow-x-auto rounded border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {Object.entries(request.headers).map(([name, value]) => (
                <tr key={name}>
                  <th scope="row" className="whitespace-nowrap px-3 py-1.5 font-mono font-normal text-slate-500">
                    {name}
                  </th>
                  <td className="break-all px-3 py-1.5 font-mono">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Body
          {request.bodyEncoding === 'base64' ? (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal normal-case dark:bg-slate-800">
              base64, {request.bodySize} bytes
            </span>
          ) : null}
          {request.truncated ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-normal normal-case text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              truncated at 1 MB
            </span>
          ) : null}
        </h2>
        {request.bodySize === 0 ? (
          <p className="text-sm text-slate-500">No body.</p>
        ) : (
          <pre className="max-h-96 overflow-auto rounded bg-slate-100 p-3 font-mono text-xs dark:bg-slate-900">
            {formatBody(request)}
          </pre>
        )}
      </section>
    </div>
  );
}
