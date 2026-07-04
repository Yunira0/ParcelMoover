# Code Audit — Uncommitted Redis Changes

**Date:** 2026-07-05
**Branch:** `claude/eager-germain-259669` (at `ed84fc1`)
**Scope:** Uncommitted working-tree changes

| File | Change |
|---|---|
| `server/src/lib/redis.ts` | `enableOfflineQueue: true → false` (fail fast when Redis is disconnected) |
| `server/src/lib/redisPubSub.ts` | One-shot error-log suppression on the SSE notifications subscriber |
| `.claude/settings.local.json` | Tooling permission allowlist additions only — no runtime impact |

---

## What the change does

Previously, with `enableOfflineQueue: true`, any Redis command issued while the
connection was down sat in ioredis's offline queue until `commandTimeout`
(3000 ms) fired. Because a single request can touch Redis several times
(token-revocation check → cache read → cache write), a Redis outage turned
every request into a 6–9 s stall before the fallbacks kicked in.

With `enableOfflineQueue: false`, commands issued while disconnected reject
immediately ("Stream isn't writeable and enableOfflineQueue options is
false"), so the existing try/catch fallbacks fire instantly and requests
degrade to "skip the cache" with no added latency. `commandTimeout: 3000`
remains as the bound for a live-but-hung connection.

The `redisPubSub.ts` change mirrors the log-flood suppression that `redis.ts`
already applies to the main client: the subscriber (a `duplicate()` of the
main client) retries every ~2 s forever when Redis is absent, and previously
logged an error line on every attempt.

## Verification performed

The diff's central claim — *"every Redis call site in this app has a try/catch
fallback"* — was checked against every consumer:

| Call site | Behavior on instant rejection | OK? |
|---|---|---|
| `lib/tokenRevocation.ts` (4 functions) | Caught; revocation checks fail open (documented as intentional best-effort) | ✅ |
| `services/idempotency.service.ts` | Read/lock/write/unlock each individually caught; degrades to "no dedup protection" | ✅ |
| `services/order.service.ts` — parcel status locks | Lock acquire/release caught; degrades to "no lock", doesn't block status updates | ✅ |
| `services/order.service.ts`, `finance`, `pricing`, `notification`, `delivery-rate` — cache read/write/invalidate | All wrapped; fall back to Postgres | ✅ |
| `lib/redisPubSub.ts` — `publishNotification` | Caught and logged | ✅ |
| `lib/sseHub.ts` — subscriber | `subscribe()` only issued after `"ready"` (or `.catch` resets the `subscribed` flag for retry), so the offline-queue removal can't strand it | ✅ |
| `lib/rateLimitStore.ts` — 27 limiters across 13 route files | Not-ready at creation → MemoryStore fallback. **But see Finding 1 for runtime blips.** | ⚠️ |
| `index.ts` startup | Waits for `ready`/`error`/10 s before registering routes; no commands issued while connecting | ✅ |

## Findings

### 1. MEDIUM — Rate limiters now 500 on transient Redis blips

`createRedisRateLimitStore` falls back to `MemoryStore` only if Redis isn't
ready **at limiter creation time** (route registration). If Redis is up at
startup and later blips (restart, failover, network flap), every
`RedisStore.increment` rejects — previously the offline queue absorbed any
reconnect shorter than 3 s and those requests succeeded. express-rate-limit
(v8.5.2) surfaces store errors as **HTTP 500 on every rate-limited route** —
including `/login` — for the duration of the blip. This is the one place the
fail-fast change makes a real-world scenario *worse*, and it affects all 27
limiters.

**Recommendation:** add `passOnStoreError: true` to the `rateLimit({...})`
configs (supported in v8), or wrap `sendCommand` with a fallback. This is a
deliberate fail-open choice — for the login limiter specifically, confirm
you're comfortable that a Redis outage disables login throttling rather than
disabling login.

### 2. LOW — SIGTERM handler can throw on shutdown

`redis.ts:67-70` awaits `redis.quit()` in the SIGTERM handler with no
try/catch. If Redis is disconnected at shutdown, `quit()` now rejects
immediately (offline queue no longer swallows it), producing an unhandled
rejection during graceful shutdown. Wrap it in try/catch.

### 3. INFO — Observability tradeoff in log suppression

Both clients suppress repeat errors until the next successful `connect`. A
*change* in failure cause mid-outage (e.g. ECONNREFUSED → auth error) won't be
logged. Acceptable for this app's scale; noting for the record.

### 4. INFO — Pre-existing nits in touched files (not part of this diff)

- `withRedis()` (`redis.ts:72`) is exported but has zero callers — dead code.
- Typo `redis.ts:66`: "Grageful" → "Graceful".

## Verdict

**Approve with follow-up.** The core change is correct and well-reasoned: the
claim that all call sites degrade gracefully held up under inspection, the SSE
subscribe path is safe because it gates on `"ready"`, and startup behavior is
unchanged. Finding 1 (rate-limiter 500s on blips) is the one behavioral
regression and is worth fixing before or immediately after committing;
Finding 2 is a one-line hardening.
