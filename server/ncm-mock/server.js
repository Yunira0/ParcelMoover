/**
 * Mock NCM (Nepal Can Move) API server for local development.
 *
 * Implements the vendor endpoints ParcelMoover integrates with, per
 * .claude/skills/ncm-api. Run from the server/ directory (reuses its
 * express install):
 *
 *   node ncm-mock/server.js
 *
 * Env (loaded from ../.env automatically, so this matches the main app
 * without exporting anything by hand):
 *   NCM_MOCK_PORT   (default 4100)
 *   NCM_MOCK_TOKEN  (default: whatever NCM_API_TOKEN is set to in .env, so
 *                    the mock accepts the same token the main app sends —
 *                    falls back to "test-ncm-token" if neither is set)
 *
 * Control endpoints (not part of the real API):
 *   POST /_mock/orders/:id/advance   — move an order to its next status and
 *                                      fire the webhook to the registered URL
 *   POST /_mock/orders/:id/status    — body {"status": "..."} force a status
 *   GET  /_mock/state                — dump all orders + webhook config
 *   POST /_mock/reset                — clear all state
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const express = require("express");

const PORT = Number(process.env.NCM_MOCK_PORT || 4100);
const TOKEN = process.env.NCM_MOCK_TOKEN || process.env.NCM_API_TOKEN || "test-ncm-token";

const BRANCHES = [
  { name: "TINKUNE", code: "TINK1", district: "Kathmandu", region: "Bagmati", phone: "015199684", covered_areas: "Tinkune, Baneshwor" },
  { name: "POKHARA", code: "POKH1", district: "Kaski", region: "Gandaki", phone: "061520000", covered_areas: "Pokhara metro" },
  { name: "BIRATNAGAR", code: "BIRA1", district: "Morang", region: "Koshi", phone: "021440000", covered_areas: "Biratnagar metro" },
  { name: "BUTWAL", code: "BUTW1", district: "Rupandehi", region: "Lumbini", phone: "071540000", covered_areas: "Butwal, Bhairahawa" },
  { name: "DHANGADHI", code: "DHAN1", district: "Kailali", region: "Sudurpashchim", phone: "091520000", covered_areas: "Dhangadhi" },
];

// Real-world lifecycle order (see skill docs). Each entry: [status, webhookEvent|null]
const LIFECYCLE = [
  ["Pickup Order Created", null],
  ["Sent for Pickup", null],
  ["Pickup Complete", "pickup_completed"],
  ["Dispatched", "order_dispatched"],
  ["Arrived", "order_arrived"],
  ["Sent for Delivery", "sent_for_delivery"],
  ["Delivered", "delivery_completed"],
];

let nextOrderId = 1000;
const orders = new Map(); // orderid -> { fields..., statuses: [{status, added_time}], comments: [] }
let webhookUrl = null;

const now = () => new Date().toISOString().replace("Z", "+05:45");

const app = express();
app.use(express.json());

// ── auth (skip for control endpoints) ───────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith("/_mock")) return next();
  const auth = req.headers.authorization || "";
  if (auth !== `Token ${TOKEN}`) {
    return res.status(401).json({ detail: "Authentication credentials were not provided." });
  }
  next();
});

// ── branches & rates ─────────────────────────────────────────────────────────
app.get("/api/v2/branches", (req, res) => res.json(BRANCHES));

app.get("/api/v1/shipping-rate", (req, res) => {
  const { creation, destination, type } = req.query;
  const from = BRANCHES.find((b) => b.name === String(creation || "").toUpperCase());
  const to = BRANCHES.find((b) => b.name === String(destination || "").toUpperCase());
  if (!from || !to) return res.status(400).json({ detail: "Invalid branch" });
  const base = from.name === to.name ? 100 : 150;
  const discounted = type === "D2B" || type === "B2B" ? base - 50 : base;
  res.json({ charge: discounted, from: from.name, to: to.name, type: type || "Pickup/Collect" });
});

// ── order create ─────────────────────────────────────────────────────────────
app.post("/api/v1/order/create", (req, res) => {
  const b = req.body || {};
  const errors = {};
  if (!b.name) errors.name = "Invalid Name";
  if (!b.phone || !/^\d{9,10}$/.test(String(b.phone))) errors.phone = "Invalid Phone Number";
  if (!b.cod_charge || isNaN(Number(b.cod_charge))) errors.cod_charge = "Invalid COD Amount";
  if (!b.address) errors.address = "Invalid Address";
  if (!b.fbranch || !BRANCHES.some((x) => x.name === String(b.fbranch).toUpperCase())) errors.fbranch = "Invalid Branch";
  if (!b.branch || !BRANCHES.some((x) => x.name === String(b.branch).toUpperCase())) errors.branch = "Invalid Branch";
  if (Object.keys(errors).length) return res.status(400).json({ Error: errors });

  const orderid = nextOrderId++;
  orders.set(orderid, {
    orderid,
    name: b.name,
    phone: String(b.phone),
    phone2: b.phone2 || "",
    cod_charge: Number(b.cod_charge).toFixed(2),
    delivery_charge: "150.00",
    address: b.address,
    fbranch: String(b.fbranch).toUpperCase(),
    branch: String(b.branch).toUpperCase(),
    package: b.package || "",
    vref_id: b.vref_id || "",
    instruction: b.instruction || "",
    delivery_type: b.delivery_type || "Door2Door",
    weight: b.weight || "1",
    payment_status: "Pending",
    lifecycleIndex: 0,
    statuses: [{ status: LIFECYCLE[0][0], added_time: now() }],
    comments: [],
  });
  console.log(`[mock-ncm] order ${orderid} created (vref=${b.vref_id || "-"}) ${b.fbranch} -> ${b.branch}`);
  res.json({ Message: "Order Successfully Created", orderid });
});

// ── order reads ──────────────────────────────────────────────────────────────
function getOrder(req, res) {
  const id = Number(req.query.id);
  if (!req.query.id) return res.status(400).json({ detail: "ID parameter missing" });
  const o = orders.get(id);
  if (!o) return res.status(404).json({ detail: "Not found." });
  return o;
}

app.get("/api/v1/order", (req, res) => {
  const o = getOrder(req, res);
  if (!o) return;
  res.json({
    orderid: o.orderid,
    cod_charge: o.cod_charge,
    delivery_charge: o.delivery_charge,
    last_delivery_status: o.statuses[o.statuses.length - 1].status,
    payment_status: o.payment_status,
  });
});

app.get("/api/v1/order/status", (req, res) => {
  const o = getOrder(req, res);
  if (!o) return;
  res.json([...o.statuses].reverse().map((s) => ({ orderid: o.orderid, ...s })));
});

app.post("/api/v1/orders/statuses", (req, res) => {
  const ids = (req.body && req.body.orders) || [];
  const result = {};
  const errors = [];
  for (const id of ids) {
    const o = orders.get(Number(id));
    if (o) result[String(id)] = o.statuses[o.statuses.length - 1].status;
    else errors.push(id);
  }
  res.json({ result, errors });
});

// ── comments ─────────────────────────────────────────────────────────────────
app.get("/api/v1/order/comment", (req, res) => {
  const o = getOrder(req, res);
  if (!o) return;
  res.json([...o.comments].reverse());
});

app.post("/api/v1/comment", (req, res) => {
  const { orderid, comments } = req.body || {};
  const o = orders.get(Number(orderid));
  const errors = {};
  if (!o) errors["Order Id"] = "Invalid / Empty orderid";
  if (!comments) errors["Comments"] = "Invalid / Empty comment";
  if (Object.keys(errors).length) return res.status(400).json({ Error: errors });
  o.comments.push({ orderid: o.orderid, comments, addedBy: "Vendor", added_time: now() });
  res.json({ message: "Comment successfully created" });
});

// Last 25 comments across all orders, newest first — same item shape as
// order/comment. Real NCM caps this at 25; the mock doesn't bother since
// local test volume never gets close.
app.get("/api/v1/order/getbulkcomments", (req, res) => {
  const all = [...orders.values()]
    .flatMap((o) => o.comments)
    .sort((a, b) => new Date(b.added_time) - new Date(a.added_time));
  res.json(all.slice(0, 25));
});

// Simulates NCM ops staff adding a comment on the portal (as opposed to
// POST /api/v1/comment, which is how *we* add comments and mocks addedBy:
// "Vendor") — lets you exercise the inbound half of comment sync locally.
app.post("/_mock/orders/:id/staff-comment", (req, res) => {
  const o = orders.get(Number(req.params.id));
  if (!o) return res.status(404).json({ detail: "Not found." });
  const comments = (req.body || {}).comments;
  if (!comments) return res.status(400).json({ Error: { Comments: "Invalid / Empty comment" } });
  o.comments.push({ orderid: o.orderid, comments, addedBy: "NCM Staff", added_time: now() });
  res.json({ message: "Comment successfully created" });
});

// ── labels ───────────────────────────────────────────────────────────────────
function labelFor(o) {
  const fb = BRANCHES.find((b) => b.name === o.fbranch);
  const tb = BRANCHES.find((b) => b.name === o.branch);
  return {
    orderid: o.orderid,
    delivery_type: ["Door2Branch", "Branch2Branch"].includes(o.delivery_type) ? "Office" : "Home",
    cod_charge: o.cod_charge,
    from_branch: { name: fb.name, code: fb.code, district: fb.district },
    to_branch: { name: tb.name, code: tb.code, district: tb.district },
    from: { name: "ParcelMoover", phone: "9841000000", phone2: "" },
    receiver: { name: o.name, phone: o.phone, phone2: o.phone2, address: o.address },
    description: {
      description: o.package || null,
      delivery_instruction: o.instruction || null,
      handling: "Non-Fragile",
      vendor_orderid: o.vref_id || null,
    },
  };
}

app.get("/api/v2/vendor/order/label/:id", (req, res) => {
  const o = orders.get(Number(req.params.id));
  if (!o) return res.status(404).json({ detail: "Order not found" });
  res.json(labelFor(o));
});

app.post("/api/v2/vendor/order/label/", (req, res) => {
  const ids = req.body && req.body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ detail: '"ids" must be a non-empty array' });
  }
  const labels = [];
  const not_found = [];
  for (const id of ids) {
    const o = orders.get(Number(id));
    if (o) labels.push(labelFor(o));
    else not_found.push(id);
  }
  res.json({ labels, not_found });
});

// ── webhook management ───────────────────────────────────────────────────────
app.post("/api/v2/vendor/webhook", (req, res) => {
  const url = (req.body || {}).webhook_url;
  if (url === "") {
    webhookUrl = null;
    return res.json({ success: true, message: "Webhook URLs updated successfully!" });
  }
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid URL for Order Status Webhook (must start with http:// or https://)",
    });
  }
  const created = webhookUrl === null;
  webhookUrl = url;
  console.log(`[mock-ncm] webhook URL set to ${url}`);
  res.status(created ? 201 : 200).json({
    success: true,
    message: created ? "Webhook URLs created successfully!" : "Webhook URLs updated successfully!",
  });
});

app.post("/api/v2/vendor/webhook/test", async (req, res) => {
  const url = (req.body || {}).webhook_url;
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ success: false, message: "Please enter a valid URL" });
  }
  const payload = {
    event: "order.status.changed",
    order_id: "TEST-123456",
    status: "In Transit",
    timestamp: now(),
    test: true,
  };
  try {
    const r = await deliverWebhook(url, payload);
    res.json({ success: true, status_code: r.status, response: r.body });
  } catch (e) {
    res.json({ success: false, error: `Connection error. Could not connect to the webhook URL. Details: ${e.message}` });
  }
});

async function deliverWebhook(url, payload) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "NCM-Webhook/1.0" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await r.text();
    console.log(`[mock-ncm] webhook -> ${url} [${r.status}] ${JSON.stringify(payload)}`);
    return { status: r.status, body };
  } finally {
    clearTimeout(t);
  }
}

// ── control endpoints ────────────────────────────────────────────────────────
async function applyStatus(o, idx) {
  const [status, event] = LIFECYCLE[idx];
  o.lifecycleIndex = idx;
  o.statuses.push({ status, added_time: now() });
  if (status === "Delivered") o.payment_status = "Completed";
  if (event && webhookUrl) {
    try {
      await deliverWebhook(webhookUrl, {
        order_id: String(o.orderid),
        status,
        timestamp: now(),
        event,
      });
    } catch (e) {
      console.warn(`[mock-ncm] webhook delivery failed (silently, like the real NCM): ${e.message}`);
    }
  }
  return { orderid: o.orderid, status, event: event || null, webhook_sent: Boolean(event && webhookUrl) };
}

app.post("/_mock/orders/:id/advance", async (req, res) => {
  const o = orders.get(Number(req.params.id));
  if (!o) return res.status(404).json({ detail: "Not found." });
  if (o.lifecycleIndex >= LIFECYCLE.length - 1) {
    return res.status(400).json({ detail: "Order already Delivered" });
  }
  res.json(await applyStatus(o, o.lifecycleIndex + 1));
});

app.post("/_mock/orders/:id/status", async (req, res) => {
  const o = orders.get(Number(req.params.id));
  if (!o) return res.status(404).json({ detail: "Not found." });
  const idx = LIFECYCLE.findIndex(([s]) => s === (req.body || {}).status);
  if (idx === -1) {
    return res.status(400).json({ detail: `Unknown status. One of: ${LIFECYCLE.map(([s]) => s).join(", ")}` });
  }
  res.json(await applyStatus(o, idx));
});

app.get("/_mock/state", (req, res) => {
  res.json({ webhookUrl, token: TOKEN, orders: [...orders.values()] });
});

app.post("/_mock/reset", (req, res) => {
  orders.clear();
  webhookUrl = null;
  nextOrderId = 1000;
  res.json({ ok: true });
});

const server = app.listen(PORT, () => {
  console.log(`[mock-ncm] listening on http://localhost:${PORT}  (token: ${TOKEN})`);
  console.log(`[mock-ncm] control: POST /_mock/orders/:id/advance | GET /_mock/state | POST /_mock/reset`);
});

// Without this, a port already in use throws an unhandled 'error' event that
// Node reports as a raw stack trace right after the process silently exits -
// easy to miss and confusing ("it printed nothing wrong but then just quit").
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[mock-ncm] port ${PORT} is already in use - is another mock instance already running? (lsof -i :${PORT})`);
    process.exit(1);
  }
  throw err;
});
