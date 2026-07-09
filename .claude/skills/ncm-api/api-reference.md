# NCM API Reference (v20260528)

Base URL (docs/demo): `https://demo.nepalcanmove.com`
All endpoints require header: `Authorization: Token <your_token>`
POST bodies are JSON (`Content-Type: application/json`).

Limits: order creation 1,000/day; order views (detail, comments, status) 20,000/day.

---

## Branches & Rates

### GET /api/v2/branches
List all NCM branches with phone, covered areas, district, region.

### GET /api/v1/shipping-rate
Calculate delivery charge between branches.

Query params:
- `creation` — pickup branch name
- `destination` — destination branch name
- `type` — delivery type

| type value | Meaning | Charge |
|---|---|---|
| `Pickup/Collect` | Door2Door (NCM pickup & delivery) | full base charge |
| `Send` | Branch2Door | full base charge |
| `D2B` | Door2Branch | base − 50 |
| `B2B` | Branch2Branch | base − 50 |

Example: `/api/v1/shipping-rate?creation=TINKUNE&destination=POKHARA&type=Pickup/Collect`

---

## Orders

### GET /api/v1/order?id=ORDERID
Order detail.

200:
```json
{
  "orderid": 134,
  "cod_charge": "1710.00",
  "delivery_charge": "99.00",
  "last_delivery_status": "Delivered",
  "payment_status": "Completed"
}
```

### GET /api/v1/order/status?id=ORDERID
Full status history, newest first.

200:
```json
[
  {"orderid": 134, "status": "Delivered", "added_time": "2019-10-18T13:24:30.960365+05:45"},
  {"orderid": 134, "status": "Sent for Delivery", "added_time": "..."},
  {"orderid": 134, "status": "Pickup Complete", "added_time": "..."},
  {"orderid": 134, "status": "Sent for Pickup", "added_time": "..."},
  {"orderid": 134, "status": "Pickup Order Created", "added_time": "..."}
]
```

### POST /api/v1/orders/statuses
Bulk current-status lookup.

Body: `{"orders": [4041, 3855, 4032, 3841, 3842, 4042]}`

200:
```json
{
  "result": {"4041": "Pickup Order Created", "3855": "Arrived", "4032": "Drop off Order Created", "3841": "Delivered", "3842": "Delivered"},
  "errors": [4042]
}
```
`errors` holds IDs that could not be resolved.

### POST /api/v1/order/create
Create an order.

| Param | Required | Description |
|---|---|---|
| `name` | yes | customer name |
| `phone` | yes | customer phone |
| `phone2` | no | secondary phone |
| `cod_charge` | yes | COD amount **including delivery** |
| `address` | yes | customer address |
| `fbranch` | yes | from-branch name |
| `branch` | yes | destination branch name |
| `package` | no | package name/type |
| `vref_id` | no | vendor reference id |
| `instruction` | no | delivery instruction |
| `delivery_type` | no | `Door2Door` (default), `Branch2Door`, `Branch2Branch`, `Door2Branch` |
| `weight` | no | kg, default 1 |

200: `{"Message": "Order Successfully Created", "orderid": 747}`

400 (field-level):
```json
{"Error": {"cod_charge": "Invalid COD Amount", "phone": "Invalid Phone Number", "branch": "Invalid Branch", "name": "Invalid Name", "address": "Invalid Address"}}
```

### POST /api/v2/vendor/order/return
Mark an order for return. Body: `{"pk": 4041, "comment": "optional reason"}`

200: `{"message": "Order marked for return successfully", "order": 4041, "vendor_return": true}`
400: `{"message": "Order ID is required"}` · 404: `{"message": "Order not found"}`

Notes: sets `vendor_return=true`; a comment creates an external comment with "Pending" status; only the owning vendor may return.

### POST /api/v2/vendor/order/exchange-create
Create exchange orders. Body: `{"pk": 4041}`

200: `{"message": "Exchange orders created", "cust_order": 4567, "ven_order": 4568}`
Creates two orders: `cust_order` (new delivery to customer) and `ven_order` (return of old item to vendor).

### POST /api/v2/vendor/order/redirect
Redirect an order to a new address/customer.

| Param | Required | Description |
|---|---|---|
| `pk` | yes | order ID |
| `name` | yes | new customer name |
| `phone` | yes | new customer phone |
| `address` | yes | new address |
| `vendorOrderid` | no | vendor reference order ID |
| `destination` | no | new destination **branch ID** (if changing) |
| `cod_charge` | no | new COD amount (decimal) |

200 includes `message`, `order`, `cod_charge`, `delivery_charge`, and `changelogs` text.

Notes: different destination → `RDRT-DiFF-BRNCH` charge; same destination → `REDIRECT` charge; unknown phone creates a new customer record; all changes logged in order changelogs.

---

## Comments

### GET /api/v1/order/comment?id=ORDERID
All comments on an order, newest first.
Items: `{"orderid", "comments", "addedBy" ("NCM Staff"|"Vendor"), "added_time"}`

### GET /api/v1/order/getbulkcomments
Last 25 comments across all your orders, newest first. Same item shape.

### POST /api/v1/comment
Body: `{"orderid": "1234567", "comments": "text"}`
200: `{"message": "Comment successfully created"}`
400: `{"Error": {"Order Id": "Invalid / Empty orderid", "Comments": "Invalid / Empty comment"}}`

---

## Tickets

### POST /api/v2/vendor/ticket/create/new
| Param | Required | Description |
|---|---|---|
| `ticket_type` | yes | `General`, `Order Processing`, `Return`, `Pickup` |
| `message` | yes | max 500 chars |
| `branch` | only for `Pickup` | must be one of vendor's assigned pickup branches |

201: `{"message": "Ticket created", "ticket": 123}`

### POST /api/v2/vendor/ticket/cod/create
COD transfer request. Body: `{"bankName", "bankAccountName", "bankAccountNumber"}` (all required).
201: `{"message": "COD ticket created", "ticket": 124}`

### POST /api/v2/vendor/ticket/close/<ticket_id>
Close own ticket. 200: `{"message": "Ticket closed", "ticket": 123}`

### GET /api/v1/tickets/<ticket_id>/detail
Vendor sees only own tickets; logistics only assigned; others forbidden.
200 returns `{"success": true, "ticket": {id, ticket_type, message, added_on, status, comment, attachment, branch, closed_on, vendor{id,name,location}, assigned_to{id,name}, closed_by{id,name}}, "responses": [{id, message, added_on, vendor_display, added_by{id,name}}]}`

### POST /api/v1/vendor/tickets/<ticket_id>/response
Body: `{"message": "text"}`. Creates response with `vendorDisplay=true`; **reopens the ticket if closed**.
201: `{"success": true, "ticket_id": 2639, "response": {...}}`

---

## Vendor data

### GET /api/v2/vendor/staffs
Paginated active staff. Query: `q` (name contains), `page` (default 1), `page_size`/`limit` (default 20).
200: `{"count", "next", "previous", "results": [{"id", "name", "email", "phone"}]}`

### GET /api/v2/vendor/assigned-branches
Returns a plain array of branch names, e.g. `["KATHMANDU", "POKHARA", "BIRATNAGAR"]`. Empty array if none.

### GET /api/v2/vendor/customers
Paginated customers (created by you or who received your orders).
Query: `page` (default 1), `page_size` (default 25, max 100), `name` (contains), `phone` (starts with).
200: DRF-style `{"count", "next", "previous", "results": [{"id", "name", "phone", "address"}]}`

### GET /api/v2/vendor/customers/<customer_id>/detail
Full profile + order history:
```json
{"id": 109523, "name": "John Doe", "phone": "9841234567", "email": "john@example.com",
 "orders": [{"orderid", "created_date", "cod_charge", "delivery_charge", "last_delivery_status"}]}
```
404: `{"detail": "Customer not found"}` or `{"detail": "Not found"}`

### GET /api/v2/vendor/ratings?phone=<phone>
System-wide delivery stats for a customer phone.
200: `{"phone", "total_orders", "total_delivered", "total_returned"}`
400 if phone missing; 404 if no customer with that phone.

---

## Order Labels

### GET /api/v2/vendor/order/label/<order_id>
Label data for one of your own orders.

200:
```json
{
  "orderid": 346844,
  "delivery_type": "Home",
  "cod_charge": "1500.00",
  "from_branch": {"name": "TINKUNE", "code": "TINK1", "district": "Kathmandu"},
  "to_branch": {"name": "BIRATNAGAR", "code": "BIRA1", "district": "Morang"},
  "from": {"name": "Vendor Name", "phone": "9841000000", "phone2": ""},
  "receiver": {"name": "John Doe", "phone": "9847000000", "phone2": "", "address": "Baneshwor, Kathmandu"},
  "description": {"description": "Blue jeans", "delivery_instruction": "Handle carefully", "handling": "Non-Fragile", "vendor_orderid": "VREF-123"}
}
```
404: `{"detail": "Order not found"}`

### POST /api/v2/vendor/order/label/
Bulk labels. Body: `{"ids": [346844, 346845, 99999]}` (non-empty int array).
200: `{"labels": [...same shape as GET...], "not_found": [99999]}`

Notes:
- `delivery_type` is `"Office"` for D2B/B2B orders, `"Home"` otherwise.
- `from` holds vendor details for Vendor-type orders, else sender customer details.
- `description` fields are null when no description was added.
- `handling` ∈ `Fragile`, `Fragile and Valuable`, `Valuable`, `Non-Fragile`.
- IDs belonging to another vendor land silently in `not_found`.
- `labels` order is not guaranteed — match by `orderid`. Keep batches ≤ 100.

---

## Webhook management endpoints

### POST /api/v2/vendor/webhook
Set, update, or remove the order-status webhook URL.
Body: `{"webhook_url": "https://example.com/webhooks/order-status"}` — empty string removes it. Must start with `http://` or `https://`.
200 on update, 201 on first creation: `{"success": true, "message": "..."}`
400: `{"success": false, "message": "Please enter a valid URL..."}`

### POST /api/v2/vendor/webhook/test
Sends a test payload to the given URL (10-second timeout).
Body: `{"webhook_url": "https://..."}`

Test payload sent to your endpoint:
```json
{"event": "order.status.changed", "order_id": "TEST-123456", "status": "In Transit", "timestamp": "2024-01-01T12:00:00+05:45", "test": true}
```

Response is always HTTP 200 with either `{"success": true, "status_code": <your server's code>, "response": "..."}` or `{"success": false, "error": "Request timed out..."}` / connection-error text.

---

## Generic GET error shapes

- 401 `{"detail": "Authentication credentials were not provided."}`
- 400 `{"detail": "ID parameter missing"}`
- 404 `{"detail": "Not found."}`
- 500 `{"detail": "Server Error"}`

## Support
- IT@nepalcanmove.com · Tel 015199684 · Tinkune, Kathmandu
