# Webhook Inspector

Give a webhook a URL, see exactly what it sent, and forward it on.

Every request that reaches a bin is stored whole: method, path, query, headers and raw
body. The bin page shows them as they arrive over a live tail. Point a bin at a forward
URL and each captured request is delivered there with retries, or replayed by hand later.

The point of the project is the parts that are easy to get wrong: capturing a body
without the framework parsing it first, retrying delivery without two workers sending
the same attempt, and refusing to be used as a way into a private network.

## Quickstart

Requires Node 20 or newer and Docker.

```sh
git clone https://github.com/amanaverma/webhook-inspector.git
cd webhook-inspector
npm ci
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local

npm run db:up                  # Postgres on 5433, Redis on 6380
npm run migrate -w @wi/db
npm run dev -w @wi/api         # API on 3000
npm run worker:dev -w @wi/api  # delivery worker
npm run dev -w @wi/web         # web app on 3001
```

Open http://localhost:3001, sign up, create a bin, then post to it:

```sh
curl -X POST http://localhost:3000/i/<slug> -H 'content-type: application/json' -d '{"hello":"there"}'
```

To run the whole stack in containers instead, including migrations:

```sh
docker compose --profile full up --build
```

That serves the web app on 3001 and the API on 3000. Without `--profile full` the same
file starts only Postgres and Redis, which is what the tests and the dev servers use.

## How it works

`docs/architecture.md` has the diagrams: the data model, the capture path, the delivery
state machine and the deployment layout. The short version:

| Piece | What it does |
| --- | --- |
| `apps/api` | Fastify. Capture, the JSON API, the live tail over SSE. |
| `apps/api` worker | Claims due deliveries, sends them, schedules retries. Same image, separate process. |
| `apps/web` | Next.js. Proxies `/api` so the browser stays on one origin. |
| `packages/db` | Drizzle schema and migrations. |

Capture reads the body with a custom content type parser, so the bytes are stored as
they arrived rather than as a parser understood them. Delivery claims rows with
`FOR UPDATE SKIP LOCKED` and writes attempts back under the attempt number it claimed,
so two workers racing on one row cannot both send. The live tail listens on a Postgres
`LISTEN/NOTIFY` channel, one connection per process, and fans out to connected browsers.

## Configuration

API and worker, from `.env`:

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. Must be a direct connection, not a transaction pooler, because the live tail uses `LISTEN`. |
| `REDIS_URL` | in production | Rate limit buckets. Without it, capture, login and signup are unlimited. |
| `PORT`, `HOST` | no | Defaults 3000 and 0.0.0.0. |
| `RETENTION_DAYS` | no | Requests older than this are pruned hourly. Default 7. |
| `METRICS_TOKEN` | in production | Bearer token for `/metrics`. |
| `TRUST_PROXY` | behind a proxy | Addresses or ranges of the proxies in front of the process, for example `10.0.0.0/8,loopback`. A hop count or `true` is refused, since either lets a caller pick its own address. |
| `FORWARD_ALLOW_PRIVATE` | no | Allows forwarding to private addresses. Refused when `NODE_ENV=production`. |

Web app, from `apps/web/.env.local`:

| Variable | Meaning |
| --- | --- |
| `API_BASE_URL` | Where the app reaches the API. Needed at build time for the `/api` rewrite and at run time for server rendered pages. |
| `CAPTURE_ORIGIN` | The public origin of the API, shown to users as the address providers post to. |

Startup fails rather than starting misconfigured: in production a missing `REDIS_URL` or
`METRICS_TOKEN`, or `FORWARD_ALLOW_PRIVATE=true`, stops the process.

## Deploying

Two Fly applications from this repo, both against Neon Postgres and Upstash Redis:

```sh
fly apps create webhook-inspector-api
fly secrets set DATABASE_URL=... REDIS_URL=... METRICS_TOKEN=... -a webhook-inspector-api
fly deploy --config fly.toml

fly apps create webhook-inspector-web
fly deploy --config fly.web.toml
```

`fly.toml` runs the API and the worker as two process groups from one image, and applies
migrations as the release command, so a failed migration stops the deploy before any
machine takes the new image.

The web app runs beside the API rather than on a separate host. Its proxy passes
`x-forwarded-for` through untouched, so the API still sees the address the edge recorded
for the caller and the per address login and signup limits stay meaningful. Set
`TRUST_PROXY` to the range the edge proxy connects from, which the first deploy's logs
will show.

## Measured numbers

Capture, 500 requests a second for 20 seconds spread across 160 bins, with 126,000
requests already stored. API, Postgres and Redis in containers on one laptop, an
8 core M3, so these exclude network time:

| p50 | p95 | p99 | max | non 2xx |
| --- | --- | --- | --- | --- |
| 1.3 ms | 1.9 ms | 5.0 ms | 43.9 ms | none |

Reproduce with `node scripts/loadtest.mjs --bins=160 --rate=500 --duration=20`. The
script signs up, creates the bins and spreads load across them, because capture allows a
burst of 120 per bin and refills at 2 a second; against too few bins it would measure the
429 path instead.

Listing a bin's requests at 100,000 rows in that bin, first page and a page 50,000 rows
deep:

```
Limit  (cost=0.42..4.05 rows=26 width=68) (actual time=0.027..0.065 rows=26 loops=1)
  ->  Index Scan using requests_bin_received_idx on requests
        Index Cond: (bin_id = '...'::uuid)
Execution Time: 0.124 ms

Limit  (cost=8.85..16.08 rows=26 width=24) (actual time=0.048..0.055 rows=26 loops=1)
  ->  Index Only Scan using requests_bin_received_idx on requests
        Index Cond: ((bin_id = '...'::uuid) AND (ROW(received_at, id) < ROW($0, $1)))
Execution Time: 0.091 ms
```

Paging by cursor rather than offset is why the deep page costs the same as the first one.

## Limits

- Bodies are stored up to 1 MB. Past that the request is still recorded, marked
  truncated, and cannot be replayed. A body over 8 MB is refused with 413.
- Delivery is at least once. Two workers cannot send the same attempt, but a worker that
  crashes between sending and recording the result sends that attempt again.
- A delivery counts as delivered on any response below 400, so a target that answers
  with a redirect is treated as success.
- Signing out ends the current session only, not every session for the account.
- Cross site request protection rests on `SameSite=Lax` cookies. There is no CSRF token.
- Signup answers 409 for an address that already has an account, which tells a caller
  that the address is registered.
- Bin creation has no rate limit of its own beyond the session it needs.
- The live tail holds a Postgres `LISTEN` connection per API process, so a managed
  Postgres plan with a low connection cap limits how many API machines can run.
- Retention prunes hourly, so a request can outlive `RETENTION_DAYS` by up to an hour.

## Development

```sh
npm run typecheck
npm test -w @wi/api            # needs npm run db:up
npm run generate -w @wi/db     # after changing the schema
```

The test suite shares one database with the dev server. It runs against the same
Postgres and Redis that `npm run db:up` starts, so stop the delivery worker first. A
worker running alongside the tests claims the deliveries they are waiting on and fails
them at random.
