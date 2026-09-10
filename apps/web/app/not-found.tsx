import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-semibold tracking-tight">Bin not found</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        This bin does not exist, or it was deleted.
      </p>
      <Link href="/" className="text-sm font-medium underline">
        Back to all bins
      </Link>
    </div>
  );
}
