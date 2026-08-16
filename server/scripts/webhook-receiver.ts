#!/usr/bin/env npx tsx
/**
 * Webhook receiver — listens for incoming ParcelMoover webhooks and logs them.
 *
 * Usage:
 *   npx tsx scripts/webhook-receiver.ts [port] [secret]
 *
 * Examples:
 *   # Start receiver on port 4000 with no signature verification
 *   npx tsx scripts/webhook-receiver.ts 4000
 *
 *   # Start receiver with signature verification
 *   npx tsx scripts/webhook-receiver.ts 4000 whsec_test123
 *
 * Then point your webhook endpoint to http://localhost:4000/webhooks
 * or use the test sender: npx tsx scripts/test-webhook.ts http://localhost:4000/webhooks
 */

import crypto from "crypto";
import http from "http";

const port = Number(process.argv[2]) || 4000;
const secret = process.argv[3]; // optional — skip verification if not provided

const deliveries: Array<{
  timestamp: Date;
  eventId: string;
  eventType: string;
  signature: string | null;
  verified: boolean | null;
  body: unknown;
}> = [];

function verifySignature(rawBody: string, signatureHeader: string | null, webhookSecret: string): boolean {
  if (!signatureHeader) return false;

  const parts: Record<string, string> = {};
  for (const p of signatureHeader.split(",")) {
    const [k, v] = p.split("=");
    if (k && v) parts[k] = v;
  }

  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;

  const expected = crypto.createHmac("sha256", webhookSecret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1 || "", "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method not allowed\n");
    return;
  }

  let rawBody = "";
  req.on("data", (chunk: Buffer) => {
    rawBody += chunk.toString();
  });

  req.on("end", () => {
    const eventType = req.headers["x-parcelmoover-event"] as string;
    const deliveryId = req.headers["x-parcelmoover-delivery"] as string;
    const signatureHeader = req.headers["x-parcelmoover-signature"] as string;

    let verified: boolean | null = null;
    if (secret) {
      verified = verifySignature(rawBody, signatureHeader, secret);
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = rawBody;
    }

    deliveries.push({
      timestamp: new Date(),
      eventId: deliveryId,
      eventType,
      signature: signatureHeader,
      verified,
      body,
    });

    // Console output
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`📨 Received at ${new Date().toISOString()}`);
    console.log(`   Event:    ${eventType}`);
    console.log(`   Delivery: ${deliveryId}`);
    console.log(`   Signature: ${signatureHeader}`);
    if (secret) {
      console.log(`   Verified: ${verified ? "✓ valid" : "✗ INVALID"}`);
    } else {
      console.log(`   Verified: (skipped — no secret provided)`);
    }
    console.log(`   Body:`);
    console.log(JSON.stringify(body, null, 2).split("\n").map((l) => `     ${l}`).join("\n"));
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ received: true }));
  });
});

server.listen(port, () => {
  console.log(`\n🔍 Webhook receiver listening on http://localhost:${port}/webhooks`);
  if (secret) {
    console.log(`   Signature verification: enabled`);
  } else {
    console.log(`   Signature verification: disabled (pass secret as 2nd arg to enable)`);
  }
  console.log(`\n   Endpoints:`);
  console.log(`     POST http://localhost:${port}/webhooks — receive webhooks`);
  console.log(`     GET  http://localhost:${port}/history  — view received webhooks`);
  console.log(`\n   Press Ctrl+C to stop.\n`);

  // Simple history endpoint
  const origListen = server.listeners("request");
  server.removeAllListeners("request");
  server.on("request", (req, res) => {
    if (req.method === "GET" && req.url === "/history") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(deliveries, null, 2));
      return;
    }
    // Delegate to original handler
    for (const listener of origListen) {
      listener.call(server, req, res);
    }
  });
});
