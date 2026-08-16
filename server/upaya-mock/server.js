/**
 * Mock Upaya courier API server for local development.
 *
 * Implements the endpoints ParcelMoover integrates with, per the two PDFs
 * this integration was built from (Upaya Client API + webhook docs) — see
 * docs/upaya-integration-plan.md. Their real response schemas for
 * add-order/track-order are partial/cut off in the source docs, so this
 * mock's shapes are best-effort, matching what upaya.service.ts expects.
 * Run from the server/ directory (reuses its express install):
 *
 *   node upaya-mock/server.js
 *
 * Env (loaded from ../.env automatically):
 *   UPAYA_MOCK_PORT  (default 4200)
 *   UPAYA_MOCK_KEY   (default: whatever UPAYA_API_KEY is set to in .env)
 *
 * Unlike NCM, Upaya has no webhook-registration API — the URL is configured
 * by hand in their merchant portal, so this mock exposes a control endpoint
 * for it instead of accepting it over the "real" API surface.
 *
 * Control endpoints (not part of the real API):
 *   POST /_mock/webhook-url          — body {"url": "..."} set where webhooks fire
 *   POST /_mock/orders/:id/advance   — move an order to its next lifecycle
 *                                      status and fire the order_status webhook
 *   POST /_mock/orders/:id/status    — body {"status": "..."} force any status
 *   POST /_mock/orders/:id/comment   — body {"comment": "...", "commentedBy": "..."}
 *                                      fires a comment webhook
 *   GET  /_mock/state                — dump all orders + webhook config
 *   POST /_mock/reset                — clear all state
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const express = require("express");

const PORT = Number(process.env.UPAYA_MOCK_PORT || 4200);
const API_KEY = process.env.UPAYA_MOCK_KEY || process.env.UPAYA_API_KEY || "test-upaya-key";
const CLIENT_ID = 101;

const LOCATIONS = [
  { locationId: "606", locationName: "ParcelMoover — Tinkune Hub", address: "Tinkune, Kathmandu" },
];

// Forward lifecycle order, from the webhook doc's "Status Values" list —
// only the part `/_mock/orders/:id/advance` walks through automatically.
// Return-flow / terminal-exception statuses (hold, cancelled, etc.) are only
// reachable via /_mock/orders/:id/status.
const FORWARD_LIFECYCLE = [
  "unassigned-pickup",
  "assigned-pickup",
  "picked-up-by-rider",
  "inbound-at-warehouse",
  "midmile-sortation",
  "prepared-for-transit",
  "in-transit-to-hub",
  "received-at-hub",
  "ready-for-dispatch",
  "dispatched-with-rider",
  "delivered",
];

let nextOrderId = 5000;
const orders = new Map(); // orderId -> { orderId, orderReferenceId, trackingCode, status, ... }
let webhookUrl = null;

const app = express();
app.use(express.json());

// ── auth (skip for control endpoints) ───────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith("/_mock")) return next();
  if (req.headers["x-api-key"] !== API_KEY) {
    return res.status(401).json({ message: "Invalid or missing X-API-Key" });
  }
  next();
});

// ── locations ────────────────────────────────────────────────────────────────
app.get("/api/v1/client/locations", (req, res) => res.json(LOCATIONS));

app.get("/api/v1/client/locations/:locationid", (req, res) => {
  const loc = LOCATIONS.find((l) => l.locationId === req.params.locationid);
  if (!loc) return res.status(404).json({ message: "Location not found" });
  res.json(loc);
});

// ── order rates ──────────────────────────────────────────────────────────────
app.post("/api/v1/client/order-rates", (req, res) => {
  const { initial_weight, order_type, service_type_id, location_id } = req.body || {};
  if (!initial_weight || !order_type || !service_type_id || !location_id) {
    return res.status(400).json({ message: "initial_weight, order_type, service_type_id, location_id are required" });
  }
  const base = 100;
  const weightCharge = Number(initial_weight) * 20;
  res.json({ base_charge: base, weight_charge: weightCharge, total_charge: base + weightCharge });
});

// ── add order ────────────────────────────────────────────────────────────────
app.post("/api/v1/client/add-order", (req, res) => {
  const list = (req.body || {}).orders;
  if (!Array.isArray(list) || list.length === 0) {
    return res.status(400).json({ message: '"orders" must be a non-empty array' });
  }

  const created = list.map((o) => {
    const errors = {};
    if (!o.receiver_name) errors.receiver_name = "required";
    if (!o.receiver_contact) errors.receiver_contact = "required";
    if (!o.area_id) errors.area_id = "required";
    if (!o.receiver_address) errors.receiver_address = "required";
    if (Object.keys(errors).length) return { success: false, errors, order_reference_id: o.order_reference_id };

    const orderId = String(nextOrderId++);
    const trackingCode = `UPY${orderId}`;
    orders.set(orderId, {
      orderId,
      orderReferenceId: o.order_reference_id || null,
      trackingCode,
      receiverName: o.receiver_name,
      areaId: o.area_id,
      codAmount: Number(o.cod_amount || 0),
      status: FORWARD_LIFECYCLE[0],
      statuses: [{ status: FORWARD_LIFECYCLE[0], at: new Date().toISOString() }],
      comments: [],
    });
    console.log(`[mock-upaya] order ${orderId} created (ref=${o.order_reference_id || "-"}) area=${o.area_id}`);
    return { success: true, order_id: orderId, order_reference_id: o.order_reference_id, tracking_code: trackingCode };
  });

  res.json({ message: "Orders processed", orders: created });
});

// ── track order ──────────────────────────────────────────────────────────────
app.get("/api/v1/client/track-order/:orderid", (req, res) => {
  const o = orders.get(req.params.orderid);
  if (!o) return res.status(404).json({ message: "Order not found" });
  res.json({
    orderNumber: o.orderId,
    order_reference_id: o.orderReferenceId,
    tracking_code: o.trackingCode,
    status: o.status,
  });
});

// ── webhook delivery ──────────────────────────────────────────────────────────
async function deliverWebhook(payload) {
  if (!webhookUrl) {
    console.warn("[mock-upaya] no webhook URL configured (POST /_mock/webhook-url) — event dropped:", payload);
    return;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    console.log(`[mock-upaya] webhook -> ${webhookUrl} [${r.status}] ${JSON.stringify(payload)}`);
  } catch (e) {
    console.warn(`[mock-upaya] webhook delivery failed: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function orderStatusPayload(o, status) {
  return {
    update_type: "order_status",
    order_id: o.orderId,
    status,
    tracking_code: o.trackingCode,
    order_reference_id: o.orderReferenceId,
    webhook_url: webhookUrl,
    client_id: CLIENT_ID,
  };
}

// ── control endpoints ────────────────────────────────────────────────────────
app.post("/_mock/webhook-url", (req, res) => {
  webhookUrl = (req.body || {}).url || null;
  console.log(`[mock-upaya] webhook URL set to ${webhookUrl}`);
  res.json({ ok: true, webhookUrl });
});

app.post("/_mock/orders/:id/advance", async (req, res) => {
  const o = orders.get(req.params.id);
  if (!o) return res.status(404).json({ message: "Order not found" });
  const idx = FORWARD_LIFECYCLE.indexOf(o.status);
  if (idx === -1 || idx >= FORWARD_LIFECYCLE.length - 1) {
    return res.status(400).json({ message: "Order has no further forward status (advance stops at 'delivered')" });
  }
  const status = FORWARD_LIFECYCLE[idx + 1];
  o.status = status;
  o.statuses.push({ status, at: new Date().toISOString() });
  await deliverWebhook(orderStatusPayload(o, status));
  res.json({ orderId: o.orderId, status });
});

app.post("/_mock/orders/:id/status", async (req, res) => {
  const o = orders.get(req.params.id);
  if (!o) return res.status(404).json({ message: "Order not found" });
  const status = (req.body || {}).status;
  if (!status) return res.status(400).json({ message: '"status" is required' });
  o.status = status;
  o.statuses.push({ status, at: new Date().toISOString() });
  await deliverWebhook(orderStatusPayload(o, status));
  res.json({ orderId: o.orderId, status });
});

app.post("/_mock/orders/:id/comment", async (req, res) => {
  const o = orders.get(req.params.id);
  if (!o) return res.status(404).json({ message: "Order not found" });
  const { comment, commentedBy } = req.body || {};
  if (!comment) return res.status(400).json({ message: '"comment" is required' });
  o.comments.push({ comment, commentedBy, at: new Date().toISOString() });
  await deliverWebhook({
    update_type: "comment",
    order_id: o.orderId,
    tracking_code: o.trackingCode,
    order_reference_id: o.orderReferenceId,
    webhook_url: webhookUrl,
    client_id: CLIENT_ID,
    comment,
    commented_at: new Date().toISOString(),
    commented_by: commentedBy || "upaya_staff",
  });
  res.json({ ok: true });
});

app.get("/_mock/state", (req, res) => {
  res.json({ webhookUrl, apiKey: API_KEY, orders: [...orders.values()] });
});

app.post("/_mock/reset", (req, res) => {
  orders.clear();
  webhookUrl = null;
  nextOrderId = 5000;
  res.json({ ok: true });
});

const server = app.listen(PORT, () => {
  console.log(`[mock-upaya] listening on http://localhost:${PORT}  (X-API-Key: ${API_KEY})`);
  console.log(`[mock-upaya] control: POST /_mock/webhook-url | POST /_mock/orders/:id/advance | GET /_mock/state | POST /_mock/reset`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[mock-upaya] port ${PORT} is already in use - is another mock instance already running? (lsof -i :${PORT})`);
    process.exit(1);
  }
  throw err;
});
