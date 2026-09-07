import { bins, createDb } from '@wi/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

const db = createDb(process.env.DATABASE_URL!);
const app = buildApp(db);

let slug: string;
let baseUrl: string;

beforeAll(async () => {
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  slug = (await app.inject({ method: 'POST', url: '/api/bins', payload: { name: 'Stream' } })).json().slug;
});

afterAll(async () => {
  await db.delete(bins).where(eq(bins.slug, slug));
  await app.close();
});

/** Reads the stream until `count` data events have arrived, then aborts it. */
async function collect(count: number, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/bins/${slug}/stream`, { headers, signal: controller.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: { id: string; data: Record<string, unknown> }[] = [];

  const read = (async () => {
    let buffer = '';
    while (events.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let split;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const id = chunk.match(/^id: (.+)$/m)?.[1];
        const data = chunk.match(/^data: (.+)$/m)?.[1];
        if (id && data) events.push({ id, data: JSON.parse(data) });
      }
    }
  })();

  return { response, events, read, stop: () => controller.abort() };
}

describe('live tail', () => {
  it('sets the headers an event stream needs', async () => {
    const stream = await collect(0);
    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get('content-type')).toBe('text/event-stream');
    expect(stream.response.headers.get('cache-control')).toContain('no-cache');
    expect(stream.response.headers.get('x-accel-buffering')).toBe('no');
    stream.stop();
  });

  it('pushes a request captured while the stream is open', async () => {
    const stream = await collect(1);

    await new Promise((resolve) => setTimeout(resolve, 150));
    await app.inject({
      method: 'POST',
      url: `/i/${slug}/live`,
      headers: { 'content-type': 'application/json' },
      payload: '{"live":true}',
    });

    await stream.read;
    stream.stop();

    expect(stream.events).toHaveLength(1);
    expect(stream.events[0]!.data).toMatchObject({ method: 'POST', path: `/i/${slug}/live` });
    expect(stream.events[0]!.id).toBe(stream.events[0]!.data.id);
  });

  it('backfills what a reconnecting client missed', async () => {
    const first = (await app.inject({ method: 'POST', url: `/i/${slug}/one`, payload: 'a' })).json();
    await app.inject({ method: 'POST', url: `/i/${slug}/two`, payload: 'b' });
    await app.inject({ method: 'POST', url: `/i/${slug}/three`, payload: 'c' });

    const stream = await collect(2, { 'last-event-id': first.id });
    await stream.read;
    stream.stop();

    expect(stream.events.map((event) => event.data.path)).toEqual([`/i/${slug}/two`, `/i/${slug}/three`]);
  });

  it('returns 404 for an unknown bin', async () => {
    const response = await fetch(`${baseUrl}/api/bins/nosuchbin/stream`);
    expect(response.status).toBe(404);
    await response.body?.cancel();
  });
});

describe('stream cleanup', () => {
  it('drops its subscriber when a client disconnects', async () => {
    const before = process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;

    for (let i = 0; i < 5; i++) {
      const stream = await collect(0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      stream.stop();
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;

    expect(after).toBeLessThanOrEqual(before);
  });

  it('still delivers to a second client after the first disconnects', async () => {
    const first = await collect(0);
    const second = await collect(1);
    await new Promise((resolve) => setTimeout(resolve, 150));

    first.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await app.inject({ method: 'POST', url: `/i/${slug}/after-disconnect`, payload: 'x' });

    await second.read;
    second.stop();

    expect(second.events.map((event) => event.data.path)).toEqual([`/i/${slug}/after-disconnect`]);
  });
});
