import { Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { invalidateVendorFinanceCache, invalidateRiderFinanceCache } from "../finance.service";
import { emitWebhookEvent } from "../webhookDispatch.service";
import { invalidateOrderCaches } from "./cache";
import { getAdminBranchScope, branchTouchesFilter } from "./scope";
import type { OrderActor } from "./types";

// ── Trash (soft-deleted orders) ──────────────────────────────────────────────
// `deleted_at` has always been on parcels and filtered out of every read path;
// these are the first writers of it. The routes are admin-only, so a
// branch-scoped admin is the only actor loadParcelForTrash needs to narrow for
// - everyone else here is unrestricted (see getAdminBranchScope).

/** Cancelled orders older than this are swept into the trash automatically. */
export const CANCELLED_TRASH_AFTER_DAYS = 7;

async function loadParcelForTrash(actor: OrderActor, parcelId: string, opts: { trashed: boolean }) {
  const adminBranchIds = await getAdminBranchScope(actor);
  const parcel = await prisma.parcels.findFirst({
    where: {
      id: parcelId,
      deleted_at: opts.trashed ? { not: null } : null,
      ...(adminBranchIds ? branchTouchesFilter(adminBranchIds) : {}),
    },
    select: {
      id: true, order_number: true, tracking_id: true, status: true, deleted_at: true,
      vendor_id: true, delivery_rider_id: true,
    },
  });
  if (!parcel) {
    throw new AppError(
      404,
      opts.trashed ? "Order not found in trash" : "Order not found",
    );
  }
  return parcel;
}

/**
 * Soft-deletes one order: it leaves every list and lands in the trash.
 *
 * Cancelled only. An order still moving through the pipeline has riders, hubs
 * and a vendor expecting it, and hiding it from every list mid-flight would
 * strand all three - so the workflow has to be finished (or abandoned via
 * cancel) before it can be filed away. That matches the automatic sweep, which
 * also only ever picks up cancelled orders.
 */
export async function moveOrderToTrash(actor: OrderActor, parcelId: string) {
  const parcel = await loadParcelForTrash(actor, parcelId, { trashed: false });

  if (parcel.status !== "cancelled") {
    throw new AppError(
      409,
      "Only cancelled orders can be moved to the trash. Cancel this order first.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.parcels.update({
      where: { id: parcel.id },
      data: { deleted_at: new Date() },
    });
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: parcel.id,
        action: "TRASH_ORDER",
        old_data: { deletedAt: null, status: parcel.status },
        new_data: { deletedAt: new Date().toISOString(), trackingId: parcel.tracking_id },
      },
    });
    // Nothing to unpost. Since the settlement-only ledger no parcel has its own
    // journal entry, and what the vendor is owed before their statement is read
    // from cod_collections and parcels.delivery_charge - both of which already
    // skip deleted_at rows (see billing.service). Trashing takes the parcel out
    // of the balance by the same query that takes it out of the list.
  });

  await invalidateOrderCaches();
  await invalidateTrashFinanceCaches(parcel);
  return { id: parcel.id, trackingId: parcel.tracking_id };
}

// Trashing and restoring both change what a vendor owes and what a rider is
// holding, so the finance views have to be re-read rather than served from the
// cache the previous state populated.
async function invalidateTrashFinanceCaches(parcel: { vendor_id: string | null; delivery_rider_id: string | null }) {
  const jobs: Promise<unknown>[] = [];
  if (parcel.vendor_id) jobs.push(invalidateVendorFinanceCache(parcel.vendor_id));
  if (parcel.delivery_rider_id) jobs.push(invalidateRiderFinanceCache(parcel.delivery_rider_id));
  await Promise.all(jobs).catch((err) => console.error("[Redis] cache invalidation failed:", err));
}

/**
 * The stages a trashed order may be restored into.
 *
 * This is the one sanctioned way past STATUS_TRANSITIONS. A trashed order is
 * usually cancelled, and `cancelled` is terminal - deliberately, so nothing in
 * the normal workflow can un-cancel an order. Restoring from the trash is the
 * exception: it is admin-only, one order at a time, and audited, so an operator
 * putting a wrongly-cancelled parcel back into the pipeline doesn't need the
 * rule relaxed for every screen in the app. It stays enforced everywhere else.
 *
 * pickup_ordered only - a restored order always re-enters at pickup rather
 * than being dropped back in mid-pipeline at whatever stage it was cancelled
 * from.
 */
export const TRASH_RESTORE_STAGES = ["pickup_ordered"] as const;
export type TrashRestoreStage = (typeof TRASH_RESTORE_STAGES)[number];

/**
 * Puts a trashed order back into the live lists, at `restoreTo`.
 *
 * Writes the status change itself rather than delegating to updateParcelStatus:
 * that function enforces STATUS_TRANSITIONS, which is exactly what this has to
 * step around, and adding a bypass flag to it would put the escape hatch on
 * every caller in the app instead of this one. The side effects that matter for
 * a parcel re-entering at pickup are reproduced here - history row, audit
 * row, vendor webhook, ledger sync, cache invalidation.
 */
export async function restoreOrderFromTrash(
  actor: OrderActor,
  parcelId: string,
  restoreTo: TrashRestoreStage,
) {
  if (!TRASH_RESTORE_STAGES.includes(restoreTo)) {
    throw new AppError(400, `restoreTo must be one of: ${TRASH_RESTORE_STAGES.join(", ")}`);
  }
  const parcel = await loadParcelForTrash(actor, parcelId, { trashed: true });

  await prisma.$transaction(async (tx) => {
    await tx.parcels.update({
      where: { id: parcel.id },
      data: { deleted_at: null, status: restoreTo },
    });
    // The timeline has to show where the parcel went and that it was a restore,
    // not a silent jump from "cancelled" to "pickup ordered".
    await tx.parcel_status_history.create({
      data: {
        parcel_id: parcel.id,
        old_status: parcel.status,
        new_status: restoreTo,
        changed_by: actor.id,
        remarks: `Restored from trash — ${parcel.status} → ${restoreTo}`.slice(0, 500),
      },
    });
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: parcel.id,
        action: "RESTORE_ORDER",
        old_data: { deletedAt: parcel.deleted_at?.toISOString() ?? null, status: parcel.status },
        new_data: { deletedAt: null, status: restoreTo, trackingId: parcel.tracking_id },
      },
    });
    // Vendors track parcels through this event; a restore that skipped it would
    // leave their systems believing the order was still cancelled.
    if (parcel.vendor_id) {
      await emitWebhookEvent(tx, parcel.vendor_id, "order.status_changed", {
        trackingId: parcel.tracking_id,
        orderId: parcel.id,
        vendorId: parcel.vendor_id,
        oldStatus: parcel.status,
        newStatus: restoreTo,
        changedAt: new Date().toISOString(),
      });
    }
    // The mirror of the trash case, and equally nothing to do: clearing
    // deleted_at is what puts the parcel back into the vendor balance, because
    // that is the column the billing queries filter on.
  });

  await invalidateOrderCaches();
  await invalidateTrashFinanceCaches(parcel);
  return { id: parcel.id, trackingId: parcel.tracking_id };
}

/**
 * Reports why an order can't be hard-deleted, or null when it's safe to.
 * A parcel with accounting postings can't be deleted at all - journal_lines
 * references it ON DELETE NO ACTION, so Postgres rejects the delete outright -
 * and one with COD records would have them silently cascaded away, taking
 * money movement with it. Both are refused rather than surfaced as a database
 * error or an accidental write-off.
 */
export async function getPermanentDeleteBlocker(parcelId: string): Promise<string | null> {
  const [journalLines, codCollections] = await Promise.all([
    prisma.journal_lines.count({ where: { parcel_id: parcelId } }),
    prisma.cod_collections.count({ where: { parcel_id: parcelId } }),
  ]);
  if (journalLines > 0) {
    return "This order has accounting entries and cannot be deleted. It can stay in the trash instead.";
  }
  if (codCollections > 0) {
    return "This order has COD records and cannot be deleted. It can stay in the trash instead.";
  }
  return null;
}

/**
 * Permanently removes a trashed order. Only ever called for parcels that carry
 * no financial history (see getPermanentDeleteBlocker); the remaining children
 * - remarks, status history, dispatch/run-sheet/manifest links, exceptions,
 * redirects, pickup tasks - are all ON DELETE CASCADE and go with it.
 */
export async function deleteOrderPermanently(actor: OrderActor, parcelId: string) {
  const parcel = await loadParcelForTrash(actor, parcelId, { trashed: true });

  const blocker = await getPermanentDeleteBlocker(parcel.id);
  if (blocker) throw new AppError(409, blocker);

  await prisma.$transaction(async (tx) => {
    // Written before the delete: audit_logs.entity_id has no FK to parcels, but
    // the row it describes must not outlive the record of its removal.
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: parcel.id,
        action: "DELETE_ORDER_PERMANENTLY",
        old_data: {
          orderNumber: parcel.order_number,
          trackingId: parcel.tracking_id,
          status: parcel.status,
          deletedAt: parcel.deleted_at?.toISOString() ?? null,
        },
        new_data: Prisma.JsonNull,
      },
    });
    await tx.parcels.delete({ where: { id: parcel.id } });
  });

  await invalidateOrderCaches();
  return { id: parcel.id, trackingId: parcel.tracking_id };
}

/**
 * Moves cancelled orders into the trash once they've sat cancelled for
 * CANCELLED_TRASH_AFTER_DAYS. "Cancelled at" is the newest parcel_status_history
 * row that landed on `cancelled`, falling back to updated_at for a parcel with
 * no history - the same shape buildOrdersWhere uses for lastUpdatedAt.
 * Idempotent: already-trashed parcels are excluded by `deleted_at: null`.
 */
export async function sweepCancelledOrdersToTrash(): Promise<{ checked: number; trashed: number }> {
  const cutoff = new Date(Date.now() - CANCELLED_TRASH_AFTER_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.parcels.findMany({
    where: {
      status: "cancelled",
      deleted_at: null,
      OR: [
        {
          parcel_status_history: {
            some: { new_status: "cancelled", created_at: { lt: cutoff } },
            none: { created_at: { gte: cutoff } },
          },
        },
        {
          parcel_status_history: { none: {} },
          updated_at: { lt: cutoff },
        },
      ],
    },
    select: { id: true, vendor_id: true, delivery_rider_id: true },
    take: 500,
  });

  if (candidates.length === 0) return { checked: 0, trashed: 0 };

  const ids = candidates.map((c) => c.id);
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.parcels.updateMany({
      where: { id: { in: ids }, deleted_at: null },
      data: { deleted_at: now },
    });
    await tx.audit_logs.createMany({
      data: ids.map((id) => ({
        entity_type: "parcel",
        entity_id: id,
        action: "TRASH_ORDER_AUTO",
        new_data: {
          reason: `cancelled for more than ${CANCELLED_TRASH_AFTER_DAYS} days`,
          trashedAt: now.toISOString(),
        },
      })),
    });
    return updated.count;
  });

  if (result > 0) {
    await invalidateOrderCaches();
    await Promise.all(
      candidates.map((c) => invalidateTrashFinanceCaches(c)),
    );
  }
  return { checked: candidates.length, trashed: result };
}

