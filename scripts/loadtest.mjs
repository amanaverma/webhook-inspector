// Measures capture latency. See the README section "Measured numbers" for how
// the published figures were produced.
import { request as httpRequest, Agent as HttpAgent } from 'node:http';
import { request as httpsRequest, Agent as HttpsAgent } from 'node:https';

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [name, value] = arg.replace(/^--/, '').split('=');
    return [name, value ?? 'true'];
  }),
);

const target = new URL(options.target ?? 'http://localhost:3000');
const binCount = Number(options.bins ?? 40);
const connections = Number(options.connections ?? 20);
const durationMs = Number(options.duration ?? 20) * 1000;
const rate = Number(options.rate ?? 500);
const secure = target.protocol === 'https:';
const send = secure ? httpsRequest : httpRequest;
const agent = new (secure ? HttpsAgent : HttpAgent)({ keepAlive: true, maxSockets: connections });
const body = JSON.stringify({ event: 'load.test', at: new Date().toISOString() });

/**
 * Sends one request and resolves with its status and how long it took in
 * milliseconds, including reading the response.
 *
 * Resolves with status 0 on a transport error, so a connection reset during
 * the run shows up in the split rather than stopping the test.
 */
function timed(path, { method = 'POST', headers = {}, payload = body } = {}) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const req = send(
      { protocol: target.protocol, hostname: target.hostname, port: target.port, path, method, headers, agent },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            ms: Number(process.hrtime.bigint() - started) / 1e6,
            headers: res.headers,
            text: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on('error', () => resolve({ status: 0, ms: Number(process.hrtime.bigint() - started) / 1e6, headers: {}, text: '' }));
    req.end(payload);
  });
}

/**
 * Signs up a throwaway account and creates `binCount` bins under it.
 *
 * Returns their slugs. Throws when signup or bin creation is refused, which on
 * a deployed target usually means the signup rate limit is still spent from an
 * earlier run.
 */
async function createBins() {
  const email = `loadtest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const json = { 'content-type': 'application/json' };
  const signup = await timed('/api/auth/signup', {
    headers: json,
    payload: JSON.stringify({ email, password: 'loadtest-password' }),
  });
  if (signup.status !== 201) throw new Error(`signup failed with ${signup.status}: ${signup.text}`);

  const cookie = (signup.headers['set-cookie'] ?? []).map((value) => value.split(';')[0]).join('; ');
  const slugs = [];
  for (let index = 0; index < binCount; index += 1) {
    const created = await timed('/api/bins', {
      headers: { ...json, cookie },
      payload: JSON.stringify({ name: `load ${index}` }),
    });
    if (created.status !== 201) throw new Error(`bin creation failed with ${created.status}: ${created.text}`);
    slugs.push(JSON.parse(created.text).slug);
  }
  return slugs;
}

function percentile(sorted, fraction) {
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index];
}

// Capture allows a burst of 120 per bin and refills at 2 a second, so a run
// that does not spread itself over enough bins measures the 429 path instead
// of the capture path.
const perBin = 120 + 2 * (durationMs / 1000);
const needed = Math.ceil((rate * durationMs) / 1000 / perBin);
if (needed > binCount) {
  console.error(`${rate}/s for ${durationMs / 1000}s needs at least ${needed} bins, got ${binCount}`);
  process.exit(1);
}

const slugs = await createBins();
console.log(
  `${slugs.length} bins, ${connections} connections, ${rate}/s for ${durationMs / 1000}s against ${target.origin}`,
);

const started = Date.now();
const deadline = started + durationMs;
const latencies = [];
const statuses = new Map();
let next = 0;

await Promise.all(
  Array.from({ length: connections }, async () => {
    while (Date.now() < deadline) {
      const slot = started + (next * 1000) / rate;
      const slug = slugs[next++ % slugs.length];
      const wait = slot - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      const result = await timed(`/i/${slug}`, { headers: { 'content-type': 'application/json' } });
      latencies.push(result.ms);
      statuses.set(result.status, (statuses.get(result.status) ?? 0) + 1);
    }
  }),
);

latencies.sort((a, b) => a - b);
const seconds = durationMs / 1000;
console.log(`requests   ${latencies.length} (${(latencies.length / seconds).toFixed(0)}/s)`);
console.log(`p50        ${percentile(latencies, 0.5).toFixed(1)} ms`);
console.log(`p95        ${percentile(latencies, 0.95).toFixed(1)} ms`);
console.log(`p99        ${percentile(latencies, 0.99).toFixed(1)} ms`);
console.log(`max        ${latencies.at(-1).toFixed(1)} ms`);
for (const [status, count] of [...statuses].sort((a, b) => a[0] - b[0])) {
  console.log(`status ${status}  ${count}`);
}
