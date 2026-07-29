# ParcelMoover Partner API v1

Integrate your e-commerce store with ParcelMoover: place delivery orders (including exchanges), track and edit them pre-dispatch, request returns, list shipments, and read your COD/settlement finance data programmatically.

**Base URL**

| Environment | URL |
|---|---|
| Production | `https://portal.parcelmoover.com/api/v1` |
| Local development | `http://localhost:3000/api/v1` |

All requests and responses are JSON (`Content-Type: application/json`).

**Read this online instead:** this whole reference is served as a browsable web page at **`GET /api/v1/docs`**, and a console for trying every endpoint against your own API key lives at **`GET /api/v1/docs/console`**. Neither needs a key to open. The machine-readable OpenAPI 3.1 spec is at **`GET /api/v1/openapi.json`**, also unauthenticated, and is generated from the same validators the API enforces, so it can't drift.

---

## Quick Start

New to this API? This is the fast path to your first order — everything here is covered again in full depth further down; treat this as the on-ramp, not the whole reference.

### Generate an API key {.qs-step}

This is the only credential you actually need to place a first test order. The webhook step further down isn't optional for a real integration, though — see why once you get there.

```diagram
<div class="ui-mock">
  <div class="ui-mock-bar">
    <span class="ui-mock-dot"></span><span class="ui-mock-dot"></span><span class="ui-mock-dot"></span>
    <span class="ui-mock-url">portal.parcelmoover.com/developer/api-keys</span>
  </div>
  <div class="ui-mock-body">
    <div class="ui-mock-nav">
      <div class="ui-mock-nav-item">Dashboard</div>
      <div class="ui-mock-nav-item">Orders</div>
      <div class="ui-mock-nav-item active">Account</div>
      <div class="ui-mock-nav-sub">Profile</div>
      <div class="ui-mock-nav-sub active">Developer</div>
    </div>
    <div class="ui-mock-content">
      <div class="ui-mock-heading">API Keys</div>
      <span class="ui-mock-btn">+ Generate Key</span>
      <div class="ui-mock-secret">
        <code>pm_live_9f2a...c7e1</code>
        <span class="ui-mock-chip">shown once</span>
      </div>
    </div>
  </div>
</div>
```

1. Log into the dashboard as your vendor account owner.
2. Go to **Account → Developer → API Keys tab**.
3. Click **Generate Key** and copy it immediately — `pm_live_...` is shown once and can't be retrieved again if you navigate away.

> Full detail on sending the key, revoking it, and its scope: see [Authentication](#authentication) below.

### Test your connection {.qs-step}

Before building anything real, confirm the key actually works — one call, no side effects, nothing to clean up if you got it wrong:

```bash
curl "https://portal.parcelmoover.com/api/v1/ping" \
  -H "Authorization: Bearer $KEY"
```

```json
{ "success": true, "message": "pong", "data": { "vendorId": "a1c9..." } }
```

A `401` here means the key itself is wrong, expired, or revoked — fix that before debugging anything downstream, since every other endpoint will fail the same way for the same reason. `vendorId` in the response is your own account's id — worth checking once so you know which vendor account a given key belongs to (useful if your team has more than one).

### Make your first request {.qs-step}

Every request needs the key above, plus a client-generated `Idempotency-Key` UUID on any `POST`. This creates a single delivery order:

```bash
BASE="https://portal.parcelmoover.com/api/v1"
KEY="pm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

curl -X POST "$BASE/orders" \
  -H "Authorization: Bearer $KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "receiver": { "name": "Ram Sharma", "phone": "9841234567", "address": "Baneshwor, Kathmandu" },
    "destinationLocationId": "Kathmandu",
    "codAmount": 1500,
    "weightKg": 1.2
  }'
```

You'll get back a `trackingId` — that's what you show your customer and use for every follow-up call. Full field-by-field reference, plus Node.js/Python/PHP equivalents: see [Create an order](#create-an-order) below.

### Set up a webhook (essential for production) {.qs-step}

**Do this before you go live.** The API will technically accept orders without a webhook registered — `POST /orders/statuses` exists for polling — but every real integration needs to know the moment a status changes: delivered, failed, cancelled. Polling on a timer means either hammering the API with requests that come back unchanged, or missing time-sensitive changes between polls. A webhook is the only way to know immediately, and it's what every serious integration ends up building regardless. Treat this step as required, not optional, for anything beyond a first test order.

```diagram
<div class="ui-mock">
  <div class="ui-mock-bar">
    <span class="ui-mock-dot"></span><span class="ui-mock-dot"></span><span class="ui-mock-dot"></span>
    <span class="ui-mock-url">portal.parcelmoover.com/developer/webhooks</span>
  </div>
  <div class="ui-mock-body">
    <div class="ui-mock-nav">
      <div class="ui-mock-nav-item">Dashboard</div>
      <div class="ui-mock-nav-item">Orders</div>
      <div class="ui-mock-nav-item active">Account</div>
      <div class="ui-mock-nav-sub">Developer</div>
      <div class="ui-mock-nav-sub active">Webhooks</div>
    </div>
    <div class="ui-mock-content">
      <div class="ui-mock-heading">Add Endpoint</div>
      <div class="ui-mock-field">
        <label>URL</label>
        <div class="ui-mock-input">https://yourapp.example/webhooks/parcelmoover</div>
      </div>
      <span class="ui-mock-btn">Save Endpoint</span>
      <div class="ui-mock-secret">
        <code>whsec_4b7d...a12f</code>
        <span class="ui-mock-chip">shown once</span>
      </div>
    </div>
  </div>
</div>
```

1. Go to **Account → Developer → Webhooks tab**.
2. Click **Add Endpoint**, name it, and give it your `https://` receiving URL. Developing locally? `localhost` won't be accepted — see [Receiving webhooks locally](#receiving-webhooks-locally) below for the one extra step (a tunnel like ngrok) that fixes this.
3. Copy the secret immediately — `whsec_...` is shown once. You'll use it to verify every delivery's signature.
4. Click **Test** on the endpoint and confirm you get a `succeeded` delivery before wiring up real order flows — see [Testing your endpoint is connected](#testing-your-endpoint-is-connected).

> Full detail — payload shape, signature verification code, a minimal handler, local dev via ngrok, and retry/reliability guarantees: see [Webhooks](#webhooks) below.

### You're integrated

- Try every endpoint live against your own key, no code required: **`GET /api/v1/docs/console`**.
- Full endpoint-by-endpoint reference starts at [Authentication](#authentication) and continues through [Errors](#errors).

---

## Authentication

Every request must carry an API key. A ParcelMoover vendor account owner generates keys from the dashboard: **Sidebar → Account → Developer → API Keys tab → Generate Key** (webhook endpoints live in the **Webhooks** tab right alongside it). The full key (`pm_live_...`) is shown **once** at creation — store it securely.

Send the key on every request:

```
Authorization: Bearer pm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

(`X-API-Key: <key>` is also accepted.)

Orders you create belong to the vendor account that owns the key, and you can only read your own orders. Keys can be revoked at any time from the same dashboard page; a revoked key gets `401` immediately.

**Never** embed the key in browser/mobile client code — call the API from your server only.

### Confirm your key works

```
GET /api/v1/ping
```

Returns `{ "success": true, "message": "pong", "data": { "vendorId": "..." } }` for a valid key, or `401` if it's wrong, expired, or revoked — with zero side effects either way. This is the fastest way to isolate "my key is bad" from "something else is wrong" before debugging further; see [Test your connection](#test-your-connection) in Quick Start for the full walkthrough.

---

## Idempotency

`POST /orders` requires an `Idempotency-Key` header containing a UUID you generate. If the request times out or errors on your side, retry with the **same** key: you will get back the original response instead of a duplicate order. Use a **new** UUID for each distinct order.

```
Idempotency-Key: 9f1b6c1e-8f2a-4b3c-9d4e-5f6a7b8c9d0e
```

---

## Rate limits

Limits are per API key, per minute:

| Operations | Limit |
|---|---|
| Reads (`GET`) | 120/min |
| Writes (`POST`, `PATCH`) | 30/min |
| Bulk status lookup (`POST /orders/statuses`) | 20/min |

Exceeding a limit returns `429` with `{ "success": false, "message": "Too many requests, please slow down", "error": { "code": "RATE_LIMITED" } }`. Standard `RateLimit-*` response headers indicate your remaining quota — back off and retry after the window resets.

---

## Endpoints

### Create an order

```
POST /api/v1/orders
```

Headers: `Authorization`, `Idempotency-Key` (UUID, required), `Content-Type: application/json`.

#### Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `receiver` | object | ✅ | Delivery contact — your customer. |
| `receiver.name` | string | ✅ | 2–100 chars. |
| `receiver.phone` | string | ✅ | **Nepali mobile number only** — 10 digits starting `97` or `98`, with an optional `+977`/`977` country code. `9841234567` and `+9779841234567` are both fine; landlines and non-Nepali numbers are rejected. Must differ from the sender's phone. |
| `receiver.alternatePhone` | string | — | Looser: any 10–15 digits with an optional leading `+`. |
| `receiver.email` | string | — | |
| `receiver.address` | string | — | **Free text, any string** — up to 255 chars, not validated against a real address database or a fixed list. **Required unless `serviceType` is `branch_delivery`** — a home delivery with no street address is rejected. Unlike the destination hub above/below, there's nothing here for ParcelMoover to reject as "unrecognized." |
| `receiver.locationId` | UUID or hub name | — | The receiver's destination branch/hub — same value as `destinationLocationId` below. Setting either one satisfies the destination requirement; the dashboard's own order form sets both. |
| `sender` | object | — | Pickup contact. **Omit it and ParcelMoover fills it from your vendor account's registered pickup profile** (business name, phone, pickup landmark). Provide it only to override — e.g. shipping from a different warehouse. Same fields as `receiver` (`name` and `phone` required when provided; `phone` has the same Nepali-mobile rule). |
| `orderType` | string | — | `delivery` (default), `exchange`, or `return`. On an `exchange` order, ops confirming delivery auto-creates a linked return parcel — it isn't something you create yourself; find it later via `sourceOrderId` on the new parcel (see [Track an order](#track-an-order)). |
| `serviceType` | string | — | `home_delivery` (default) or `branch_delivery`. |
| `pieces` | integer | — | ≥ 1. Number of packages. |
| `weightKg` | number | ✅ | > 0. Billable weight — this is what your rate is quoted against, so it must be sent explicitly rather than defaulted. |
| `codAmount` | number | ✅ | ≥ 0. Cash to collect from the receiver on delivery (NPR). Send `0` explicitly for prepaid orders — the field can't be omitted, so a forgotten COD can never silently ship as prepaid. |
| `packageType` | string | — | Free text, max 50 chars, e.g. `"electronics"`. Defaults to `"Parcel"` if omitted — same as what the dashboard's own order form pre-fills, so an order created via the API looks the same as one created by staff. |
| `deliveryInstruction` | string | — | Max 500 chars. |
| `pickupAddress` | string | — | Max 255 chars. Overrides the sender address for pickup. |
| `scheduledPickupAt` | string | — | ISO-8601 datetime with offset, e.g. `2026-07-15T10:00:00+05:45`. |
| `originLocationId` | UUID | — | Your pickup hub. Optional — vendors normally have one fixed hub, resolved automatically; only set this if you dispatch from more than one. |
| `destinationLocationId` | UUID or hub name | ✅* | The destination branch/hub ("To") — see below for how to pick one. \*Required unless you set `receiver.locationId` instead; one of the two must be present, and sending both (to the same value) is fine. |
| `allowPartialDelivery` | boolean | — | Flags that this shipment (e.g. a multi-item order) may be accepted in part without failing the whole delivery. Informational only — the actual outcome is still reported by the rider/ops side; you read it back via `partialDeliveryRemarks`/`partialCodCollected` on the order once it happens. |

The **delivery charge is computed by ParcelMoover** from your vendor rate agreement — you cannot set it. It appears on the order when you fetch it.

#### Picking a destination (the "To" branch/hub)

**This must be one of ParcelMoover's existing destination hubs — not an arbitrary place name.** You're picking from a fixed, known list of branches/cities ParcelMoover actually delivers to, the same list the dashboard's own order form picks from — you can't ship to a hub that isn't already in our system, and there's no "add a new destination" available through the API.

`destinationLocationId` (and `receiver.locationId`) accept **either** a location UUID **or** the hub's plain name/code — e.g. `"Kathmandu"` or `"POKHARA"`. Matching is an **exact** (case-insensitive) match against `destinationName` or its code, both drawn from `GET /api/v1/rates` — not a fuzzy or partial match, so `"Kathmandu Valley"` or `"KTM"` (unless that's the literal code) will fail even though a human would recognize what you meant. Call [`GET /api/v1/rates`](#rates) once, cache the list of `destinationId`/`destinationName` pairs, and use one of those exact values — that also matches the ParcelMoover Excel rate import's own naming, so it stays in sync automatically as hubs are added. An unrecognized name is rejected immediately with a clear `DESTINATION_NOT_FOUND` error rather than silently accepted:

```json
{ "success": false, "message": "Unknown destination hub: \"Notaplace\". See GET /api/v1/rates for valid names.", "error": { "code": "DESTINATION_NOT_FOUND" } }
```

If you want to show a searchable picker (matching the ParcelMoover dashboard's own order form) or a live shipping-cost estimate before the order is placed, call [`GET /api/v1/rates`](#rates) once to list every valid `destinationName`, and [`GET /api/v1/rates/quote`](#rates) for the price — both also accept the same UUID-or-name value.

**Contrast this with `receiver.address` / `sender.address`, right below** — those are free text with no such restriction. The destination hub is a controlled selection (must already exist in ParcelMoover); the street address underneath it is not (any string you send is stored as-is).

#### Example — cURL

```bash
# $DESTINATION_ID is a destinationId from GET /api/v1/rates — see "Picking a
# destination" above. Everything else here matches the dashboard's own form.
curl -X POST "$BASE/api/v1/orders" \
  -H "Authorization: Bearer $KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "receiver": { "name": "Ram Sharma", "phone": "9841234567", "address": "Baneshwor, Kathmandu", "locationId": "'"$DESTINATION_ID"'" },
    "destinationLocationId": "'"$DESTINATION_ID"'",
    "serviceType": "home_delivery",
    "codAmount": 1500,
    "pieces": 1,
    "weightKg": 1.2,
    "deliveryInstruction": "Call before delivery"
  }'
```

#### Example — Node.js (18+, no dependencies)

```js
const BASE = process.env.PARCELMOOVER_BASE_URL; // e.g. "https://…/api/v1"
const KEY  = process.env.PARCELMOOVER_API_KEY;

// destinationId comes from GET /api/v1/rates — see "Picking a destination" above.
const destinationId = "a350d017-18a6-4610-835c-bc9929a5fb23"; // e.g. POKHARA

const res = await fetch(`${BASE}/orders`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${KEY}`,
    "Idempotency-Key": crypto.randomUUID(), // persist this to retry safely
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    receiver: { name: "Ram Sharma", phone: "9841234567", address: "Baneshwor, Kathmandu", locationId: destinationId },
    destinationLocationId: destinationId,
    serviceType: "home_delivery",
    codAmount: 1500,
    pieces: 1,
    weightKg: 1.2,
    deliveryInstruction: "Call before delivery",
  }),
});

const body = await res.json();
if (!res.ok) throw new Error(`ParcelMoover ${res.status}: ${body.message}`);
console.log(body.data.trackingId); // "PM-260713-GFQK93S5YN894-Q"
```

#### Example — Python (`pip install requests`)

```python
import os, uuid, requests

BASE = os.environ["PARCELMOOVER_BASE_URL"]  # e.g. "https://…/api/v1"
KEY  = os.environ["PARCELMOOVER_API_KEY"]

# destination_id comes from GET /api/v1/rates — see "Picking a destination" above.
destination_id = "a350d017-18a6-4610-835c-bc9929a5fb23"  # e.g. POKHARA

resp = requests.post(
    f"{BASE}/orders",
    headers={
        "Authorization": f"Bearer {KEY}",
        "Idempotency-Key": str(uuid.uuid4()),  # persist this to retry safely
    },
    json={
        "receiver": {"name": "Ram Sharma", "phone": "9841234567", "address": "Baneshwor, Kathmandu", "locationId": destination_id},
        "destinationLocationId": destination_id,
        "serviceType": "home_delivery",
        "codAmount": 1500,
        "pieces": 1,
        "weightKg": 1.2,
        "deliveryInstruction": "Call before delivery",
    },
    timeout=30,
)

body = resp.json()
if not resp.ok:
    raise RuntimeError(f"ParcelMoover {resp.status_code}: {body['message']}")
print(body["data"]["trackingId"])  # "PM-260713-GFQK93S5YN894-Q"
```

#### Example — PHP (7.4+, built-in cURL extension)

```php
<?php
function uuidv4(): string {
    $d = random_bytes(16);
    $d[6] = chr(ord($d[6]) & 0x0f | 0x40);
    $d[8] = chr(ord($d[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
}

$base = getenv('PARCELMOOVER_BASE_URL'); // e.g. "https://…/api/v1"
$key  = getenv('PARCELMOOVER_API_KEY');
// destinationId comes from GET /api/v1/rates — see "Picking a destination" above.
$destinationId = 'a350d017-18a6-4610-835c-bc9929a5fb23'; // e.g. POKHARA

$ch = curl_init("$base/orders");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_HTTPHEADER     => [
        "Authorization: Bearer $key",
        'Idempotency-Key: ' . uuidv4(), // persist this to retry safely
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode([
        'receiver' => ['name' => 'Ram Sharma', 'phone' => '9841234567', 'address' => 'Baneshwor, Kathmandu', 'locationId' => $destinationId],
        'destinationLocationId' => $destinationId,
        'serviceType' => 'home_delivery',
        'codAmount' => 1500,
        'pieces'    => 1,
        'weightKg'  => 1.2,
        'deliveryInstruction' => 'Call before delivery',
    ]),
]);

$body   = json_decode(curl_exec($ch), true);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

if ($status >= 400) {
    throw new RuntimeException("ParcelMoover $status: {$body['message']}");
}
echo $body['data']['trackingId']; // "PM-260713-GFQK93S5YN894-Q"
```

#### Response — `201 Created`

```json
{
  "success": true,
  "message": "Order created successfully",
  "data": {
    "id": "59d2df43-1463-42f4-a571-6c514a31f451",
    "trackingId": "PM-260713-GFQK93S5YN894-Q",
    "status": "pickup_ordered",
    "createdAt": "2026-07-13T08:07:18.497Z"
  }
}
```

Save the `trackingId` — it is the handle for tracking, and what you show your customer.

---

### Track an order

```
GET /api/v1/orders/{trackingId}
```

Returns the full current state of one of **your** orders, including remarks and the complete status timeline. An order that isn't yours returns `404`. This is for on-demand lookups and reconciliation, not a status-sync loop — register a [webhook](#webhooks) for that instead.

#### Example

```bash
curl "$BASE/api/v1/orders/PM-260713-GFQK93S5YN894-Q" -H "Authorization: Bearer $KEY"
```

```js
// Node.js
const res = await fetch(`${BASE}/orders/${trackingId}`, {
  headers: { "Authorization": `Bearer ${KEY}` },
});
const body = await res.json();
if (!res.ok) throw new Error(`ParcelMoover ${res.status}: ${body.message}`);
console.log(body.data.status); // e.g. "picked_up"
```

```python
# Python
resp = requests.get(
    f"{BASE}/orders/{tracking_id}",
    headers={"Authorization": f"Bearer {KEY}"},
    timeout=30,
)
body = resp.json()
if not resp.ok:
    raise RuntimeError(f"ParcelMoover {resp.status_code}: {body['message']}")
print(body["data"]["status"])  # e.g. "picked_up"
```

```php
// PHP
$ch = curl_init("$base/orders/$trackingId");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_HTTPHEADER     => ["Authorization: Bearer $key"],
]);
$body = json_decode(curl_exec($ch), true);
curl_close($ch);
echo $body['data']['status']; // e.g. "picked_up"
```

#### Response — `200 OK` (abridged)

```json
{
  "success": true,
  "data": {
    "id": "59d2df43-…",
    "orderNumber": 658266,
    "trackingId": "PM-260713-GFQK93S5YN894-Q",
    "status": "picked_up",
    "orderType": "delivery",
    "serviceType": "dtd",
    "senderName": "My Store",
    "senderPhone": "9810000005",
    "receiverName": "Ram Sharma",
    "receiverPhone": "9841234567",
    "receiverAddress": "Baneshwor, Kathmandu",
    "origin": "Kathmandu Hub",
    "destination": "Baneshwor, Kathmandu",
    "pieces": 1,
    "weightKg": 1.2,
    "attemptCount": 0,
    "codAmount": 1500,
    "deliveryCharge": 100,
    "packageType": "Parcel",
    "deliveryInstruction": "Call before delivery",
    "allowPartialDelivery": false,
    "partialDeliveryRemarks": null,
    "partialCodCollected": null,
    "sourceOrderId": null,
    "statusHistory": [
      {
        "oldStatus": "pickup_ordered",
        "newStatus": "picked_up",
        "remarks": "",
        "changedBy": "Kathmandu Hub",
        "changedByType": "branch",
        "createdAt": "13 Jul 2026, 2:15 PM"
      }
    ],
    "remarks": []
  }
}
```

---

### List your orders

```
GET /api/v1/orders?status=<status[,status]>&page=<n>&pageSize=<1-100>
```

| Query param | Notes |
|---|---|
| `page` | Default `1`. |
| `pageSize` | Default `20`, max `100`. |
| `status` | Optional filter; comma-separated, e.g. `status=delivered,cancelled`. |

#### Example

```bash
curl "$BASE/api/v1/orders?status=sent_for_delivery&page=1&pageSize=50" -H "Authorization: Bearer $KEY"
```

```js
// Node.js
const params = new URLSearchParams({ status: "sent_for_delivery", page: "1", pageSize: "50" });
const res = await fetch(`${BASE}/orders?${params}`, {
  headers: { "Authorization": `Bearer ${KEY}` },
});
const { data, meta } = await res.json();
console.log(`${data.length} of ${meta.total} orders`);
```

```python
# Python
resp = requests.get(
    f"{BASE}/orders",
    headers={"Authorization": f"Bearer {KEY}"},
    params={"status": "sent_for_delivery", "page": 1, "pageSize": 50},
    timeout=30,
)
body = resp.json()
print(f"{len(body['data'])} of {body['meta']['total']} orders")
```

```php
// PHP
$query = http_build_query(['status' => 'sent_for_delivery', 'page' => 1, 'pageSize' => 50]);
$ch = curl_init("$base/orders?$query");
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_HTTPHEADER     => ["Authorization: Bearer $key"],
]);
$body = json_decode(curl_exec($ch), true);
curl_close($ch);
printf("%d of %d orders", count($body['data']), $body['meta']['total']);
```

#### Response — `200 OK`

```json
{
  "success": true,
  "data": [ { "...same shape as the track endpoint's summary fields..." } ],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 42,
    "totalPages": 3,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

---

### Edit an order (pre-dispatch only)

```
PATCH /api/v1/orders/{trackingId}
```

Headers: `Authorization`, `Idempotency-Key` (UUID, required), `Content-Type: application/json`.

Corrects details on an order that's still in your hands — including a receiver address/phone "redirect" before it's ever dispatched. Accepts the same fields as create (minus `sender`/`pickupAddress`/`scheduledPickupAt`): `receiver`, `originLocationId`, `destinationLocationId`, `orderType`, `serviceType`, `pieces`, `weightKg`, `codAmount`, `packageType`, `deliveryInstruction` — at least one is required.

Only works from `pickup_ordered`, `rider_assigned`, or `failed_pickup` — the same window [cancel](#cancel-an-order) allows. Once the order is picked up and moving through the network, this returns `409` ("contact support to change it").

#### Example — cURL

```bash
curl -X PATCH "$BASE/api/v1/orders/PM-260713-GFQK93S5YN894-Q" \
  -H "Authorization: Bearer $KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "receiver": { "name": "Ram Sharma", "phone": "9841234567", "address": "New Baneshwor, Kathmandu" }
  }'
```

#### Response — `200 OK`

```json
{
  "success": true,
  "message": "Order updated",
  "data": {
    "id": "59d2df43-1463-42f4-a571-6c514a31f451",
    "trackingId": "PM-260713-GFQK93S5YN894-Q",
    "status": "pickup_ordered",
    "updatedAt": "2026-07-23T09:12:00.000Z"
  }
}
```

---

### Request a return

```
POST /api/v1/orders/{trackingId}/return-request
```

Headers: `Authorization`, `Idempotency-Key` (UUID, required), `Content-Type: application/json`.

Opens a **pending request for ops staff to review** — it does not itself move the order through the return-to-vendor workflow (`follow_up` → `ready_to_return` → `sent_to_vendor` → `returned_to_vendor`), which stays staff-managed. Track its resolution via `GET /tickets/{id}` using the `ticketId` in the response, or watch the order's own `status`/your [webhook](#webhooks) for the RTO stages once staff act on it. Returns `409` if the order is already `cancelled` or `returned_to_vendor`.

#### Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `reason` | string | ✅ | 3–500 chars. |
| `notes` | string | — | Max 2000 chars. |

#### Example — cURL

```bash
curl -X POST "$BASE/api/v1/orders/PM-260713-GFQK93S5YN894-Q/return-request" \
  -H "Authorization: Bearer $KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Customer refused package", "notes": "Left at the door, customer unreachable" }'
```

#### Response — `201 Created`

```json
{
  "success": true,
  "message": "Return request submitted",
  "data": { "id": "8b1e...", "ticketId": "TKT-260723-AB12CD", "status": "pending" }
}
```

---

### Cancel an order

```
POST /api/v1/orders/{trackingId}/cancel
```

Headers: `Authorization`, `Idempotency-Key` (UUID, required).

Only works while the order hasn't been picked up yet — status `pickup_ordered`, `rider_assigned`, or `failed_pickup`. Once it's moved past that, this returns `409`/`422` instead — reach out through [order comments](#order-comments) or a [support ticket](#support-tickets) if you need to intervene on a later stage.

#### Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `reason` | string | — | Max 500 chars. Recorded as a remark on the order. |

#### Example

```bash
curl -X POST "$BASE/api/v1/orders/PM-260713-GFQK93S5YN894-Q/cancel" \
  -H "Authorization: Bearer $KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Customer cancelled before dispatch" }'
```

#### Response — `200 OK`

```json
{
  "success": true,
  "message": "Order cancelled",
  "data": { "trackingId": "PM-260713-GFQK93S5YN894-Q", "status": "cancelled" }
}
```

---

### Bulk status lookup

```
POST /api/v1/orders/statuses
```

Look up the current status of up to 100 orders in a single call — for reconciliation, not a substitute for [webhooks](#webhooks). Tracking IDs that don't exist or aren't yours come back in `notFound` instead of failing the whole request.

#### Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `trackingIds` | string[] | ✅ | 1–100 tracking IDs. |

#### Example

```bash
curl -X POST "$BASE/api/v1/orders/statuses" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{ "trackingIds": ["PM-260713-GFQK93S5YN894-Q", "PM-NOPE-00000000000-X"] }'
```

#### Response — `200 OK`

```json
{
  "success": true,
  "data": [
    { "trackingId": "PM-260713-GFQK93S5YN894-Q", "status": "delivered", "updatedAt": "2026-07-22T11:16:28.210Z" }
  ],
  "notFound": ["PM-NOPE-00000000000-X"]
}
```

---

## Rates

Two read-only endpoints for pricing your own shipments — no order needed.

### Your rate card

```
GET /api/v1/rates
```

Returns your full rate card — the home-delivery and branch-delivery base rate to every active destination, under your own rate agreement (flat, zone, or per-destination, whichever ParcelMoover has configured for your account).

#### Example

```bash
curl "$BASE/api/v1/rates" -H "Authorization: Bearer $KEY"
```

#### Response — `200 OK` (abridged)

```json
{
  "success": true,
  "data": {
    "rateType": "flat",
    "freeWeightKg": 2,
    "extraWeightPercent": 5,
    "rates": [
      { "destinationId": "a350d017-...", "destinationName": "POKHARA", "zone": "urban_areas", "valley": "outside", "homeRate": 150, "branchRate": 150, "note": null }
    ]
  }
}
```

### Quote a single destination

```
GET /api/v1/rates/quote?destinationLocationId=<uuid>&weightKg=<n>&serviceType=<home_delivery|branch_delivery>
```

Use this to show a shipping cost estimate before checkout, without creating an order.

| Query param | Required | Notes |
|---|---|---|
| `destinationLocationId` | ✅ | A destination id **or** hub name (e.g. `Kathmandu`) — get one from `GET /api/v1/rates` above, or just pass the name directly. |
| `weightKg` | — | Default `1`. |
| `serviceType` | — | `home_delivery` (default) or `branch_delivery`. |

#### Example

```bash
curl "$BASE/api/v1/rates/quote?destinationLocationId=a350d017-...&weightKg=3" -H "Authorization: Bearer $KEY"
```

#### Response — `200 OK`

```json
{
  "success": true,
  "data": {
    "baseCharge": 150,
    "weightSurcharge": 7.5,
    "totalPayable": 157.5,
    "freeWeightKg": 2,
    "rateType": "flat",
    "basis": "Flat home rate (outside valley)",
    "valley": "outside"
  }
}
```

---

## Order comments

A lightweight, threaded comment log on an order — visible to both you and ParcelMoover ops. Use it for delivery instructions raised after the fact, or clarifying an address with support, without opening a full ticket.

### Read the comment thread

```
GET /api/v1/orders/{trackingId}/remarks
```

#### Example

```bash
curl "$BASE/api/v1/orders/PM-260713-GFQK93S5YN894-Q/remarks" -H "Authorization: Bearer $KEY"
```

### Add a comment

```
POST /api/v1/orders/{trackingId}/remarks
```

Headers: `Authorization`, `Idempotency-Key` (UUID, required).

| Field | Type | Required | Notes |
|---|---|---|---|
| `remark` | string | ✅ | 1–2000 chars. |
| `parentRemarkId` | UUID | — | Reply to an existing remark from the thread above. |

#### Example

```bash
curl -X POST "$BASE/api/v1/orders/PM-260713-GFQK93S5YN894-Q/remarks" \
  -H "Authorization: Bearer $KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{ "remark": "Please deliver after 5pm — customer is at work until then" }'
```

#### Response — `201 Created`

```json
{
  "success": true,
  "message": "Remark added",
  "data": {
    "id": "a8d1c6f5-...",
    "remark": "Please deliver after 5pm — customer is at work until then",
    "addedBy": "My Store",
    "createdAt": "2026-07-22T13:55:20.526Z",
    "parentRemarkId": null,
    "parentAuthor": null,
    "parentSnippet": null
  }
}
```

---

## Support tickets

Raise and track support tickets programmatically instead of using the dashboard.

### Open a ticket

```
POST /api/v1/tickets
```

Headers: `Authorization`, `Idempotency-Key` (UUID, required).

| Field | Type | Required | Notes |
|---|---|---|---|
| `subject` | string | ✅ | 3–200 chars. |
| `category` | string | — | Max 50 chars, e.g. `"pickup"`, `"delivery"`, `"cod_settlement"`. |
| `priority` | string | — | `low`, `medium`, `high`, or `urgent`. |
| `description` | string | — | Max 2000 chars. |
| `customerName` / `customerPhone` | string | — | If the ticket concerns a specific customer. |

#### Example

```bash
curl -X POST "$BASE/api/v1/tickets" \
  -H "Authorization: Bearer $KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{ "subject": "Wrong COD amount on PM-260713-GFQK93S5YN894-Q", "category": "cod_settlement", "priority": "high" }'
```

#### Response — `201 Created`

```json
{
  "success": true,
  "message": "Ticket created",
  "data": {
    "id": "195d1bd1-...",
    "ticketId": "TKT-260722-DAMMDS",
    "subject": "Wrong COD amount on PM-260713-GFQK93S5YN894-Q",
    "category": "cod_settlement",
    "priority": "high",
    "status": "pending",
    "assignedTo": "Unassigned",
    "createdAt": "2026-07-22"
  }
}
```

### List, read, and reply

```
GET  /api/v1/tickets                — list your tickets (filters: status, priority, category, fromDate, toDate, page, pageSize)
GET  /api/v1/tickets/{id}           — ticket detail + reply thread
POST /api/v1/tickets/{id}/replies   — add a reply (Idempotency-Key required; body: { "message": "..." })
```

---

## Finance

Read-only endpoints mirroring the dashboard's Finance views — always scoped to your own vendor account. There is no create/edit-settlement endpoint here; recording a payment against a statement stays an admin-only dashboard action.

```
GET /api/v1/finance/pending-cod                        — your current pending COD statement
GET /api/v1/finance/order-cod?status=&page=&pageSize=   — per-order COD payment status (status: settled | not_settled)
GET /api/v1/finance/settlements?fromDate=&toDate=&page=&pageSize=  — your settlement statements
GET /api/v1/finance/settlements/{id}                    — line-item detail of one statement
GET /api/v1/finance/unsettled-orders                    — orders with COD collected but not yet settled
```

#### Example — cURL

```bash
curl "$BASE/api/v1/finance/pending-cod" -H "Authorization: Bearer $KEY"
```

#### Response — `200 OK` (abridged, `pending-cod`)

```json
{
  "success": true,
  "data": {
    "vendor": { "id": "...", "name": "My Store", "phone": "9810000005", "email": null, "address": null },
    "statementDate": "2026-07-23T09:00:00.000Z",
    "items": [
      { "orderNumber": 658266, "trackingId": "PM-260713-GFQK93S5YN894-Q", "receiverName": "Ram Sharma", "receiverPhone": "9841234567", "destination": "Baneshwor, Kathmandu", "codAmount": 1500, "deliveryCharge": 100 }
    ],
    "totals": { "totalCod": 1500, "deliveryCharges": 100, "payableAmount": 1400 }
  }
}
```

---

## Order statuses

An order moves through these `status` values:

| Status | Meaning |
|---|---|
| `pickup_ordered` | Order received; awaiting rider assignment. |
| `rider_assigned` | A pickup rider has been assigned. |
| `picked_up` | Parcel collected from the sender. |
| `arrived` | Arrived at the origin hub. |
| `dispatched` / `arrived_at_branch` | Moving between branches. |
| `ready_to_deliver` / `sent_for_delivery` | Out for delivery. |
| `delivered` | Delivered; COD (if any) collected. |
| `partially_delivered` | Delivered with partial COD collection — see `partialDeliveryRemarks`/`partialCodCollected` on the order, or `allowPartialDelivery` if you flagged this shipment as partial-delivery-eligible at creation. |
| `failed_pickup` / `failed_delivery` | Attempt failed; will be retried or followed up. |
| `hold` | Temporarily held — see remarks. |
| `oov` | Out of coverage — handed to a partner carrier for the last leg. |
| `follow_up`, `ready_to_return`, `sent_to_vendor`, `returned_to_vendor` | Return-to-vendor flow, driven by ops staff — not something you move through the API directly. A [return request](#request-a-return) only opens a pending review; staff then advance these stages from the dashboard. |
| `cancelled` | Order cancelled. |
| `loss_and_damage` | Reported lost or damaged. |

**Register a webhook** (see below) to be notified the moment an order's status changes — that's the supported way to keep your system in sync, and it's the only one that doesn't cost you a standing polling loop. `GET /orders/{trackingId}` still exists for on-demand lookups (a support agent checking one order, or reconciling after your webhook endpoint was down) — it's not meant to be called on a timer.

---

## Webhooks

**Set this up before going to production.** It's not enforced by the API — you can create and track orders with nothing but the endpoints above — but every real integration ends up needing this: it's the only way to learn about a status change (delivered, failed, cancelled) the moment it happens, instead of discovering it late on a poll or missing it between polls entirely.

Register an endpoint from your dashboard — sidebar **Account → Developer → Webhooks tab** (`/developer/webhooks`), or via `POST /api/webhooks` (session-authenticated — this is a dashboard-side call, not part of `/api/v1`) — and we'll POST a signed event to it every time one of your orders' status changes.

### Payload

```json
{
  "id": "b6f2...",
  "type": "order.status_changed",
  "created_at": "2026-07-22T09:15:00.000Z",
  "data": {
    "trackingId": "PM123456",
    "orderId": "b6f2...",
    "vendorId": "a1c9...",
    "oldStatus": "sent_for_delivery",
    "newStatus": "delivered",
    "changedAt": "2026-07-22T09:15:00.000Z"
  }
}
```

### Verifying the signature

Every request carries:

- `X-ParcelMoover-Event` — the event type (currently always `order.status_changed`, plus `webhook.test` for test pings sent from the dashboard).
- `X-ParcelMoover-Delivery` — a UUID identifying this event, **the same value as the payload's own `id` field**. It stays identical across every retry of the same event, so either one works as your dedup key.
- `X-ParcelMoover-Signature` — `t=<unix_seconds>,v1=<hex_hmac_sha256>`, where the HMAC is computed over `"<t>.<raw_request_body>"` using your endpoint's secret (shown once when you create the endpoint).

```js
const crypto = require("crypto");

function verifyParcelMooverSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  const parts = Object.fromEntries(signatureHeader.split(",").map((p) => p.split("=")));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false; // stale/replayed

  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1 || "", "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

Always verify against the **raw** request body (before your framework parses it as JSON) — re-serializing and comparing JSON can produce a different byte sequence than what was signed.

### A minimal handler (Node/Express)

```js
const express = require("express");
const app = express();

// express.raw(), not express.json() - signature verification needs the exact
// bytes ParcelMoover sent, not a re-serialized copy of the parsed object.
app.post("/webhooks/parcelmoover", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.headers["x-parcelmoover-signature"];
  if (!verifyParcelMooverSignature(req.body, signature, process.env.PARCELMOOVER_WEBHOOK_SECRET)) {
    return res.status(401).end();
  }

  const event = JSON.parse(req.body);

  // Respond first - see "Retries" below for why a slow response counts as a
  // failure. Do the real work (enqueue, update your DB, etc.) after this.
  res.status(200).end();

  console.log(event.type, event.data.trackingId, event.data.newStatus);
});

app.listen(4000);
```

`verifyParcelMooverSignature` is the function defined above. Whatever port you pick here (`4000` above) is what you'll point a tunnel at in the next section if you're developing locally.

### Receiving webhooks locally

Every webhook you register is checked against the **same hosted API** as everywhere else in this doc (`https://portal.parcelmoover.com`) — so `http://localhost:4000` is never accepted as an endpoint URL, even while you're still developing on your own machine. ParcelMoover's servers have to reach yours over the public internet, so registration always requires a real, publicly reachable `https://` URL.

The standard fix is a tunnel that exposes your local server on a public HTTPS URL — [ngrok](https://ngrok.com) is the most common:

```bash
# Point this at whatever port your handler above is listening on
ngrok http 4000
```

ngrok prints a forwarding URL that looks like `https://a1b2-203-0-113-1.ngrok-free.app`. Register `https://a1b2-203-0-113-1.ngrok-free.app/webhooks/parcelmoover` as your endpoint URL — the `/webhooks/parcelmoover` path is just a convention matching the handler above, not a requirement; use whatever path your app actually listens on. Any HTTPS tunnel works the same way (Cloudflare Tunnel, localtunnel, etc.); ngrok is just the one most people already have.

> On ngrok's free tier the forwarding URL changes every time you restart it. Update your registered endpoint URL each time you restart the tunnel, or deliveries will start bouncing with a connection error until you do.

### Testing your endpoint is connected

Once registered, confirm the whole path works before wiring up real order flows:

1. Open the endpoint in the dashboard and click **Test** (or `POST /api/webhooks/{id}/test`) — this queues a synthetic `webhook.test` event through the exact same delivery pipeline real events use.
2. Check your own server logs, or ngrok's local request inspector at `http://127.0.0.1:4040`, to confirm the `POST` actually arrived.
3. Check the endpoint's **Deliveries** list in the dashboard (or `GET /api/webhooks/{id}/deliveries`) for the result — a `succeeded` row with a `2xx` status code means you're fully connected, signature check included.

| What you see | What it means |
|---|---|
| No delivery row appears at all | The test didn't queue — make sure you clicked **Test** on the endpoint you actually registered. |
| `last_error` mentions a connection failure or timeout | ParcelMoover couldn't reach the URL — the tunnel isn't running, the port doesn't match, or the URL is a stale ngrok session from an earlier restart. |
| `last_status_code` is non-2xx (e.g. `401`, `500`) | Your handler received the request but rejected or errored on it. `401` almost always means signature verification failed — check you're verifying the raw body, not `req.body` from `express.json()`. `500` means your handler threw before responding. |
| `succeeded` with a `2xx` code | You're connected end-to-end. |

A failed test retries on the same backoff schedule as real events (see [Retries](#retries) below) — you don't have to wait it out. Fix the issue and click **Test** again, or manually retry that one delivery from the Deliveries list.

### Delivery guarantees

Webhooks are **at-least-once, not exactly-once, and not ordered**:

- **Expect duplicates.** A delivery is retried whenever we can't confirm success — including when your server *did* process it but the response was lost (a timeout, a network blip, your load balancer dropping the connection). Make your handler idempotent, keyed on the delivery id described above, rather than assuming a fresh id on every call.
- **Expect out-of-order arrival.** Two events for the *same* order can be delivered out of order if the earlier one hits a slow retry cycle while a later one succeeds on the first attempt. Don't treat "most recently received" as "most recent state" — compare `data.changedAt` (or trust `data.newStatus` only if it's ahead of what you already have) instead of blindly overwriting on every webhook.
- **Expect the occasional gap.** If your endpoint is down long enough to exhaust the retry window below, that one event is gone for good — retries don't continue past 12 attempts. Poll `POST /orders/statuses` periodically regardless of whether you use webhooks, so a missed event self-heals instead of leaving your system stuck on a stale status.

### Retries

A non-2xx response (or a request we can't complete within 10s) is retried with exponential backoff — roughly 30s, 1m, 2m, 4m, ... capped at 6h between attempts, for up to 12 attempts spanning about 24 hours. Return `2xx` promptly — do the actual processing after responding if it's slow, since a slow response counts toward the same 10s timeout as a failed one.

If an endpoint fails its **entire** retry window five separate times in a row (so, on the order of days of continuous failure with no successful delivery in between), it's automatically disabled and you'll get an email at your account's registered address — delivery of new events stops until you fix and re-enable it from the dashboard (which also resets the failure count). Re-enabling does **not** replay what was missed while disabled; reconcile with `POST /orders/statuses` after fixing it.

---

## Errors

Every error is JSON with this shape:

```json
{
  "success": false,
  "message": "Human-readable explanation",
  "error": { "code": "STABLE_MACHINE_READABLE_CODE" }
}
```

`error.code` is safe to branch your integration logic on — it won't change even if we reword `message`. Validation failures (`400`) additionally include `error.fields`:

```json
{
  "success": false,
  "message": "Validation failed",
  "error": {
    "code": "VALIDATION_ERROR",
    "fields": [ { "field": "receiver.phone", "message": "Enter a valid Nepali mobile number (e.g. 98XXXXXXXX)" } ]
  }
}
```

| HTTP status | `error.code` | Meaning |
|---|---|---|
| `400` | `VALIDATION_ERROR` | Malformed request — missing/invalid fields, missing or non-UUID `Idempotency-Key`. |
| `401` | `UNAUTHORIZED` | Missing, invalid, or revoked API key. |
| `403` | `FORBIDDEN` | Not allowed for this vendor. |
| `404` | `NOT_FOUND` | Order/ticket not found (or not yours), or unknown endpoint. |
| `409` | `CONFLICT` | E.g. an `Idempotency-Key` replayed with a *different* body, or the order is already in a terminal status. |
| `422` | `VALIDATION_ERROR` | Request understood but not processable (invalid status transition, business-rule rejection). |
| `429` | `RATE_LIMITED` | Rate limit exceeded — back off and retry. |
| `500` | `INTERNAL_ERROR` | Server error — safe to retry a `POST` with the same `Idempotency-Key`. |

---

## OpenAPI spec

The full request/response schema for every endpoint above, generated straight from the same validation the API runs — so it can never drift from what's actually enforced:

```
GET /api/v1/openapi.json
```

No API key required to fetch it. Paste the URL into [Swagger Editor](https://editor.swagger.io) or Postman's "Import from link" for a browsable, interactive version, or feed it to an OpenAPI code generator for a typed client in your language of choice.

---

## Integration checklist

1. Generate an API key from the vendor dashboard and store it server-side (env var / secrets manager — never in client code).
2. Call `GET /ping` once to confirm the key works before writing any other integration code.
3. On checkout/fulfilment, `POST /orders` with a fresh UUID `Idempotency-Key`; persist the returned `trackingId` against your order.
4. Retry failed creates (network error, `5xx`) with the **same** `Idempotency-Key` — extend the same pattern to cancel, remarks, and ticket calls.
5. **Register a webhook endpoint before going live** and verify `X-ParcelMoover-Signature` on every request before trusting the payload; that's how you sync status back to your system without polling. Show the returned `trackingId` to your customer at creation time.
6. Use `GET /orders/{trackingId}` and `POST /orders/statuses` only for on-demand lookups or reconciliation (e.g. catching up after your webhook endpoint was down) — not as a scheduled polling loop.
7. Handle `401` by alerting yourself (key revoked/rotated) and `429` with exponential backoff; branch on `error.code` rather than parsing `message` text.
8. Rotate keys periodically: generate a new key, switch traffic, then revoke the old one (up to 5 active keys per account).
