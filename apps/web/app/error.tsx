'use client';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        The API did not respond as expected. Check that it is running, then try again.
      </p>
      <button onClick={reset} className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium dark:border-slate-700">
        Try again
      </button>
    </div>
  );
}
