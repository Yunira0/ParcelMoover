# NCM Webhook Integration (v1.0, Beta)

NCM sends HTTP POST requests to your configured URL when order status changes. Configure the URL via the vendor portal (`/accounts/vendor/api` → "Webhook/API Callback URLs") or via `POST /api/v2/vendor/webhook` (see api-reference.md).

## Events

| event | status | Meaning |
|---|---|---|
| `pickup_completed` | `Pickup Complete` | Picked up from origin |
| `sent_for_delivery` | `Sent for Delivery` | Out for delivery |
| `order_dispatched` | `Dispatched` | Dispatched from origin branch |
| `order_arrived` | `Arrived` | Arrived at destination branch |
| `delivery_completed` | `Delivered` | Successfully delivered |

## Payloads

Single order:
```json
{"order_id": "123456", "status": "Delivered", "timestamp": "2024-01-15T10:30:00Z", "event": "delivery_completed"}
```

Bulk (multiple orders, e.g. dispatch/arrival):
```json
{"order_ids": ["123456", "123457", "123458"], "status": "Dispatched", "timestamp": "2024-01-15T10:30:00Z", "event": "order_dispatched"}
```

Test payload (from the portal "Test Webhook" button or the test endpoint) has `"test": true` and `order_id` like `TEST-123456` — acknowledge it but skip business logic.

Headers on every delivery:
```
Content-Type: application/json
Content-Length: <n>
User-Agent: NCM-Webhook/1.0
```

## Receiver requirements

- **A payload may carry `order_id` (string) OR `order_ids` (array)** — handle both.
- Respond within **10 seconds** with any 2xx; response body is ignored. Do heavy work asynchronously (queue the payload, ack immediately).
- **No signature/HMAC is provided.** Authenticate by putting a secret in the URL (`?token=...`) or a path segment, and use HTTPS. Reject requests missing the secret.
- **Idempotency is mandatory** — duplicates can arrive; upsert by (`order_id`, `event`) or check whether the status is already applied.
- **No retry mechanism** — a missed webhook is lost. Reconcile periodically with `POST /api/v1/orders/statuses` for in-flight orders.
- Webhook failures never affect NCM order processing; failures are silent, so monitor your endpoint.

## Minimal handler shape (Node/Express)

```javascript
app.post('/webhooks/ncm', (req, res) => {
  const { order_id, order_ids, status, event, timestamp, test } = req.body;
  if (test) return res.json({ status: 'success' });

  const ids = order_ids ?? [order_id];
  // enqueue { ids, status, event, timestamp } for async processing
  res.json({ status: 'received' });
});
```

## Troubleshooting

- **Nothing received**: URL configured? Endpoint publicly reachable? Responds to POST?
- **Timeouts**: move processing off the request path; ack fast.
- **Invalid payload**: ensure JSON body parsing is enabled; validate structure defensively.
- Use webhook.site for initial testing; log every incoming request.

Support: IT@nepalcanmove.com
