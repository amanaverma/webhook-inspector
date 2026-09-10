import { notFound } from 'next/navigation';
import { getBin, getRequest, listRequests } from '@/lib/api';
import { CaptureUrl } from './capture-url';
import { ForwardUrl } from './forward-url';
import { LiveTail } from './live-tail';
import { RequestDetailPane } from './request-detail';
import { RequestList } from './request-list';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ request?: string }>;
};

export default async function BinPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { request: selectedId } = await searchParams;

  const bin = await getBin(slug);
  if (!bin) notFound();

  const [page, selected] = await Promise.all([
    listRequests(slug),
    selectedId ? getRequest(selectedId) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{bin.name}</h1>
        <CaptureUrl slug={bin.slug} />
        <ForwardUrl slug={bin.slug} current={bin.forwardUrl} />
        <div className="flex items-center gap-3">
          <p className="text-sm text-slate-500">
            {bin.requestCount} {bin.requestCount === 1 ? 'request' : 'requests'} captured
            {bin.isActive ? '' : ' · inactive, new requests are rejected'}
          </p>
          <LiveTail slug={bin.slug} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <RequestList slug={slug} requests={page?.requests ?? []} selectedId={selectedId ?? null} />
        <RequestDetailPane request={selected} />
      </div>
    </div>
  );
}
