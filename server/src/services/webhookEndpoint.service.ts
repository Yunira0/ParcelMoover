import crypto from "crypto";
import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { resolveOwnVendorId, ScopeActor } from "./vendor-scope.service";
import { assertSafeWebhookUrl } from "../lib/webhookUrlGuard";
import { encryptSecret, generateWebhookSecret } from "../lib/webhookCrypto";

// Vendor self-service management of outbound webhook endpoints (the dashboard
// side). Delivery itself lives in webhookDispatch.service.ts.

const MAX_ACTIVE_ENDPOINTS = 5;

async function requireOwnVendorId(actor: ScopeActor): Promise<string> {
  const vendorId = await resolveOwnVendorId(actor);
  if (!vendorId) {
    throw new AppError(403, "Only vendor accounts can manage webhook endpoints");
  }
  return vendorId;
}

async function requireOwnEndpoint(vendorId: string, endpointId: string) {
  const endpoint = await prisma.webhook_endpoints.findFirst({
    where: { id: endpointId, vendor_id: vendorId },
  });
  if (!endpoint) {
    throw new AppError(404, "Webhook endpoint not found");
  }
  return endpoint;
}

export async function createWebhookEndpoint(
  actor: ScopeActor,
  data: { name: string; url: string; eventTypes?: string[] },
) {
  const vendorId = await requireOwnVendorId(actor);

  const activeCount = await prisma.webhook_endpoints.count({ where: { vendor_id: vendorId } });
  if (activeCount >= MAX_ACTIVE_ENDPOINTS) {
    throw new AppError(
      409,
      `You can have at most ${MAX_ACTIVE_ENDPOINTS} webhook endpoints. Delete one first.`,
    );
  }

  await assertSafeWebhookUrl(data.url);

  const plaintextSecret = generateWebhookSecret();

  const created = await prisma.webhook_endpoints.create({
    data: {
      vendor_id: vendorId,
      name: data.name,
      url: data.url,
      secret_encrypted: encryptSecret(plaintextSecret),
      event_types: data.eventTypes ?? [],
    },
    select: { id: true, name: true, url: true, event_types: true, enabled: true, created_at: true },
  });

  return { ...created, secret: plaintextSecret };
}

export async function listWebhookEndpoints(actor: ScopeActor) {
  const vendorId = await requireOwnVendorId(actor);

  return prisma.webhook_endpoints.findMany({
    where: { vendor_id: vendorId },
    select: {
      id: true,
      name: true,
      url: true,
      event_types: true,
      enabled: true,
      consecutive_failures: true,
      disabled_at: true,
      created_at: true,
      updated_at: true,
    },
    orderBy: { created_at: "desc" },
  });
}

export async function updateWebhookEndpoint(
  actor: ScopeActor,
  endpointId: string,
  patch: { name?: string; url?: string; eventTypes?: string[]; enabled?: boolean },
) {
  const vendorId = await requireOwnVendorId(actor);
  await requireOwnEndpoint(vendorId, endpointId);

  if (patch.url) {
    await assertSafeWebhookUrl(patch.url);
  }

  // Re-enabling clears the circuit breaker — the vendor is asserting the
  // endpoint is fixed, so give it a clean slate rather than an immediate
  // re-trip on the next single failure.
  const resetBreaker = patch.enabled === true;

  return prisma.webhook_endpoints.update({
    where: { id: endpointId },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.eventTypes !== undefined ? { event_types: patch.eventTypes } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(resetBreaker ? { consecutive_failures: 0, disabled_at: null } : {}),
    },
    select: { id: true, name: true, url: true, event_types: true, enabled: true, disabled_at: true },
  });
}

export async function deleteWebhookEndpoint(actor: ScopeActor, endpointId: string) {
  const vendorId = await requireOwnVendorId(actor);
  await requireOwnEndpoint(vendorId, endpointId);
  await prisma.webhook_endpoints.delete({ where: { id: endpointId } });
}

export async function regenerateWebhookSecret(actor: ScopeActor, endpointId: string) {
  const vendorId = await requireOwnVendorId(actor);
  await requireOwnEndpoint(vendorId, endpointId);

  const plaintextSecret = generateWebhookSecret();
  await prisma.webhook_endpoints.update({
    where: { id: endpointId },
    data: { secret_encrypted: encryptSecret(plaintextSecret) },
  });

  return { secret: plaintextSecret };
}

export async function listWebhookDeliveries(
  actor: ScopeActor,
  endpointId: string,
  { page, pageSize }: { page: number; pageSize: number },
) {
  const vendorId = await requireOwnVendorId(actor);
  await requireOwnEndpoint(vendorId, endpointId);

  const [data, total] = await Promise.all([
    prisma.webhook_deliveries.findMany({
      where: { webhook_endpoint_id: endpointId },
      orderBy: { created_at: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        event_type: true,
        event_id: true,
        status: true,
        attempt_count: true,
        next_attempt_at: true,
        last_attempted_at: true,
        last_status_code: true,
        last_error: true,
        created_at: true,
      },
    }),
    prisma.webhook_deliveries.count({ where: { webhook_endpoint_id: endpointId } }),
  ]);

  return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

export async function retryWebhookDelivery(actor: ScopeActor, endpointId: string, deliveryId: string) {
  const vendorId = await requireOwnVendorId(actor);
  await requireOwnEndpoint(vendorId, endpointId);

  const delivery = await prisma.webhook_deliveries.findFirst({
    where: { id: deliveryId, webhook_endpoint_id: endpointId },
  });
  if (!delivery) {
    throw new AppError(404, "Delivery not found");
  }

  await prisma.webhook_deliveries.update({
    where: { id: deliveryId },
    data: { status: "pending", attempt_count: 0, next_attempt_at: new Date(), last_error: null },
  });
}

export async function sendTestWebhookEvent(actor: ScopeActor, endpointId: string) {
  const vendorId = await requireOwnVendorId(actor);
  const endpoint = await requireOwnEndpoint(vendorId, endpointId);

  await prisma.webhook_deliveries.create({
    data: {
      webhook_endpoint_id: endpoint.id,
      event_type: "webhook.test",
      event_id: crypto.randomUUID(),
      payload: { message: "This is a test event from ParcelMoover." },
      status: "pending",
      next_attempt_at: new Date(),
    },
  });
}
