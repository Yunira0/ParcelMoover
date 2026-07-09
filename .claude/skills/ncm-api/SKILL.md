---
name: ncm-api
description: Integrate with the NCM (Nepal Can Move) courier API — create/track orders, calculate shipping rates, manage comments, tickets, returns/exchanges/redirects, customer data, order labels, and receive order-status webhooks. Use whenever the task involves NCM, Nepal Can Move, nepalcanmove.com, or connecting ParcelMoover to the NCM courier network.
---

# NCM (Nepal Can Move) API Integration

NCM exposes a vendor REST API for courier operations in Nepal. This skill covers how to authenticate, call every documented endpoint, and consume NCM webhooks.

## Base URL & Authentication

- Demo/base URL in docs: `https://demo.nepalcanmove.com` (production uses the same paths on the live host — confirm the host with the user before shipping).
- Every request needs a vendor token header: `Authorization: Token <token>`
- Store the token in an env var (e.g. `NCM_API_TOKEN`) — never hardcode it. Tokens are issued per vendor by NCM IT Admin (IT@nepalcanmove.com).
- Rate limits: **order creation 1,000/day**, **order views (detail/comments/status) 20,000/day**. Do not poll aggressively; prefer webhooks for status updates.

## Endpoint quick map

| Task | Method & Path |
|---|---|
| List branches | `GET /api/v2/branches` |
| Shipping rate | `GET /api/v1/shipping-rate?creation=&destination=&type=` |
| Order detail | `GET /api/v1/order?id=` |
| Order comments | `GET /api/v1/order/comment?id=` |
| Last 25 comments (all orders) | `GET /api/v1/order/getbulkcomments` |
| Order status history | `GET /api/v1/order/status?id=` |
| Bulk order statuses | `POST /api/v1/orders/statuses` |
| **Create order** | `POST /api/v1/order/create` |
| Create comment | `POST /api/v1/comment` |
| Create support ticket | `POST /api/v2/vendor/ticket/create/new` |
| COD transfer ticket | `POST /api/v2/vendor/ticket/cod/create` |
| Close ticket | `POST /api/v2/vendor/ticket/close/<ticket_id>` |
| Ticket detail | `GET /api/v1/tickets/<ticket_id>/detail` |
| Ticket response | `POST /api/v1/vendor/tickets/<ticket_id>/response` |
| Staff list | `GET /api/v2/vendor/staffs` |
| Assigned pickup branches | `GET /api/v2/vendor/assigned-branches` |
| Mark order for return | `POST /api/v2/vendor/order/return` |
| Create exchange orders | `POST /api/v2/vendor/order/exchange-create` |
| Redirect order | `POST /api/v2/vendor/order/redirect` |
| Set/remove webhook URL | `POST /api/v2/vendor/webhook` |
| Test webhook URL | `POST /api/v2/vendor/webhook/test` |
| Customer list | `GET /api/v2/vendor/customers` |
| Customer detail + orders | `GET /api/v2/vendor/customers/<id>/detail` |
| Customer rating stats | `GET /api/v2/vendor/ratings?phone=` |
| Label data (single) | `GET /api/v2/vendor/order/label/<order_id>` |
| Label data (bulk) | `POST /api/v2/vendor/order/label/` |

Full request/response shapes, params, and error formats: read [api-reference.md](api-reference.md).
Webhook events, payloads, and receiver implementation: read [webhooks.md](webhooks.md).

## Key domain facts

**Delivery types** (used in rate calc and order creation):
- `Pickup/Collect` = Door2Door (NCM picks up & delivers) — full base charge
- `Send` = Branch2Door — full base charge
- `D2B` = Door2Branch — base charge − 50
- `B2B` = Branch2Branch — base charge − 50
- On order create, `delivery_type` values are `Door2Door` (default), `Branch2Door`, `Branch2Branch`, `Door2Branch`; `weight` defaults to 1 kg.

**Order lifecycle statuses** (ascending): `Pickup Order Created` → `Sent for Pickup` → `Pickup Complete` → `Dispatched` → `Arrived` → `Sent for Delivery` → `Delivered`. Returns show `Sent to Vendor`; drop-off orders start at `Drop off Order Created`.

**Common errors**: 401 missing/invalid token, 400 missing param (`{"detail": "ID parameter missing"}` or field-level `{"Error": {...}}` on create), 404 unknown order/customer, 500 server error.

## Implementation rules

1. **Prefer webhooks over polling** for status changes; fall back to `POST /api/v1/orders/statuses` for batch reconciliation (it returns `result` map + `errors` array of bad IDs).
2. **Avoid duplicate order creation** — NCM explicitly warns against creating the same order via both bulk file upload and API. Use `vref_id` (vendor reference ID) to make creation idempotent on your side, and check before re-creating.
3. `cod_charge` on create **includes** the delivery charge.
4. `fbranch`/`branch` are branch **names** (e.g. `TINKUNE`, `BIRATNAGAR`) — validate against `GET /api/v2/branches` or the vendor's `assigned-branches`.
5. Bulk label endpoint: order of `labels` is not guaranteed — match by `orderid`; foreign/unknown IDs come back silently in `not_found`; keep batches ≤ 100.
6. Redirecting to a different destination branch adds an `RDRT-DiFF-BRNCH` charge; same branch adds a `REDIRECT` charge.
7. Timestamps are Nepal time, ISO 8601 with `+05:45` offset.
8. In this repo, follow existing patterns: rate-limit any NCM-proxying endpoints with the Redis store (`createRedisRateLimitStore`), and keep NCM tokens server-side only.
