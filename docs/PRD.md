# Webhook Inspector — Product Requirements Document

| | |
|---|---|
| **Status** | Draft |
| **Owner** | Aman Verma |
| **Last updated** | 2026-08-31 |

---

## 1. Summary

Webhook Inspector is a self-hosted service that gives a developer a public URL,
captures every HTTP request sent to that URL exactly as it arrived, shows those
requests live in a browser, and forwards or replays them to a target of the
developer's choosing with retries and delivery tracking.

It solves a problem every developer integrating a third-party service has: the
provider says it sent a webhook, the local server never saw it, and there is no
record of what was actually on the wire.

---

## 2. Problem

When wiring up a webhook from a payment provider, a CI system, or a blockchain
node provider, three things go wrong repeatedly.

1. **No visibility.** The provider's dashboard shows "delivered" and the local
   application shows nothing. There is no shared record of the actual bytes.
2. **No local reachability.** The provider cannot reach `localhost`, so testing
   requires a tunnel, and a tunnel gives no history.
3. **No replay.** Reproducing a bug means asking the provider to re-fire an
   event, which is slow when it is possible at all.

---

## 3. Goals

| # | Goal | Measure of success |
|---|---|---|
| G1 | Capture any HTTP request byte-exactly | Binary, form, JSON, and empty bodies all round-trip unchanged |
| G2 | Never lose a request because the app was slow | Capture endpoint responds in under 50 ms at p95 under load |
| G3 | Show requests as they arrive | New request visible in an open browser tab in under 1 second |
| G4 | Forward reliably | Target receives each request exactly once, even across a worker crash |
| G5 | Be operable by someone who did not write it | README carries a schema diagram, measured latency numbers, and stated limits |

---

## 4. Non-goals

These are deliberately excluded. They are listed so scope creep is a visible
decision rather than an accident.

- Team accounts, sharing, or role based permissions.
- Custom response bodies or status codes per bin.
- Request transformation, scripting, or filtering rules.
- Long term archival. Retention is fixed at seven days.
- A mobile application.
- Billing or usage plans.

---

## 5. Users

| User | Situation | What they need |
|---|---|---|
| **Integrating developer** | Wiring a third-party webhook for the first time | A URL to paste into the provider dashboard, and a view of what arrives |
| **Debugging developer** | A webhook worked yesterday and fails today | History, and a replay button to reproduce against local code |
| **Operator** | Running the service for a small team | Rate limits, retention, and enough metrics to see it is healthy |

---

## 6. Core concepts

| Term | Meaning |
|---|---|
| **Bin** | A capture endpoint with an unguessable slug. Owns an optional forward target |
| **Request** | One captured HTTP request: method, path, query, headers, raw body, source IP, timestamp |
| **Delivery** | One attempt to send a stored request to a forward target. A request may have several |
| **Replay** | A manually triggered delivery of a request that was already captured |

---

## 7. Functional requirements

### 7.1 Capture

| ID | Requirement | Priority |
|---|---|---|
| C1 | Any HTTP method on `/i/:slug` and any path below it is accepted | Must |
| C2 | Request body is stored as raw bytes before any parsing occurs | Must |
| C3 | Headers, query string, source IP, and arrival time are stored | Must |
| C4 | Bodies over 1 MB are rejected with 413 and a truncation record is kept | Must |
| C5 | Capture responds 200 immediately and performs no forwarding inline | Must |
| C6 | An unknown or inactive slug returns 404 without writing a row | Must |

### 7.2 Browsing

| ID | Requirement | Priority |
|---|---|---|
| B1 | A user can create a bin and copy its URL in one click | Must |
| B2 | Requests for a bin are listed newest first with keyset pagination | Must |
| B3 | A request detail view shows headers as a table and the body formatted by content type | Must |
| B4 | JSON bodies are pretty-printed; binary bodies are shown as a hex preview | Must |
| B5 | A user can clear all requests in a bin | Should |
| B6 | The UI works in light and dark mode on a phone-width screen | Should |

### 7.3 Live tail

| ID | Requirement | Priority |
|---|---|---|
| L1 | An open bin page receives new requests over Server-Sent Events without a refresh | Must |
| L2 | The stream sends a heartbeat every 15 seconds so proxies do not close it | Must |
| L3 | A reconnecting client resumes from its last seen event id with no gap and no duplicate | Must |
| L4 | Disconnecting a client releases its server resources | Must |

### 7.4 Forward and replay

| ID | Requirement | Priority |
|---|---|---|
| F1 | A bin may carry a forward URL. Captured requests are queued for delivery to it | Must |
| F2 | Delivery runs in a worker, never on the capture request path | Must |
| F3 | Each attempt is recorded with response status, duration, and error | Must |
| F4 | Failed deliveries retry with exponential backoff and jitter, up to five attempts | Must |
| F5 | A 4xx response is terminal and is not retried. A 5xx or timeout is retried | Must |
| F6 | A unique dedupe key prevents a double send after a worker crash and restart | Must |
| F7 | A user can manually replay any stored request | Must |
| F8 | Delivery history is visible in the request detail view | Should |

### 7.5 Accounts

| ID | Requirement | Priority |
|---|---|---|
| A1 | Signup and login with email and password, hashed with argon2id | Must |
| A2 | Sessions use an httpOnly, secure, sameSite cookie | Must |
| A3 | Every bin route verifies the caller owns the bin | Must |
| A4 | Bins created before accounts existed remain reachable by slug | Should |

### 7.6 Operations

| ID | Requirement | Priority |
|---|---|---|
| O1 | Capture is rate limited per slug with a token bucket in Redis | Must |
| O2 | A retention job deletes requests older than seven days in batches | Must |
| O3 | Logs are structured and carry a request id end to end | Must |
| O4 | A metrics endpoint exposes capture rate, delivery success rate, and queue depth | Should |
| O5 | Shutdown drains in-flight deliveries before exiting | Should |

---

## 8. Data model

```
bins
  id            uuid        primary key
  slug          text        unique, unguessable
  name          text
  forward_url   text        nullable
  is_active     boolean     default true
  user_id       uuid        nullable, references users
  created_at    timestamptz

requests
  id            uuid        primary key
  bin_id        uuid        references bins
  method        text
  path          text
  query         jsonb
  headers       jsonb
  body          bytea
  body_size     integer
  truncated     boolean
  content_type  text
  source_ip     inet
  received_at   timestamptz
  index (bin_id, received_at desc, id desc)

deliveries
  id              uuid      primary key
  request_id      uuid      references requests
  target_url      text
  attempt         integer
  state           text      pending | sent | failed | dead
  response_status integer   nullable
  duration_ms     integer   nullable
  error           text      nullable
  dedupe_key      text      unique
  created_at      timestamptz

users
  id            uuid        primary key
  email         text        unique
  password_hash text
  created_at    timestamptz
```

Three tables carry the product. `deliveries` is where the interesting behaviour
lives, because it is the only table whose correctness survives a crash.

---

## 9. API surface

| Method | Path | Purpose |
|---|---|---|
| `ANY` | `/i/:slug/*` | Capture. Returns 200 with an empty body |
| `POST` | `/api/bins` | Create a bin |
| `GET` | `/api/bins` | List the caller's bins |
| `GET` | `/api/bins/:slug` | Bin detail |
| `PATCH` | `/api/bins/:slug` | Set name, forward URL, active flag |
| `GET` | `/api/bins/:slug/requests` | Paginated request list, keyset cursor |
| `DELETE` | `/api/bins/:slug/requests` | Clear the bin |
| `GET` | `/api/bins/:slug/stream` | SSE live tail |
| `GET` | `/api/requests/:id` | Full request including body |
| `POST` | `/api/requests/:id/replay` | Queue a manual delivery |
| `POST` | `/api/auth/signup` | Create an account |
| `POST` | `/api/auth/login` | Start a session |
| `POST` | `/api/auth/logout` | End a session |
| `GET` | `/health` | Liveness |
| `GET` | `/metrics` | Operational counters |

---

## 10. Technical decisions

| Decision | Choice | Reason |
|---|---|---|
| Language | TypeScript on Node 22 | One language across the API, the worker, and the web app |
| HTTP framework | Fastify | Direct control over body parsing, which requirement C2 needs |
| Database | PostgreSQL 16 | `jsonb` for headers, `bytea` for bodies, real indexes |
| ORM | Drizzle | Migrations are readable SQL rather than generated magic |
| Queue | Postgres table plus a polling worker, Redis only for rate limiting | One fewer moving part while the queue is small |
| Realtime | Server-Sent Events over `LISTEN/NOTIFY` | One-way push, so a WebSocket is unnecessary |
| Frontend | Next.js 15 with Tailwind 4 | Server components suit a read-heavy dashboard |
| Tests | Vitest | Fast, no configuration |
| Hosting | Fly.io for the API, Neon for Postgres, Vercel for the web app | Free tiers keep the demo live long term |

---

## 11. Success criteria

The project is complete when all of the following hold.

1. A request sent from any machine on the internet appears in an open browser
   tab in under one second.
2. A 1 MB binary body is stored and read back byte-identical.
3. Killing the delivery worker mid-flight and restarting it results in the
   target receiving the payload exactly once.
4. The request list query stays under 10 ms with 100,000 stored rows, with an
   `EXPLAIN ANALYZE` in the README to show it.
5. Continuous integration runs typecheck, lint, tests, and migrations on every
   push, and is green.
6. The service is deployed, publicly reachable, and the README states measured
   p50 and p95 latency under load.

---

## 12. Risks

| Risk | Impact | Response |
|---|---|---|
| Raw body capture fights the framework's default parsing | Blocks requirement C2, which the rest of the product depends on | Prove the custom parser against binary and form payloads before building anything above it |
| Delivery retries double-send after a crash | Breaks the exactly-once promise in G4 | The dedupe key is a unique constraint in the database, not a check in application code |
| An open capture endpoint invites abuse once public | Storage cost and noise | Rate limiting and seven day retention ship before the first public deploy |
| Large bodies exhaust memory under concurrency | Service falls over | Hard 1 MB cap enforced during parsing, before the body is buffered in full |
| `LISTEN/NOTIFY` payload limits bite as requests grow | Live tail silently drops events | Notify with an id only, then have the client fetch the record |

---

## 13. Future work

Deliberately out of the current scope, recorded so the ideas are not lost.

- Payload decoders that recognise common providers and pretty-print their
  events, including ABI decoding of blockchain event logs.
- Configurable retention windows per bin.
- A command line client that tails a bin in the terminal.
- Filter expressions on the request list.
- Team accounts with shared bins.
