import crypto from "crypto";
import { Prisma } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import { decryptSecret, signPayload } from "../lib/webhookCrypto";
import { sendWebhookDisabledEmail } from "../lib/mailer";

// Delivery engine for outbound vendor webhooks. There's no job queue in this
// codebase and Redis isn't configured as durable storage, so Postgres is the
// outbox: emitWebhookEvent writes pending rows inside the same transaction as
// the order-status change it describes (so a webhook can never fire for a
// change that got rolled back, and never gets silently dropped once the
// transaction commits). runDeliverySweep, called on a short interval from
// index.ts, drains and retries those rows.

const REQUEST_TIMEOUT_MS = 10_000;
const BATCH_SIZE = 100;
const DELIVERY_CONCURRENCY = 10;
const MAX_ATTEMPTS = 12; // ~24h span with the backoff schedule below
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000; // 6h
const CIRCUIT_BREAKER_THRESHOLD = 5; // consecutive fully-exhausted deliveries

function nextBackoffMs(attemptCount: number): number {
  const raw = Math.min(BASE_BACKOFF_MS * 2 ** attemptCount, MAX_BACKOFF_MS);
  const jitter = raw * (0.85 + Math.random() * 0.3); // +/-15%
  return Math.round(jitter);
}

type WebhookEventData = Record<string, unknown>;

/**
 * Enqueues one delivery per enabled endpoint subscribed to eventType, for the
 * given vendor. Must be called with the same `tx` the caller's status change
 * is committing in, so the enqueue is part of that atomic write.
 */
export async function emitWebhookEvent(
  tx: Prisma.TransactionClient,
  vendorId: string,
  eventType: string,
  data: WebhookEventData,
): Promise<void> {
  const endpoints = await tx.webhook_endpoints.findMany({
    where: {
      vendor_id: vendorId,
      enabled: true,
      disabled_at: null,
    },
    select: { id: true, event_types: true },
  });

  const targets = endpoints.filter(
    (e) => e.event_types.length === 0 || e.event_types.includes(eventType),
  );
  if (targets.length === 0) return;

  const createdAt = new Date();
  await tx.webhook_deliveries.createMany({
    data: targets.map((endpoint) => {
      // One id shared by the X-ParcelMoover-Delivery header and the payload's
      // own `id` field (previously two independent randomUUID() calls) - a
      // vendor dedup-ing on whichever one they noticed first should always
      // get the same value back on retries.
      const eventId = crypto.randomUUID();
      return {
        webhook_endpoint_id: endpoint.id,
        event_type: eventType,
        event_id: eventId,
        payload: {
          id: eventId,
          type: eventType,
          created_at: createdAt.toISOString(),
          data,
        } as Prisma.InputJsonValue,
        status: "pending",
        next_attempt_at: createdAt,
      };
    }),
  });
}

type PendingDelivery = {
  id: string;
  event_type: string;
  event_id: string;
  payload: Prisma.JsonValue;
  attempt_count: number;
  webhook_endpoint_id: string;
  webhook_endpoints: { id: string; url: string; secret_encrypted: string; consecutive_failures: number };
};

async function deliverOne(delivery: PendingDelivery): Promise<void> {
  const endpoint = delivery.webhook_endpoints;
  const rawBody = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);

  let secret: string;
  try {
    secret = decryptSecret(endpoint.secret_encrypted);
  } catch (error) {
    console.error(`[Webhook] Failed to decrypt secret for endpoint ${endpoint.id}:`, error);
    await failDelivery(delivery, null, "Server-side secret decryption failure");
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ParcelMoover-Event": delivery.event_type,
        "X-ParcelMoover-Delivery": delivery.event_id,
        "X-ParcelMoover-Signature": signPayload(secret, timestamp, rawBody),
      },
      body: rawBody,
      signal: controller.signal,
    });

    if (response.ok) {
      await succeedDelivery(delivery, response.status);
    } else {
      await failDelivery(delivery, response.status, `HTTP ${response.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failDelivery(delivery, null, message);
  } finally {
    clearTimeout(timer);
  }
}

async function succeedDelivery(delivery: PendingDelivery, statusCode: number): Promise<void> {
  await prisma.$transaction([
    prisma.webhook_deliveries.update({
      where: { id: delivery.id },
      data: {
        status: "succeeded",
        attempt_count: { increment: 1 },
        last_attempted_at: new Date(),
        last_status_code: statusCode,
        last_error: null,
      },
    }),
    prisma.webhook_endpoints.update({
      where: { id: delivery.webhook_endpoint_id },
      data: { consecutive_failures: 0 },
    }),
  ]);
}

async function failDelivery(
  delivery: PendingDelivery,
  statusCode: number | null,
  errorMessage: string,
): Promise<void> {
  const attemptCount = delivery.attempt_count + 1;
  const exhausted = attemptCount >= MAX_ATTEMPTS;

  await prisma.webhook_deliveries.update({
    where: { id: delivery.id },
    data: {
      status: exhausted ? "failed" : "pending",
      attempt_count: attemptCount,
      last_attempted_at: new Date(),
      last_status_code: statusCode,
      last_error: errorMessage.slice(0, 500),
      ...(exhausted ? {} : { next_attempt_at: new Date(Date.now() + nextBackoffMs(attemptCount)) }),
    },
  });

  if (!exhausted) return;

  const endpoint = await prisma.webhook_endpoints.update({
    where: { id: delivery.webhook_endpoint_id },
    data: { consecutive_failures: { increment: 1 } },
    select: { id: true, name: true, url: true, consecutive_failures: true, disabled_at: true },
  });

  if (!endpoint.disabled_at && endpoint.consecutive_failures >= CIRCUIT_BREAKER_THRESHOLD) {
    await prisma.webhook_endpoints.update({
      where: { id: endpoint.id },
      data: { disabled_at: new Date() },
    });
    console.warn(
      `[Webhook] Endpoint ${endpoint.id} auto-disabled after ${endpoint.consecutive_failures} consecutive failed deliveries`,
    );
    await notifyEndpointDisabled(endpoint.id, endpoint.name, endpoint.url);
  }
}

// Best-effort - a mail failure here must never re-throw into the delivery
// sweep, which has already committed the disable and moved on to the next
// row. Runs off the hot path (only on the rare breaker-trip), so the extra
// vendor/user lookup here (rather than joining it into every batch query)
// is the right tradeoff.
async function notifyEndpointDisabled(endpointId: string, name: string, url: string): Promise<void> {
  try {
    const endpoint = await prisma.webhook_endpoints.findUnique({
      where: { id: endpointId },
      select: {
        vendors: {
          select: {
            client_name: true,
            email: true,
            users: { select: { email: true } },
          },
        },
      },
    });
    const to = endpoint?.vendors.email || endpoint?.vendors.users?.email;
    if (!to) return;

    await sendWebhookDisabledEmail({
      to,
      vendorName: endpoint.vendors.client_name,
      endpointName: name,
      endpointUrl: url,
    });
  } catch (error) {
    console.error(`[Webhook] Failed to send disable notification for endpoint ${endpointId}:`, error);
  }
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const item = items[index]!;
      index++;
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Second, cheaper guard against overlapping sweeps, on top of the Redis lock
// in index.ts. That lock is skipped entirely when Redis errors on acquire
// ("run anyway; delivery is idempotent" - see the comment there), and a full
// sweep can legitimately run past the 15s tick interval under a large batch
// (up to BATCH_SIZE at DELIVERY_CONCURRENCY, each up to REQUEST_TIMEOUT_MS).
// Without this, either case lets two sweeps race the same "pending" rows
// before either has written back a new status, double-firing each one.
// Rows are still safe if this guard is somehow bypassed - retries are
// idempotent for a vendor that dedupes on the delivery id per the docs -
// this just keeps that from becoming the common case.
let sweepInFlight = false;

export async function runDeliverySweep(): Promise<{ attempted: number }> {
  if (sweepInFlight) return { attempted: 0 };
  sweepInFlight = true;
  try {
    return await runDeliverySweepInner();
  } finally {
    sweepInFlight = false;
  }
}

async function runDeliverySweepInner(): Promise<{ attempted: number }> {
  const due = (await prisma.webhook_deliveries.findMany({
    where: {
      status: "pending",
      next_attempt_at: { lte: new Date() },
      webhook_endpoints: { enabled: true, disabled_at: null },
    },
    orderBy: { next_attempt_at: "asc" },
    take: BATCH_SIZE,
    include: {
      webhook_endpoints: {
        select: { id: true, url: true, secret_encrypted: true, consecutive_failures: true },
      },
    },
  })) as PendingDelivery[];

  if (due.length === 0) return { attempted: 0 };

  await runWithConcurrency(due, DELIVERY_CONCURRENCY, deliverOne);
  return { attempted: due.length };
}
