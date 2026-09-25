import { AppError } from "../../utils/AppError";
import type { BulkCreateOrderInput, CreateOrderInput, OrderPartyInput } from "../../types/order.type";
import { assertVendorCanCreateOrder } from "../billing.service";
import { invalidateVendorFinanceCache } from "../finance.service";
import { resolveOwnVendorId } from "../vendor-scope.service";
import { invalidateOrderCaches } from "./cache";
import { createOrderCore } from "./create";
import type { OrderActor } from "./types";

const BULK_CREATE_MAX = 100;

// Each order runs its own multi-query transaction (tracking id, party lookup,
// rate quote, parcel + 4 secondary writes). Running all of them fully
// sequentially serializes ~12+ round trips per order across the whole batch,
// which risks request timeouts at BULK_CREATE_MAX. Capped concurrency keeps
// orders isolated (one failing order still can't affect another) while
// staying well under the DB pool's connection limit (see lib/prisma.ts).
const BULK_CREATE_CONCURRENCY = 5;

export async function bulkCreateOrders(actor: OrderActor, input: BulkCreateOrderInput, signal?: AbortSignal) {
  if (!Array.isArray(input.orders) || input.orders.length === 0) {
    throw new AppError(400, "orders must be a non-empty array");
  }
  if (input.orders.length > BULK_CREATE_MAX) {
    throw new AppError(400, `Maximum ${BULK_CREATE_MAX} orders per bulk request`);
  }

  // Credit control, resolved once for the whole import instead of per row.
  // When the importer is a vendor account every row belongs to that vendor, so
  // one check clears the batch and the per-row guard can be skipped. A staff or
  // sales importer can name a different vendor on each row, so those fall
  // through to the per-row check (cheap - it reads the cached balance).
  const importingVendorId = await resolveOwnVendorId(actor);
  if (importingVendorId) {
    await assertVendorCanCreateOrder(importingVendorId);
  }

  let created = 0;
  let failed = 0;
  const results: Array<
    | { index: number; success: true; trackingId: string }
    | { index: number; success: false; error: string }
  > = new Array(input.orders.length);
  const vendorIdsToInvalidate = new Set<string>();

  // Cheap, DB-free validation happens up front and in original order;
  // only orders that pass it hit the database.
  const toCreate: Array<{ index: number; data: CreateOrderInput }> = [];

  for (let i = 0; i < input.orders.length; i++) {
    const raw = input.orders[i]!;
    // Merge defaultSender only when the order doesn't supply its own sender.
    const resolvedSender: OrderPartyInput | undefined =
      raw.sender?.phone ? raw.sender : input.defaultSender;

    if (!resolvedSender?.name || !resolvedSender?.phone) {
      results[i] = { index: i, success: false, error: "Sender name and phone are required" };
      failed++;
      continue;
    }

    if (!raw.receiver?.name || !raw.receiver?.phone) {
      results[i] = { index: i, success: false, error: "Receiver name and phone are required" };
      failed++;
      continue;
    }

    toCreate.push({
      index: i,
      data: { ...raw, sender: resolvedSender, receiver: raw.receiver },
    });
  }

  for (let start = 0; start < toCreate.length; start += BULK_CREATE_CONCURRENCY) {
    if (signal?.aborted) {
      // Client disconnected - stop opening new transactions for orders it'll
      // never see the result of. Record the remainder as not-processed
      // rather than silently omitting them, so this (still-cached, since
      // it's not an error) response stays honest about what happened; a
      // genuinely new attempt needs a fresh Idempotency-Key, not a retry of
      // this one, since some of this batch already committed.
      for (let j = start; j < toCreate.length; j++) {
        const { index } = toCreate[j]!;
        results[index] = { index, success: false, error: "Not processed - request was cancelled by the client" };
        failed++;
      }
      break;
    }

    const chunk = toCreate.slice(start, start + BULK_CREATE_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map(({ data }) => createOrderCore(actor, data, { skipBillingCheck: Boolean(importingVendorId) })),
    );

    settled.forEach((outcome, offset) => {
      const { index } = chunk[offset]!;
      if (outcome.status === "fulfilled") {
        const parcel = outcome.value;
        results[index] = { index, success: true, trackingId: parcel.tracking_id };
        created++;
        if (parcel.vendor_id) vendorIdsToInvalidate.add(parcel.vendor_id);
      } else {
        const err = outcome.reason as any;
        results[index] = { index, success: false, error: err?.message || "Order creation failed" };
        failed++;
      }
    });
  }

  // Flush caches once for the whole batch instead of after each individual order.
  if (created > 0) {
    await invalidateOrderCaches();
    await Promise.all(Array.from(vendorIdsToInvalidate, (id) => invalidateVendorFinanceCache(id)));
  }

  // New orders no longer notify admins (see createOrder) - a bulk import would
  // otherwise fire a ping per parcel and bury the feed.

  return { created, failed, results };
}
