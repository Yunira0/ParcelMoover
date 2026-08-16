#!/usr/bin/env npx tsx
/**
 * Test webhook sender — simulates ParcelMoover's outbound webhook delivery.
 *
 * Usage:
 *   npx tsx scripts/test-webhook.ts <endpoint_url> [options]
 *
 * Options:
 *   --secret <secret>      Webhook signing secret (whsec_...)
 *   --event <type>         Event type (default: webhook.test)
 *   --tracking-id <id>     Tracking ID for order.status_changed (default: PM-TEST-00000000000-X)
 *   --old-status <status>  Old order status (default: pickup_ordered)
 *   --new-status <status>  New order status (default: delivered)
 *   --raw <json>           Send raw custom payload (overrides other options)
 *
 * Examples:
 *   # Send a test ping
 *   npx tsx scripts/test-webhook.ts http://localhost:4000/webhooks --secret whsec_test123
 *
 *   # Simulate a delivery status change
 *   npx tsx scripts/test-webhook.ts http://localhost:4000/webhooks \
 *     --secret whsec_test123 \
 *     --event order.status_changed \
 *     --tracking-id PM-260713-GFQK93S5YN894-Q \
 *     --old-status sent_for_delivery \
 *     --new-status delivered
 *
 *   # Send a custom payload
 *   npx tsx scripts/test-webhook.ts http://localhost:4000/webhooks \
 *     --secret whsec_test123 \
 *     --raw '{"id":"custom-123","type":"custom.event","created_at":"2026-07-23T00:00:00Z","data":{"hello":"world"}}'
 */

import crypto from "crypto";

// ── CLI args ──────────────────────────────────────────────────────
const args = process.argv.slice(2);

function getArg(name: string, fallback?: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
}

const endpointUrl = args.find((a) => !a.startsWith("--"));
if (!endpointUrl) {
  console.error("Usage: npx tsx scripts/test-webhook.ts <endpoint_url> [options]");
  process.exit(1);
}

const secret = getArg("secret", "whsec_test_secret");
const eventType = getArg("event", "webhook.test");
const trackingId = getArg("tracking-id", "PM-TEST-00000000000-X");
const oldStatus = getArg("old-status", "pickup_ordered");
const newStatus = getArg("new-status", "delivered");
const rawPayload = getArg("raw");

// ── Build payload ─────────────────────────────────────────────────
let payload: Record<string, unknown>;

if (rawPayload) {
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    console.error("Invalid JSON in --raw");
    process.exit(1);
  }
} else if (eventType === "webhook.test") {
  payload = {
    id: crypto.randomUUID(),
    type: "webhook.test",
    created_at: new Date().toISOString(),
    data: { message: "This is a test event from ParcelMoover." },
  };
} else {
  payload = {
    id: crypto.randomUUID(),
    type: eventType,
    created_at: new Date().toISOString(),
    data: {
      trackingId,
      orderId: crypto.randomUUID(),
      vendorId: "test-vendor",
      oldStatus,
      newStatus,
      changedAt: new Date().toISOString(),
    },
  };
}

// ── Sign payload ──────────────────────────────────────────────────
const rawBody = JSON.stringify(payload);
const timestamp = Math.floor(Date.now() / 1000);
const signedPayload = `${timestamp}.${rawBody}`;
const hmac = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
const signature = `t=${timestamp},v1=${hmac}`;

const deliveryId = crypto.randomUUID();

// ── Send request ──────────────────────────────────────────────────
console.log(`\n→ POST ${endpointUrl}`);
console.log(`  Event: ${eventType}`);
console.log(`  Delivery: ${deliveryId}`);
console.log(`  Signature: ${signature}`);
console.log(`  Body (${rawBody.length} bytes):\n`);
console.log(JSON.stringify(payload, null, 2));
console.log("\n");

(async () => {
  try {
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ParcelMoover-Event": eventType,
        "X-ParcelMoover-Delivery": deliveryId,
        "X-ParcelMoover-Signature": signature,
      },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });

    const responseText = await response.text();
    console.log(`← ${response.status} ${response.statusText}`);
    if (responseText) {
      try {
        console.log(JSON.stringify(JSON.parse(responseText), null, 2));
      } catch {
        console.log(responseText);
      }
    }

    if (!response.ok) {
      console.log(`\n⚠  Non-2xx response — your endpoint should return 2xx promptly.`);
      process.exit(1);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`\n✗ Request failed: ${msg}`);
    process.exit(1);
  }
})();
