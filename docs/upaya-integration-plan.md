# Upaya Integration — Second Outside-Valley Carrier

ParcelMoover already hands outside-valley parcels to NCM as a 3PL (see
`docs/ncm-integration-plan.md`). Upaya is a second, parallel carrier used the
same way — ops picks NCM or Upaya per parcel at handoff. This integration
was built from two partial reference PDFs (a Client API doc and a webhook
doc), then corrected against the real API once credentials existed — several
things the PDFs implied turned out to be wrong or incomplete. Both stages are
recorded below rather than pretending the first guess was right all along.

## What the PDFs got wrong (found by testing against the real API)

- **`GET /client/locations`'s real response bears no resemblance to the
  documented schema.** The PDF showed `{ locationId, locationName, address }`
  and described it as "client locations." The real response is an envelope
  `{ meta, data: [...] }` where `data` is **Upaya's entire serviceable
  network** — ~800 localities nationwide, each with a nested `areas` array
  (~5,759 areas total), e.g.:
  ```json
  { "id": 1525, "name": "Lazimpat", "hubName": "Kathmandu Hub",
    "areas": [{ "id": 9348, "name": "Lazimpat", "locationId": 1525,
                "isActive": true, "deliveryService": true, "codService": true }] }
  ```
  Crucially, **an area's own `id` is exactly the `area_id` Add Order wants.**
  The PDF's incomplete schema made it look like there was no way to look this
  up at all; there is, it's just nested here rather than a separate "areas"
  endpoint. This removed the need for an admin-maintained area table
  entirely — see "Design" below.
- **Add Order's real request needs `weight`, not `initial_weight`.** The
  PDF's own sample body is internally inconsistent (one of its three example
  orders uses `weight`, the other two use `initial_weight`); the field the
  live API actually validates on is `weight`.
- **`product_price` must be ≥ 1** (undocumented) — a `0`/unset value is
  rejected.
- **`order_reference_id` must be alphanumeric** (undocumented) — our
  tracking ids (`PM-260813-...`) have hyphens, which the real API rejects as
  "format is invalid." Sent alphanumeric-only on the way out; parcel
  resolution on webhooks matches the same way on the way back in.
- **`client_note` is effectively required**, not optional as the doc's lack
  of an "(optional)" tag implied — omitting it throws a PHP "Undefined array
  key" error from their backend (HTTP 401, which is also misleading — it's
  not an auth failure).
- **Add Order's success response has no order id at all**, only a tracking
  code: `{ meta, data: { message, data: [{ trackingCode, orderReferenceId }] } }`.
  There's no numeric/opaque id anywhere in it. That tracking code (e.g.
  `KTMKTM8304-1658055`) is also what Track Order's `:orderid` path segment
  actually expects — their own doc's path-variable example
  (`WRL2408001AZSN`) is itself a tracking code, not a number, which now makes
  sense. So `trackingCode` is used as "the order id" everywhere in this
  integration despite the misleading name.
- **`UPAYA_DEFAULT_LOCATION_ID` isn't used by Add Order at all** — the
  `location_id` field only appears in the separate Order Rates (quote)
  endpoint per the docs. An earlier version of this integration wrongly
  required it for every handoff; that requirement is gone. It's also now
  unclear whether `location_id` for Order Rates means "our own origin" (the
  original assumption) or a receiver-side locality (given locations turned
  out to be Upaya's whole network, not "our own registered point") —
  unconfirmed, and irrelevant to handoff either way.

## Two real gaps (confirmed, not doc artifacts)

- **No webhook-registration API.** Unlike NCM's `POST /webhook/register`,
  Upaya's webhook URL (`{PUBLIC_BASE}/api/upaya/webhook/{UPAYA_WEBHOOK_SECRET}`)
  has to be pasted into their merchant portal by hand — see the rollout
  checklist below.
- **No bulk status-check endpoint** (NCM has `POST /orders/statuses` for
  many orders at once). Reconciliation polls `GET /client/track-order/:orderid`
  one order at a time, bounded per sweep.

## Design: schema-free parcel↔order link, same as NCM

- **Durable link**: on handoff, a `parcel_remarks` row is written — `Parcel
  dispatched via Upaya — order #KTMKTM8304-1658055 → Lazimpat`
  (`workflow_status: closed`). Same triple purpose as NCM's: audit trail,
  handoff idempotency, and reconciliation source.
- **Correlation**: `order_reference_id` = `parcels.tracking_id` with
  non-alphanumeric characters stripped, on order create. Unlike NCM (which
  only gets an opaque order id on webhooks and needs a label-endpoint
  fallback), Upaya's webhook payload always echoes `order_reference_id`
  directly — so parcel resolution needs no fallback endpoint, just a
  stripped-tracking-id match (`REGEXP_REPLACE` in SQL) with a Redis cache
  (`upaya:order-parcel:<trackingCode>`, 60-day TTL, populated lazily the
  first time a webhook's own `order_id` is seen) as an accelerator for
  reconcile, which only has the tracking code from the handoff remark.
- **Delivery areas**: fetched live from `GET /client/locations` (the whole
  network, Redis-cached 1h) and flattened into a single searchable list
  (`listUpayaDeliveryAreas`) — the OOV handoff picker searches this directly
  (`SearchableSelect`, capped to 50 rendered results at a time given the
  ~5,759-entry list — see the render cap added to the shared
  `SearchableSelect` component). No admin-maintained table, unlike the
  original (wrong) assumption that one was necessary.
- **Status flow**: `handoffParcelsToUpaya` moves the parcel `oov →
  dispatched` at handoff time — same as NCM and our own "Via Manifest"
  dispatch. From there, Upaya's ~25 webhook status values are classified
  into exactly the two existing carrier-only verbs in `order.service.ts`
  (no new state-mutation logic was added):
  - `applyExternalCarrierStatus` — forward leg, monotonic along `oov →
    dispatched → arrived_at_branch → sent_for_delivery → delivered`.
  - `applyExternalCarrierFollowUp` — one-way exit into our own `follow_up`
    stage (same as NCM's "Sent to Vendor"); from there ops runs the normal
    internal-rider Return-to-Origin ladder, not further carrier webhooks.

## Status mapping

| Upaya webhook `status` | Action |
|---|---|
| `unassigned-pickup`, `assigned-pickup`, `picked-up-by-rider`, `failed-pickup`, `inbound-at-warehouse`, `midmile-sortation`, `prepared-for-transit`, `in-transit-to-hub`, `in-transit` | `applyExternalCarrierStatus` → `dispatched` (no-op — already set at handoff) |
| `received-at-hub`, `ready-for-dispatch` | `applyExternalCarrierStatus` → `arrived_at_branch` |
| `dispatched-with-rider` | `applyExternalCarrierStatus` → `sent_for_delivery` |
| `delivered` | `applyExternalCarrierStatus` → `delivered` (+ `delivered_at`, `cod_collections` upsert) |
| `on-field-failed-delivery`, `followup-for-return` | `applyExternalCarrierFollowUp` → `follow_up` (exits the carrier leg to our own RTO ladder) |
| `hold`, `loss-and-damage`, `cancelled` | **Never auto-applied.** Written as an open (default `pending` `workflow_status`) `parcel_remarks` row so a human reviews it — these have real consequences and shouldn't be driven by a webhook with no signature to authenticate it. |
| `confirmed-for-return`, `out-for-return`, `return-processed-from-hub`, `return-received-at-central-facility`, `on-field-failed-return`, `returned-to-vendor`, `redirected`, `dispose` | Logged as a closed `parcel_remarks` row (informational only) — by this point the parcel has usually already exited onto our own RTO ladder via `follow_up`, so these are Upaya's own progress updates, not events we drive further. |

`update_type: "comment"` webhooks are written as `[Upaya Staff] <comment>`
`parcel_remarks` rows (default `pending`, same as NCM's inbound comment
sync) — Upaya pushes comments via webhook, so unlike NCM this needs no
separate polling sweep.

## Server pieces

- `src/lib/upayaClient.ts` — fetch wrapper: `UPAYA_BASE_URL` + header
  `X-API-Key: UPAYA_API_KEY` (note: different auth header than NCM's
  `Authorization: Token ...`), 10s timeout, one retry on 5xx/network for
  GETs only, best-effort error-body parsing (Upaya's error envelope is
  `{ meta, errors: [{ code, title, detail, source: { pointer } }] }` for
  validation failures, confirmed against the real API).
- `src/services/upaya.service.ts` — `listUpayaLocations` (raw network tree,
  Redis-cached 1h) / `listUpayaDeliveryAreas` (flattened, searchable — what
  the handoff picker uses), `getUpayaOrderRate` (optional quote passthrough,
  `location_id` semantics still unconfirmed), `handoffParcelsToUpaya`
  (idempotent per parcel, takes a caller-chosen `areaId`/`areaName` from the
  live list), `processUpayaWebhook`, `trackUpayaOrder`,
  `reconcileUpayaStatuses`, `getUpayaInfoForParcel`.
- `src/controllers/upaya.controller.ts` + `src/routes/upaya.routes.ts`,
  mounted at `/api/upaya`:
  - `GET  /api/upaya/locations` (admin) — raw network tree, diagnostic
  - `GET  /api/upaya/delivery-areas` (admin) — flattened, what the UI uses
  - `POST /api/upaya/handoff` (admin, CSRF) — body `{parcelIds, areaId, areaName, serviceTypeId, orderType?}`
  - `GET  /api/upaya/parcels/:parcelId` (admin)
  - `POST /api/upaya/reconcile` (admin, CSRF) — manual sweep
  - `POST /api/upaya/webhook/:secret` — public receiver; secret path segment
    (constant-time compare vs `UPAYA_WEBHOOK_SECRET`) is the only auth,
    same as NCM.
- `src/index.ts` — `startUpayaReconciliation()`, Redis-NX-locked sweep every
  30 min, alongside `startNcmReconciliation()`.
- `src/services/order.service.ts` — the settlement COD-bucket SQL
  (`cod_from_upaya`, both the dashboard summary and the per-bucket
  drill-down) now OR's in an `EXISTS` check on the Upaya handoff remark
  prefix, the same way it already does for NCM, alongside the pre-existing
  `carrier_code = 'upaya'` check for the manual "PM Rider U" placeholder
  rider that was the only signal before this integration existed
  (`server/prisma/migrations/20260809180000_add_riders_carrier_code`).

## Client / UI

- OOV page ("Transit" tab) → select parcels → Action → Dispatched → **Via
  3PL (Upaya)** → search-select the delivery area (live, from Upaya's whole
  network) and a service type (the 5 fixed reference values from Upaya's
  docs — Door To Door / Door To Branch / Branch To Branch / Activation /
  Bulk) → Submit. Parcels move to `dispatched` immediately, same as NCM.
- No admin settings page for this — areas are searched live, not curated.

## Local dev / testing

```
cd server && node upaya-mock/server.js   # mock Upaya on :4200
```

The mock predates the real-API discoveries above and still uses the
originally-documented (wrong) shapes in a couple of places (e.g. its
`/client/locations` returns the PDF's flat shape, not the real nested
network) — good enough for exercising the webhook/status-mapping/
reconciliation logic end to end, but don't trust it for payload-shape
questions; those were only settled by testing against the real host.
`UPAYA_BASE_URL`/`UPAYA_API_KEY` can point at either the mock or the real
host depending on what you're testing.

Unlike NCM's mock, this one has no automatic webhook re-registration to
mirror (there's no registration API to call) — point it at your server with
`POST http://localhost:4200/_mock/webhook-url {"url": "..."}` once per mock
restart. Control endpoints: `POST /_mock/orders/:id/advance` (walk the
forward lifecycle one step, firing a webhook), `POST /_mock/orders/:id/status`
(force any status, incl. return-flow/hold/cancelled), `POST
/_mock/orders/:id/comment`, `GET /_mock/state`, `POST /_mock/reset`.

Env (`.env`/`.env.example`): `UPAYA_BASE_URL`, `UPAYA_API_KEY`,
`UPAYA_WEBHOOK_SECRET` (required); `UPAYA_DEFAULT_LOCATION_ID` (optional,
only for the unused-by-handoff rate-quote helper),
`UPAYA_DEFAULT_PRODUCT_CATEGORY_ID` (required for handoff — no basis in our
own parcel data, a single global default is used for every order; confirm
the right value with Upaya before relying on it).

**Verified against the mock** (2026-08-13): handoff (incl. repeat-call
idempotency) moves the parcel to `dispatched` immediately with the correct
`parcel_remarks`/`parcel_status_history`/`audit_logs` rows; webhooks drive
`arrived_at_branch → sent_for_delivery → delivered` (with `cod_collections`
correctly upserted on delivery); an out-of-order/duplicate webhook is
skipped by the monotonic check; a comment webhook lands as a `parcel_remarks`
row; `hold` leaves `parcel_status` untouched and writes an open review
remark instead; `on-field-failed-delivery` correctly exits to `follow_up`;
reconciliation catches a status change Upaya's side had but our webhook
never delivered.

**Verified against the real API** (2026-08-13, once credentials existed):
`GET /client/locations` returns the real ~800-location/~5,759-area network
and flattens correctly; a full handoff for a real Kathmandu-area parcel
(`area_id` 9348, "Lazimpat") succeeded end to end (`weight`, `product_price`
floor, sanitized `order_reference_id`, `client_note` all confirmed correct;
response's `trackingCode` extracted and stored). This did create a real test
order on Upaya's live system — nothing was found to cancel/delete it via
their documented API, so it's just a stray real test order to be aware of,
not a local-only artifact. Automated regression coverage for the
status-classification table and webhook parcel resolution lives in
`src/services/__tests__/upaya.service.test.ts`.

## Rollout checklist (production)

1. Get an API key + confirm the production base URL from Upaya; set
   `UPAYA_BASE_URL`, `UPAYA_API_KEY`, a strong `UPAYA_WEBHOOK_SECRET`.
2. Confirm `UPAYA_DEFAULT_PRODUCT_CATEGORY_ID` against Upaya (their Category
   Id Reference table) — there's no basis for this in our own data, so it
   needs an explicit answer from them, not a guess.
3. Paste the webhook URL (`{PUBLIC_BASE}/api/upaya/webhook/{UPAYA_WEBHOOK_SECRET}`)
   into Upaya's merchant portal by hand — there's no registration API.
4. Dry-run one real parcel end to end (already done once during
   development, above — worth repeating deliberately before making Upaya a
   routine handoff option alongside NCM).
5. COD: Upaya's `cod_amount` is remitted back to us the same way NCM's is
   (via the vendor leg, `remitted_amount`) — wiring remittance into
   settlements beyond the existing COD-bucket accounting is still open, same
   caveat as NCM's rollout checklist.
