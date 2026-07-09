# Load testing (k6)

Performance/capacity tests for the API, simulating many concurrent users
across all roles and high-volume parcel intake. Targets local dev by default
(`http://localhost:3000`).

## Prerequisites

- `k6` installed (`brew install k6`)
- Server running locally with Postgres + Redis up (`npm run dev` in `server/`)
- Accounts + session tokens seeded once:

  ```bash
  cd server
  npx ts-node prisma/seed-load-test-users.ts
  ```

  This creates a pool of vendor/rider/sales/admin/super_admin accounts and
  writes their tokens to `server/loadtest/k6/pool.json` (gitignored - it
  holds live, if throwaway, API credentials). Tokens are valid 7 days;
  rerun the script to refresh or resize the pool.

## Why a sized account pool, and the role split

Every write endpoint is rate-limited **per authenticated actor**
(`server/src/routes/order.routes.ts`):

- `POST /orders/bulk`: 5 batches/min x up to 100 orders = **500 parcels/min per vendor**
- `POST /orders`: 30/min per actor
- Read endpoints (dashboard, list, run-sheet): **120 req/min per actor**

That read limit applies to every role identically. At a realistic browsing
pace (~13 req/min per simulated user, i.e. a dashboard + list call every
~9s), staying under 120/min/account needs roughly **1 real account per 9
simulated users**. Skip this math and you're not measuring app capacity —
you're re-measuring the rate limiter, which is what happened the first time
this suite ran 2,000 VUs against only 60 accounts (88% of requests came back
429).

The seed script's defaults assume a **realistic-skew 30,000-user
simulation** (most traffic is vendors/riders, not internal staff):

| Role | % of 30k users | Simulated users | Seeded accounts | Read ceiling |
|---|---|---|---|---|
| vendor | 70% | 21,000 | 2,500 | 300,000/min |
| rider | 15% | 4,500 | 500 | 60,000/min |
| sales | 8% | 2,400 | 300 | 36,000/min |
| admin | 6% | 1,800 | 200 | 24,000/min |
| super_admin | 1% | 300 | 40 | 4,800/min |

Override any count with `LOADTEST_VENDOR_COUNT` / `LOADTEST_RIDER_COUNT` /
`LOADTEST_SALES_COUNT` / `LOADTEST_ADMIN_COUNT` / `LOADTEST_SUPERADMIN_COUNT`
env vars if you change the target user count or role mix — and update the
weights in `k6/lib/roles.js` to match, since that's what assigns each
simulated VU a role.

**Tokens are pre-minted, not logged in live.** `POST /api/auth/login` is
rate-limited at 500 attempts/15min **per IP**, shared by your whole test run
since it all comes from one machine. Provisioning thousands of accounts
through the real login endpoint would take over an hour and still trip that
limiter. The seed script signs valid JWTs directly (same secret, same
payload shape `loginUser()` produces) and writes them to `pool.json`; the k6
scripts read them via `k6/lib/pool.js`. This is a deliberate shortcut around
an irrelevant bottleneck for these scenarios — it does not test the login
endpoint itself. If you specifically want to load-test login throughput,
that's a separate, smaller-scale scenario (not included here).

## Scenarios

All scripts live in `k6/scenarios/` and read config from `k6/config.js`
(override with `-e KEY=value`).

### Browsing across all roles (read load, the 30k-user scenario)

```bash
cd server/loadtest/k6
k6 run -e MAX_VUS=3000 -e RAMP_TIME=1m -e HOLD_TIME=3m scenarios/browse.js
```

Ramps to `MAX_VUS` concurrent sessions, each assigned a role by
`k6/lib/roles.js`'s weighted split, hitting the dashboard and order list
(admins/super_admins also occasionally check the rider run-sheet).

**Ramp toward 30k in stages, don't jump straight there:**

```bash
k6 run -e MAX_VUS=3000  -e RAMP_TIME=1m -e HOLD_TIME=3m scenarios/browse.js
k6 run -e MAX_VUS=10000 -e RAMP_TIME=2m -e HOLD_TIME=3m scenarios/browse.js
k6 run -e MAX_VUS=20000 -e RAMP_TIME=3m -e HOLD_TIME=4m scenarios/browse.js
k6 run -e MAX_VUS=30000 -e RAMP_TIME=3m -e HOLD_TIME=5m scenarios/browse.js
```

Watch `http_req_failed` and connection-refused/reset errors at each stage —
that's your signal to stop and read what actually broke before going
higher. A single machine pushing tens of thousands of connections at
`localhost` typically hits OS limits before the app does:

- **macOS ephemeral ports**: `sysctl net.inet.ip.portrange.first/.last` —
  default range is usually ~16k ports. Every open connection to the same
  `host:port` consumes one. If you see connection errors climbing well
  before 30k VUs, this is the likely cause; widening the range requires a
  `sysctl -w` (root) and is a client-machine tuning problem, not an app bug.
- **File descriptors**: `ulimit -n` — raise it in the shell you run k6 from
  if you see "too many open files".

For a genuine tens-of-thousands-of-VUs run without fighting your own
laptop's networking stack, distribute k6 across multiple machines (or k6
cloud) instead.

### Parcel creation (write load)

```bash
k6 run -e PARCELS_PER_MIN=3000 -e BATCH_SIZE=50 -e DURATION=5m scenarios/parcel-creation.js
```

Sustains a target parcels/min rate via `POST /orders/bulk`, spread across
the seeded vendor pool. Watch `parcels_created` and
`rate_limited_requests` in the summary — if rate-limiting dominates, either
reseed more vendors or you've found the actual ceiling.

### Combined (write + read together, all roles)

```bash
k6 run \
  -e PARCELS_PER_MIN=3000 -e BATCH_SIZE=50 \
  -e MAX_VUS=3000 -e RAMP_TIME=1m -e HOLD_TIME=3m \
  scenarios/full-site.js
```

Run the isolated scenarios first — if something's slow, you want to know
whether it's the write path, the read path, or a specific role's traffic
before combining them.

## Reading results

k6 prints a summary at the end. Key things to look at:

- `http_req_duration` p95/p99, per tag (`{name:dashboard_summary}` etc.) —
  response time under load, broken out by endpoint
- `checks` — pass rate (a low rate on `dashboard ok`/`list ok`/`bulk create
  succeeded` means real failures, not just rate limiting — those are
  already split out into `rate_limited_requests`)
- `rate_limited_requests` — count of 429s, tracked separately so "the app is
  slow" is distinguishable from "the rate limiter is working as designed"
- `http_req_failed` — network-level failures (connection refused, reset,
  timeouts) — at high VU counts, check whether this is the app or the OS
  (see the port/fd notes above) before concluding the app broke

If you see failures/timeouts unrelated to 429s or OS limits, that's your
actual application capacity ceiling — check server logs and Postgres/Redis
connection pool sizes next.
