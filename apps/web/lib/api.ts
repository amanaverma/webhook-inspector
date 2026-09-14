import { cookies } from 'next/headers';

export type Bin = {
  id: string;
  slug: string;
  name: string;
  forwardUrl: string | null;
  isActive: boolean;
  createdAt: string;
};

export type RequestSummary = {
  id: string;
  method: string;
  path: string;
  query: Record<string, string | string[]>;
  bodySize: number;
  truncated: boolean;
  contentType: string | null;
  sourceIp: string | null;
  receivedAt: string;
};

export type Delivery = {
  id: string;
  attempt: number;
  state: 'pending' | 'sending' | 'sent' | 'failed' | 'dead';
  targetUrl: string;
  responseStatus: number | null;
  durationMs: number | null;
  error: string | null;
  nextAttemptAt: string;
  createdAt: string;
};

export type RequestDetail = RequestSummary & {
  headers: Record<string, string>;
  body: string;
  bodyEncoding: 'utf8' | 'base64';
  deliveries: Delivery[];
};

export type User = { id: string; email: string };

const base = process.env.API_BASE_URL ?? 'http://localhost:3000';

/** Passes the browser's session cookie on, since server side fetch carries none of its own. */
async function sessionHeaders(): Promise<Record<string, string>> {
  const store = await cookies();
  const header = store.toString();
  return header ? { cookie: header } : {};
}

/**
 * Calls the API and parses the JSON response.
 *
 * Returns null when the API answers 404, and throws for any other failure, so a
 * missing bin renders a not found page while a broken API surfaces as an error.
 */
async function get<T>(path: string): Promise<T | null> {
  const response = await fetch(`${base}${path}`, { cache: 'no-store', headers: await sessionHeaders() });
  if (response.status === 401 || response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return (await response.json()) as T;
}

export async function listBins(): Promise<Bin[]> {
  return (await get<{ bins: Bin[] }>('/api/bins'))?.bins ?? [];
}

export async function getBin(slug: string): Promise<(Bin & { requestCount: number }) | null> {
  return get<Bin & { requestCount: number }>(`/api/bins/${slug}`);
}

export async function listRequests(slug: string, cursor?: string) {
  const query = new URLSearchParams({ limit: '25', ...(cursor ? { cursor } : {}) });
  return get<{ requests: RequestSummary[]; nextCursor: string | null }>(
    `/api/bins/${slug}/requests?${query}`,
  );
}

export async function getRequest(id: string): Promise<RequestDetail | null> {
  return get<RequestDetail>(`/api/requests/${id}`);
}

export async function currentUser(): Promise<User | null> {
  return get<User>('/api/auth/me');
}
