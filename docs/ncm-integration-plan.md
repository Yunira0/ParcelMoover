# NCM Integration — Outside-Valley Deliveries

ParcelMoover handles inside-valley logistics itself; parcels destined outside the
valley are handed to NCM (Nepal Can Move). API details live in
`.claude/skills/ncm-api/` (SKILL.md, api-reference.md, webhooks.md).

## Design: deliberately schema-free

NCM may not be a long-term carrier, so the integration adds **no tables or
columns**. The moving parts:

- **Durable link (parcel ↔ NCM order)**: on handoff, a `parcel_remarks` row is
  written — `[NCM] Handed off — order #123 → POKHARA (Branch2Door)`
  (`workflow_status: closed` so it stays out of the remarks work queue). This
  doubles as the user-visible audit trail, powers handoff idempotency, and is
  the source reconciliation rebuilds in-flight orders from.
- **Correlation on NCM's side**: `vref_id = parcels.tracking_id` on order
  create. Given only an NCM order id (e.g. from a webhook), the parcel is
  resolved via a Redis cache (`ncm:order-parcel:<id>`, 60-day TTL) with a
  fallback to NCM's label endpoint, whose `description.vendor_orderid` echoes
  our tracking id.
- **Status flow**: `handoffParcelsToNcm` itself moves the parcel `oov →
  dispatched` at handoff time — same as our own "Via Manifest" dispatch, so
  it shows under the OOV page's "In Transit" tab immediately instead of
  waiting on NCM's pickup webhook. From there, NCM statuses are applied
  through `applyExternalCarrierStatus` (order.service.ts) — a carrier-only
  path that moves a parcel monotonically along
  `oov → dispatched → arrived_at_branch → sent_for_delivery → delivered`,
  writing `parcel_status_history` (remark `NCM: <status>`, `changed_by: null`)
  and `audit_logs`. It deliberately skips internal-ops side effects (run
  sheets, dispatch manifests, rider assignment) that don't exist on a
  3PL-carried leg, and silently skips duplicates, out-of-order events, and
  parcels ops moved elsewhere (hold etc.).

## Status mapping

| NCM webhook event | NCM status | parcel_status |
|---|---|---|
| `pickup_completed` | Pickup Complete | `dispatched` (no-op — already set at handoff) |
| `order_dispatched` | Dispatched | `dispatched` (no-op — already set at handoff) |
| `order_arrived` | Arrived | `arrived_at_branch` |
| `sent_for_delivery` | Sent for Delivery | `sent_for_delivery` |
| `delivery_completed` | Delivered | `delivered` (+ `delivered_at`) |

Pre-pickup statuses don't change the parcel further (it's already
`dispatched`); return-flow statuses (`Sent to Vendor`) are logged but never
auto-applied.

The NCM `delivery_type` defaults from the receiving half of our
`service_type` (`dtd`/`btd` → `Branch2Door`, `dtb`/`btb` → `Branch2Branch`,
we carry parcels to NCM's origin branch), overridable per handoff.

## Server pieces

- `src/lib/ncmClient.ts` — fetch wrapper: `NCM_BASE_URL` + `Token
  NCM_API_TOKEN`, 10 s timeout, NCM error shapes normalized to `AppError`,
  one retry on 5xx/network for GETs only (order create is never retried).
- `src/services/ncm.service.ts` — branches (Redis-cached 1 h),
  `handoffParcelsToNcm` (idempotent per parcel, daily-create-limit guard,
  re-registers the webhook before the batch if there's new work to do —
  non-fatal if it fails, orders still get created), webhook payload
  processing (single + bulk shapes, 409-lock retry), `reconcileNcmStatuses`,
  per-parcel info, webhook registration, `syncRemarkToNcm` (one-way: our
  remark → NCM comment via `POST /api/v1/comment`; fire-and-forget from
  `order.controller.ts`'s `addOrderRemarkController` after the remark is
  saved, so it never blocks or fails the remark itself; no-ops for parcels
  never handed off to NCM).
- `src/routes/ncm.routes.ts` + `src/controllers/ncm.controller.ts`:
  - `GET  /api/ncm/branches` (admin)
  - `POST /api/ncm/handoff` (admin, CSRF) — body `{parcelIds, branch, deliveryType?}`
  - `GET  /api/ncm/parcels/:parcelId` (admin) — NCM order id + live status
  - `POST /api/ncm/reconcile` (admin, CSRF) — manual sweep
  - `POST /api/ncm/webhook/register` (admin + SETTINGS_ACCESS) — body `{publicBaseUrl}`
  - `POST /api/ncm/webhook/:secret` — public receiver; NCM signs nothing, so
    the secret path segment (constant-time compare vs `NCM_WEBHOOK_SECRET`)
    is the auth; Redis rate-limited; acks immediately, processes on next tick.
- `src/index.ts` — Redis-NX-locked reconciliation sweep every 30 min
  (**webhooks are required but not sufficient**: NCM never retries a failed
  delivery, so polling `POST /api/v1/orders/statuses` backfills missed events).

## UI

OOV page → select parcels → Action → Dispatched → **Via 3PL (NCM)** → pick the
NCM destination branch (live branch list) → Submit. Parcels move to
`dispatched` immediately (visible under "In Transit"); the handoff shows up
in the remarks column, and NCM's webhooks carry it the rest of the way to
`delivered`.

## Local dev / testing

```
cd server && node ncm-mock/server.js   # mock NCM on :4100 (NCM_MOCK_TOKEN env)
```

Env (`.env` / `.env.example`): `NCM_BASE_URL`, `NCM_API_TOKEN`,
`NCM_WEBHOOK_SECRET`, `NCM_FROM_BRANCH`, `NCM_WEBHOOK_BASE_URL` (defaults to
`http://localhost:$PORT`, fine for the mock).

The mock's webhook registration lives in that process's memory, so it's lost
every time you restart it — no manual re-registration needed, though, since
`handoffParcelsToNcm` re-asserts it automatically before every batch that has
new orders to create.

Verified end-to-end against the mock (2026-07-07, re-verified 2026-07-07
after the auto-register + immediate-dispatch change): handoff (incl.
repeat-call idempotency) moves the parcel to `dispatched` immediately, then
webhooks drive `arrived_at_branch → sent_for_delivery → delivered` with
history rows; reconciliation catches a parcel whose webhooks were all
missed; wrong webhook secret → 404; `test: true` payloads acked and skipped;
order→parcel resolution works with a cold Redis via the label endpoint.

## Rollout checklist (production)

1. Get vendor token + production base URL from NCM (IT@nepalcanmove.com);
   set `NCM_BASE_URL`, `NCM_API_TOKEN`, a strong `NCM_WEBHOOK_SECRET`, and
   `NCM_FROM_BRANCH` (our hub's branch name in NCM's system).
2. `POST /api/ncm/webhook/register` with the public HTTPS base URL, then use
   NCM's webhook-test endpoint/portal button to confirm delivery.
3. Dry-run one real parcel end to end before making 3PL handoff routine.
4. COD: NCM's `cod_charge` includes their delivery fee and NCM remits via
   COD-transfer tickets — wiring remittance into settlements is still open.
