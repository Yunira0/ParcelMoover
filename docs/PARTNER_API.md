# ParcelMoover Partner API v1

Integrate your e-commerce store with ParcelMoover: place delivery orders, track them, and list your shipments programmatically.

**Base URL**

| Environment | URL |
|---|---|
| Production | `https://<your-parcelmoover-domain>/api/v1` |
| Local development | `http://localhost:3000/api/v1` |

All requests and responses are JSON (`Content-Type: application/json`).

---

## Authentication

Every request must carry an API key. A ParcelMoover vendor account owner generates keys from the dashboard: **Sidebar → Account → API Keys → Generate Key**. The full key (`pm_live_...`) is shown **once** at creation — store it securely.

Send the key on every request:

```
Authorization: Bearer pm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

(`X-API-Key: <key>` is also accepted.)

Orders you create belong to the vendor account that owns the key, and you can only read your own orders. Keys can be revoked at any time from the same dashboard page; a revoked key gets `401` immediately.

**Never** embed the key in browser/mobile client code — call the API from your server only.

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
| Writes (`POST`) | 30/min |

Exceeding a limit returns `429` with `{ "success": false, "message": "Too many requests, please slow down" }`. Standard `RateLimit-*` response headers indicate your remaining quota — back off and retry after the window resets.

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
| `receiver.phone` | string | ✅ | 10–15 digits, optional leading `+`. |
| `receiver.alternatePhone` | string | — | Same format. |
| `receiver.email` | string | — | |
| `receiver.address` | string | — | Max 255 chars. |
| `sender` | object | — | Pickup contact. **Omit it and ParcelMoover fills it from your vendor account's registered pickup profile** (business name, phone, pickup landmark). Provide it only to override — e.g. shipping from a different warehouse. Same fields as `receiver` (`name` and `phone` required when provided). |
| `orderType` | string | — | `delivery` (default), `exchange`, or `return`. |
| `serviceType` | string | — | `dtd` door-to-door (default), `btd` branch-to-door, `btb` branch-to-branch, `dtb` door-to-branch. |
| `pieces` | integer | — | ≥ 1. Number of packages. |
| `weightKg` | number | — | > 0. |
| `codAmount` | number | — | ≥ 0. Cash to collect from the receiver on delivery (NPR). Omit or `0` for prepaid orders. |
| `packageType` | string | — | Max 50 chars, e.g. `"electronics"`. |
| `deliveryInstruction` | string | — | Max 500 chars. |
| `pickupAddress` | string | — | Max 255 chars. Overrides the sender address for pickup. |
| `scheduledPickupAt` | string | — | ISO-8601 datetime with offset, e.g. `2026-07-15T10:00:00+05:45`. |
| `originLocationId` / `destinationLocationId` | UUID | — | ParcelMoover branch/coverage-area ids. Optional — plain addresses work; ask your ParcelMoover contact for ids if you want precise coverage-area routing. |

The **delivery charge is computed by ParcelMoover** from your vendor rate agreement — you cannot set it. It appears on the order when you fetch it.

#### Example — cURL

```bash
curl -X POST "$BASE/api/v1/orders" \
  -H "Authorization: Bearer $KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "receiver": { "name": "Ram Sharma", "phone": "9841234567", "address": "Baneshwor, Kathmandu" },
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

const res = await fetch(`${BASE}/orders`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${KEY}`,
    "Idempotency-Key": crypto.randomUUID(), // persist this to retry safely
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    receiver: { name: "Ram Sharma", phone: "9841234567", address: "Baneshwor, Kathmandu" },
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

resp = requests.post(
    f"{BASE}/orders",
    headers={
        "Authorization": f"Bearer {KEY}",
        "Idempotency-Key": str(uuid.uuid4()),  # persist this to retry safely
    },
    json={
        "receiver": {"name": "Ram Sharma", "phone": "9841234567", "address": "Baneshwor, Kathmandu"},
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
        'receiver' => ['name' => 'Ram Sharma', 'phone' => '9841234567', 'address' => 'Baneshwor, Kathmandu'],
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
    "packageType": "",
    "deliveryInstruction": "Call before delivery",
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
| `partially_delivered` | Delivered with partial COD collection — see order remarks. |
| `failed_pickup` / `failed_delivery` | Attempt failed; will be retried or followed up. |
| `hold` | Temporarily held — see remarks. |
| `oov` | Out of coverage — handed to a partner carrier for the last leg. |
| `follow_up`, `ready_to_return`, `sent_to_vendor`, `returned_to_vendor` | Return-to-vendor flow after failed delivery. |
| `cancelled` | Order cancelled. |
| `loss_and_damage` | Reported lost or damaged. |

**Register a webhook** (see below) to be notified the moment an order's status changes — that's the supported way to keep your system in sync, and it's the only one that doesn't cost you a standing polling loop. `GET /orders/{trackingId}` still exists for on-demand lookups (a support agent checking one order, or reconciling after your webhook endpoint was down) — it's not meant to be called on a timer.

---

## Webhooks

Register an endpoint at `/developer/webhooks` in your dashboard (or via `POST /api/webhooks`, session-authenticated — this is a dashboard-side call, not part of `/api/v1`) and we'll POST a signed event to it every time one of your orders' status changes.

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
- `X-ParcelMoover-Delivery` — a UUID unique to this delivery attempt; use it to de-duplicate retries.
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

### Retries

A non-2xx response (or a request we can't complete within 10s) is retried with exponential backoff — roughly 30s, 1m, 2m, 4m, ... capped at 6h between attempts, for up to 12 attempts spanning about 24 hours. If an endpoint fails its **entire** retry window five times in a row, it's automatically disabled; re-enable it from the dashboard once it's fixed (this also resets the failure count). Return `2xx` promptly — do the actual processing after responding if it's slow, since a slow response counts toward the same 10s timeout as a failed one.

---

## Errors

Every error is JSON with this shape:

```json
{ "success": false, "message": "Human-readable explanation" }
```

Validation failures (`400`) additionally include an `errors` array:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [ { "field": "receiver.phone", "message": "Phone must be 10–15 digits, optionally starting with +" } ]
}
```

| Code | Meaning |
|---|---|
| `400` | Malformed request — missing/invalid fields, missing or non-UUID `Idempotency-Key`. |
| `401` | Missing, invalid, or revoked API key. |
| `404` | Order not found (or not yours), or unknown endpoint. |
| `409` | Conflict — e.g. an `Idempotency-Key` replayed with a *different* request body. |
| `422` | Request understood but not processable (business-rule rejection). |
| `429` | Rate limit exceeded — back off and retry. |
| `500` | Server error — safe to retry `POST /orders` with the same `Idempotency-Key`. |

---

## Integration checklist

1. Generate an API key from the vendor dashboard and store it server-side (env var / secrets manager — never in client code).
2. On checkout/fulfilment, `POST /orders` with a fresh UUID `Idempotency-Key`; persist the returned `trackingId` against your order.
3. Retry failed creates (network error, `5xx`) with the **same** `Idempotency-Key`.
4. Register a webhook endpoint and verify `X-ParcelMoover-Signature` on every request before trusting the payload; that's how you sync status back to your system. Show the returned `trackingId` to your customer at creation time.
5. Use `GET /orders/{trackingId}` only for on-demand lookups or reconciliation (e.g. catching up after your webhook endpoint was down) — not as a scheduled polling loop.
6. Handle `401` by alerting yourself (key revoked/rotated) and `429` with exponential backoff.
7. Rotate keys periodically: generate a new key, switch traffic, then revoke the old one (up to 5 active keys per account).
