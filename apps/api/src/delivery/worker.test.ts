import { createServer, type Server } from 'node:http';
import { bins, createDb, deliveries, requests } from '@wi/db';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { claimDue, enqueue } from './queue.js';
import { runOnce } from './worker.js';

const db = createDb(process.env.DATABASE_URL!);
const app = buildApp(db);

type Hit = { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: Buffer };

let server: Server;
let target: string;
let hits: Hit[] = [];
let respond: (hit: Hit) => { status: number; delayMs?: number } = () => ({ status: 200 });
let slug: string;

beforeAll(async () => {
  await app.ready();

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const hit = { method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) };
      hits.push(hit);
      const { status, delayMs } = respond(hit);
      setTimeout(() => {
        res.writeHead(status);
        res.end();
      }, delayMs ?? 0);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  target = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/hook`;

  slug = (await app.inject({ method: 'POST', url: '/api/bins', payload: { name: 'Delivery' } })).json().slug;
  await app.inject({ method: 'PATCH', url: `/api/bins/${slug}`, payload: { forwardUrl: target } });
});

afterAll(async () => {
  await db.delete(bins).where(eq(bins.slug, slug));
  await app.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function capture(path: string, payload: string, contentType = 'application/json') {
  hits = [];
  const response = await app.inject({
    method: 'POST',
    url: `/i/${slug}${path}`,
    headers: { 'content-type': contentType, 'x-signature': 'abc' },
    payload,
  });
  return response.json().id as string;
}

async function attemptsFor(requestId: string) {
  return db
    .select()
    .from(deliveries)
    .where(eq(deliveries.requestId, requestId))
    .orderBy(asc(deliveries.attempt));
}

describe('delivery worker', () => {
  it('forwards the stored request and marks it sent', async () => {
    respond = () => ({ status: 200 });
    const id = await capture('/ok', '{"n":1}');

    expect(await runOnce(db)).toBe(1);

    const [attempt] = await attemptsFor(id);
    expect(attempt?.state).toBe('sent');
    expect(attempt?.responseStatus).toBe(200);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.method).toBe('POST');
    expect(hits[0]!.body.toString()).toBe('{"n":1}');
    expect(hits[0]!.headers['x-signature']).toBe('abc');
    expect(hits[0]!.headers['x-webhook-inspector-attempt']).toBe('1');
  });

  it('does not forward on the capture request itself', async () => {
    respond = () => ({ status: 200 });
    const id = await capture('/queued', 'x', 'text/plain');

    expect(hits).toHaveLength(0);
    const [queued] = await attemptsFor(id);
    expect(queued?.state).toBe('pending');

    await runOnce(db);
    expect(hits).toHaveLength(1);
  });

  it('schedules another attempt after a 500', async () => {
    respond = () => ({ status: 500 });
    const id = await capture('/flaky', 'x', 'text/plain');

    await runOnce(db);

    const attempts = await attemptsFor(id);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]!.state).toBe('failed');
    expect(attempts[0]!.responseStatus).toBe(500);
    expect(attempts[1]!.state).toBe('pending');
    expect(attempts[1]!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('gives up immediately on a 400', async () => {
    respond = () => ({ status: 400 });
    const id = await capture('/rejected', 'x', 'text/plain');

    await runOnce(db);

    const attempts = await attemptsFor(id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.state).toBe('dead');
  });

  it('retries a 429', async () => {
    respond = () => ({ status: 429 });
    const id = await capture('/throttled', 'x', 'text/plain');

    await runOnce(db);
    expect(await attemptsFor(id)).toHaveLength(2);
  });

  it('records a transport failure with no status', async () => {
    respond = () => ({ status: 200 });
    const id = await capture('/unreachable', 'x', 'text/plain');
    await db.update(deliveries).set({ targetUrl: 'http://127.0.0.1:1/nothing' }).where(eq(deliveries.requestId, id));

    await runOnce(db);

    const [attempt] = await attemptsFor(id);
    expect(attempt?.state).toBe('failed');
    expect(attempt?.responseStatus).toBeNull();
    expect(attempt?.error).toBeTruthy();
  });

  it('claims a row only once even with workers running together', async () => {
    respond = () => ({ status: 200 });
    const id = await capture('/contended', 'x', 'text/plain');

    const [first, second] = await Promise.all([claimDue(db, 10), claimDue(db, 10)]);
    const claimedIds = [...first, ...second].filter((row) => row.requestId === id);

    expect(claimedIds).toHaveLength(1);
  });

  it('does not queue a second first attempt for the same request', async () => {
    respond = () => ({ status: 200 });
    const id = await capture('/idempotent', 'x', 'text/plain');

    await enqueue(db, id, target);
    await enqueue(db, id, target);

    expect(await attemptsFor(id)).toHaveLength(1);
  });

  it('replays on demand and sends again', async () => {
    respond = () => ({ status: 200 });
    const id = await capture('/replayed', 'x', 'text/plain');
    await runOnce(db);

    hits = [];
    const replay = await app.inject({ method: 'POST', url: `/api/requests/${id}/replay` });
    expect(replay.statusCode).toBe(202);

    await runOnce(db);
    expect(hits).toHaveLength(1);
    expect(await attemptsFor(id)).toHaveLength(2);
  });

  it('refuses to replay when the bin has no forward URL', async () => {
    const plain = (await app.inject({ method: 'POST', url: '/api/bins', payload: { name: 'No target' } })).json();
    const captured = (await app.inject({ method: 'POST', url: `/i/${plain.slug}/x`, payload: 'x' })).json();

    const response = await app.inject({ method: 'POST', url: `/api/requests/${captured.id}/replay` });
    expect(response.statusCode).toBe(409);

    await db.delete(bins).where(eq(bins.id, plain.id));
  });

  it('shows the attempts on the request detail', async () => {
    respond = () => ({ status: 200 });
    const id = await capture('/history', 'x', 'text/plain');
    await runOnce(db);

    const detail = (await app.inject({ method: 'GET', url: `/api/requests/${id}` })).json();
    expect(detail.deliveries).toHaveLength(1);
    expect(detail.deliveries[0].state).toBe('sent');
  });
});

describe('request deletion', () => {
  it('removes the deliveries with the request', async () => {
    const id = await capture('/cascade', 'x', 'text/plain');
    await db.delete(requests).where(eq(requests.id, id));
    expect(await attemptsFor(id)).toHaveLength(0);
  });
});

describe('worker crash recovery', () => {
  it('reclaims a delivery whose worker died mid attempt', async () => {
    respond = () => ({ status: 200 });
    const id = await capture('/crashed', 'x', 'text/plain');

    const [claimed] = await claimDue(db, 10);
    expect(claimed?.requestId).toBe(id);
    expect((await attemptsFor(id))[0]!.state).toBe('sending');

    expect(await runOnce(db)).toBe(0);

    await db
      .update(deliveries)
      .set({ updatedAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(deliveries.requestId, id));

    hits = [];
    expect(await runOnce(db)).toBe(1);
    expect(hits).toHaveLength(1);

    const attempts = await attemptsFor(id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.state).toBe('sent');
  });
});
