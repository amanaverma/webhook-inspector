import Link from 'next/link';
import { listBins } from '@/lib/api';
import { CreateBinForm } from './create-bin-form';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const bins = await listBins();

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Bins</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          A bin is one capture URL. Point a provider at it and every request it sends is stored here.
        </p>
        <CreateBinForm />
      </section>

      {bins.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700">
          No bins yet. Create one above to get a capture URL.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-200 dark:divide-slate-800">
          {bins.map((bin) => (
            <li key={bin.id}>
              <Link href={`/bins/${bin.slug}`} className="flex items-baseline justify-between gap-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900">
                <span className="font-medium">{bin.name}</span>
                <span className="font-mono text-xs text-slate-500">/i/{bin.slug}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
