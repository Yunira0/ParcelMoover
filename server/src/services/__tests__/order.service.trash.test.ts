import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../utils/AppError";

vi.mock("../../lib/prisma", () => ({
  default: {
    parcels: { findFirst: vi.fn(), findMany: vi.fn() },
    journal_lines: { count: vi.fn() },
    cod_collections: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));
// What the ledger actually writes is covered by the accounting suites; here we
// only care *that* trash/restore drive it, since forgetting to was the original
// bug - a trashed order stayed in the vendor balance it had left every list of.
vi.mock("../accounting/sync", () => ({
  syncParcelPostings: vi.fn().mockResolvedValue(undefined),
  syncParcelPostingsAsync: vi.fn(),
}));
vi.mock("../../lib/redis", () => ({
  default: { set: vi.fn(), del: vi.fn(), get: vi.fn() },
  scanAndDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../finance.service", () => ({
  invalidateVendorFinanceCache: vi.fn().mockResolvedValue(undefined),
  invalidateRiderFinanceCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../vendor-scope.service", () => ({
  resolveOwnVendorId: vi.fn(),
  isStaffActor: vi.fn().mockReturnValue(true),
}));
vi.mock("../notification.service", () => ({ createNotification: vi.fn() }));
vi.mock("../webhookDispatch.service", () => ({
  emitWebhookEvent: vi.fn().mockResolvedValue(undefined),
  emitWebhookEventsBatch: vi.fn().mockResolvedValue(undefined),
}));

import {
  moveOrderToTrash,
  restoreOrderFromTrash,
  deleteOrderPermanently,
  getPermanentDeleteBlocker,
  sweepCancelledOrdersToTrash,
  CANCELLED_TRASH_AFTER_DAYS,
} from "../order.service";
import prisma from "../../lib/prisma";
import { syncParcelPostings, syncParcelPostingsAsync } from "../accounting/sync";
import { invalidateVendorFinanceCache, invalidateRiderFinanceCache } from "../finance.service";
import { emitWebhookEvent } from "../webhookDispatch.service";

const mockedPrisma = prisma as unknown as {
  parcels: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  journal_lines: { count: ReturnType<typeof vi.fn> };
  cod_collections: { count: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const mockedSync = syncParcelPostings as unknown as ReturnType<typeof vi.fn>;
const mockedSyncAsync = syncParcelPostingsAsync as unknown as ReturnType<typeof vi.fn>;
const mockedVendorCache = invalidateVendorFinanceCache as unknown as ReturnType<typeof vi.fn>;
const mockedRiderCache = invalidateRiderFinanceCache as unknown as ReturnType<typeof vi.fn>;
const mockedEmitWebhook = emitWebhookEvent as unknown as ReturnType<typeof vi.fn>;

const ACTOR = { id: "actor-1", roles: ["super_admin"] };

function makeMockTx() {
  return {
    parcels: {
      update: vi.fn().mockResolvedValue({ id: "parcel-1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      delete: vi.fn().mockResolvedValue({ id: "parcel-1" }),
    },
    audit_logs: { create: vi.fn(), createMany: vi.fn() },
    parcel_status_history: { create: vi.fn() },
  };
}

function makeParcel(overrides: Record<string, unknown> = {}) {
  return {
    id: "parcel-1",
    order_number: 2980,
    tracking_id: "PM-260818-ABC",
    status: "cancelled",
    deleted_at: null,
    vendor_id: "vendor-1",
    delivery_rider_id: "rider-1",
    ...overrides,
  };
}

/** Runs the callback the service passes to $transaction and hands back the tx. */
function wireTransaction() {
  const tx = makeMockTx();
  mockedPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
  return tx;
}

beforeEach(() => {
  mockedPrisma.journal_lines.count.mockResolvedValue(0);
  mockedPrisma.cod_collections.count.mockResolvedValue(0);
});

describe("moveOrderToTrash", () => {
  it("soft-deletes the parcel rather than removing the row", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeParcel());
    const tx = wireTransaction();

    await moveOrderToTrash(ACTOR, "parcel-1");

    expect(tx.parcels.update).toHaveBeenCalledTimes(1);
    const args = tx.parcels.update.mock.calls[0]![0];
    expect(args.where).toEqual({ id: "parcel-1" });
    expect(args.data.deleted_at).toBeInstanceOf(Date);
    // A trashing must never destroy the row - that is what /permanent is for.
    expect((tx.parcels as any).delete).not.toHaveBeenCalled();
  });

  it("only considers parcels that are not already trashed", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeParcel());
    wireTransaction();

    await moveOrderToTrash(ACTOR, "parcel-1");

    const query = mockedPrisma.parcels.findFirst.mock.calls[0]![0];
    expect(query.where).toMatchObject({ id: "parcel-1", deleted_at: null });
  });

  it("re-syncs the ledger inside the same transaction", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeParcel());
    const tx = wireTransaction();

    await moveOrderToTrash(ACTOR, "parcel-1");

    expect(mockedSync).toHaveBeenCalledTimes(1);
    const [txArg, ids] = mockedSync.mock.calls[0]!;
    // The tx handle, not the global client: the balance must not be able to
    // disagree with the list even briefly.
    expect(txArg).toBe(tx);
    expect(ids).toEqual(["parcel-1"]);
  });

  it("writes an audit row naming the actor", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeParcel());
    const tx = wireTransaction();

    await moveOrderToTrash(ACTOR, "parcel-1");

    const audit = tx.audit_logs.create.mock.calls[0]![0];
    expect(audit.data).toMatchObject({
      actor_id: "actor-1",
      entity_type: "parcel",
      entity_id: "parcel-1",
      action: "TRASH_ORDER",
    });
  });

  it("invalidates the vendor and rider finance caches", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeParcel());
    wireTransaction();

    await moveOrderToTrash(ACTOR, "parcel-1");

    expect(mockedVendorCache).toHaveBeenCalledWith("vendor-1");
    expect(mockedRiderCache).toHaveBeenCalledWith("rider-1");
  });

  it("skips the finance caches when the parcel has no vendor or rider", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeParcel({ vendor_id: null, delivery_rider_id: null }),
    );
    wireTransaction();

    await moveOrderToTrash(ACTOR, "parcel-1");

    expect(mockedVendorCache).not.toHaveBeenCalled();
    expect(mockedRiderCache).not.toHaveBeenCalled();
  });

  it("404s for an unknown or already-trashed parcel", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(null);

    await expect(moveOrderToTrash(ACTOR, "nope")).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  // Only cancelled orders may be filed away by hand: anything still in flight
  // has a rider, a hub and a vendor expecting it.
  it.each([
    "pickup_ordered",
    "rider_assigned",
    "picked_up",
    "arrived",
    "ready_to_deliver",
    "sent_for_delivery",
    "dispatched",
    "arrived_at_branch",
    "hold",
    "delivered",
    "partially_delivered",
    "failed_pickup",
    "failed_delivery",
    "follow_up",
    "ready_to_return",
    "sent_to_vendor",
    "returned_to_vendor",
    "loss_and_damage",
    "oov",
  ])("refuses to trash a %s order", async (status) => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeParcel({ status }));

    await expect(moveOrderToTrash(ACTOR, "parcel-1")).rejects.toMatchObject({
      statusCode: 409,
    });
    // Refused before any write opens, so nothing can half-apply.
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("allows a cancelled order through", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeParcel({ status: "cancelled" }));
    const tx = wireTransaction();

    await moveOrderToTrash(ACTOR, "parcel-1");

    expect(tx.parcels.update).toHaveBeenCalledTimes(1);
  });
});

describe("restoreOrderFromTrash", () => {
  it("clears deleted_at and lands the order at the requested stage", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeParcel({ deleted_at: new Date() }));
    const tx = wireTransaction();

    await restoreOrderFromTrash(ACTOR, "parcel-1", "pickup_ordered");

    const args = tx.parcels.update.mock.calls[0]![0];
    expect(args.data).toEqual({ deleted_at: null, status: "pickup_ordered" });
  });

  it("un-cancels a cancelled order, which STATUS_TRANSITIONS forbids elsewhere", async () => {
    // The whole point of the exception: `cancelled` is terminal in the normal
    // workflow, so this is the only path that may move one.
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeParcel({ status: "cancelled", deleted_at: new Date() }),
    );
    const tx = wireTransaction();

    await restoreOrderFromTrash(ACTOR, "parcel-1", "ready_to_deliver");

    expect(tx.parcels.update.mock.calls[0]![0].data.status).toBe("ready_to_deliver");
  });

  it("rejects a stage outside the allow-list", async () => {
    await expect(
      restoreOrderFromTrash(ACTOR, "parcel-1", "delivered" as any),
    ).rejects.toMatchObject({ statusCode: 400 });
    // Refused before the parcel is even loaded, so nothing can partially apply.
    expect(mockedPrisma.parcels.findFirst).not.toHaveBeenCalled();
  });

  it("records the move on the parcel's timeline", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeParcel({ status: "cancelled", deleted_at: new Date() }),
    );
    const tx = wireTransaction();

    await restoreOrderFromTrash(ACTOR, "parcel-1", "pickup_ordered");

    const history = tx.parcel_status_history.create.mock.calls[0]![0];
    expect(history.data).toMatchObject({
      parcel_id: "parcel-1",
      old_status: "cancelled",
      new_status: "pickup_ordered",
      changed_by: "actor-1",
    });
  });

  it("tells the vendor's webhook the order moved", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeParcel({ status: "cancelled", deleted_at: new Date() }),
    );
    const tx = wireTransaction();

    await restoreOrderFromTrash(ACTOR, "parcel-1", "ready_to_deliver");

    expect(mockedEmitWebhook).toHaveBeenCalledTimes(1);
    const [txArg, vendorId, event, payload] = mockedEmitWebhook.mock.calls[0]!;
    expect(txArg).toBe(tx);
    expect(vendorId).toBe("vendor-1");
    expect(event).toBe("order.status_changed");
    expect(payload).toMatchObject({ oldStatus: "cancelled", newStatus: "ready_to_deliver" });
  });

  it("skips the webhook for a vendorless parcel", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeParcel({ deleted_at: new Date(), vendor_id: null }),
    );
    wireTransaction();

    await restoreOrderFromTrash(ACTOR, "parcel-1", "pickup_ordered");

    expect(mockedEmitWebhook).not.toHaveBeenCalled();
  });

  it("only looks at parcels that are actually in the trash", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeParcel({ deleted_at: new Date() }));
    wireTransaction();

    await restoreOrderFromTrash(ACTOR, "parcel-1", "pickup_ordered");

    const query = mockedPrisma.parcels.findFirst.mock.calls[0]![0];
    expect(query.where.deleted_at).toEqual({ not: null });
  });

  it("re-derives the ledger postings the trashing reversed", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeParcel({ deleted_at: new Date() }));
    const tx = wireTransaction();

    await restoreOrderFromTrash(ACTOR, "parcel-1", "pickup_ordered");

    expect(mockedSync).toHaveBeenCalledTimes(1);
    const [txArg, ids] = mockedSync.mock.calls[0]!;
    expect(txArg).toBe(tx);
    expect(ids).toEqual(["parcel-1"]);
  });

  it("404s when the parcel is not in the trash", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(null);

    await expect(restoreOrderFromTrash(ACTOR, "parcel-1", "pickup_ordered")).rejects.toBeInstanceOf(
      AppError,
    );
  });
});

describe("getPermanentDeleteBlocker", () => {
  it("blocks a parcel carrying accounting entries", async () => {
    mockedPrisma.journal_lines.count.mockResolvedValue(3);

    await expect(getPermanentDeleteBlocker("parcel-1")).resolves.toMatch(/accounting entries/i);
  });

  it("blocks a parcel carrying COD records", async () => {
    mockedPrisma.cod_collections.count.mockResolvedValue(1);

    await expect(getPermanentDeleteBlocker("parcel-1")).resolves.toMatch(/COD records/i);
  });

  it("allows a parcel with no financial history", async () => {
    await expect(getPermanentDeleteBlocker("parcel-1")).resolves.toBeNull();
  });
});

describe("deleteOrderPermanently", () => {
  it("refuses with 409 and leaves the row alone when finance records exist", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeParcel({ deleted_at: new Date() }));
    mockedPrisma.journal_lines.count.mockResolvedValue(2);
    const tx = wireTransaction();

    await expect(deleteOrderPermanently(ACTOR, "parcel-1")).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(tx.parcels.delete).not.toHaveBeenCalled();
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("deletes the row once nothing financial references it", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeParcel({ deleted_at: new Date() }));
    const tx = wireTransaction();

    await deleteOrderPermanently(ACTOR, "parcel-1");

    expect(tx.parcels.delete).toHaveBeenCalledWith({ where: { id: "parcel-1" } });
  });

  it("records the audit row before the delete, so the evidence outlives the row", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeParcel({ deleted_at: new Date() }));
    const order: string[] = [];
    const tx = makeMockTx();
    tx.audit_logs.create.mockImplementation(async () => { order.push("audit"); });
    tx.parcels.delete.mockImplementation(async () => { order.push("delete"); return {}; });
    mockedPrisma.$transaction.mockImplementation(async (cb: any) => cb(tx));

    await deleteOrderPermanently(ACTOR, "parcel-1");

    expect(order).toEqual(["audit", "delete"]);
  });

  it("only deletes parcels already sitting in the trash", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(null);

    await expect(deleteOrderPermanently(ACTOR, "parcel-1")).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe("sweepCancelledOrdersToTrash", () => {
  const candidates = [
    { id: "p1", vendor_id: "v1", delivery_rider_id: null },
    { id: "p2", vendor_id: null, delivery_rider_id: "r2" },
  ];

  it("selects only cancelled, not-already-trashed parcels", async () => {
    mockedPrisma.parcels.findMany.mockResolvedValue(candidates);
    wireTransaction();

    await sweepCancelledOrdersToTrash();

    const query = mockedPrisma.parcels.findMany.mock.calls[0]![0];
    expect(query.where).toMatchObject({ status: "cancelled", deleted_at: null });
  });

  it("uses a cutoff of CANCELLED_TRASH_AFTER_DAYS ago", async () => {
    mockedPrisma.parcels.findMany.mockResolvedValue([]);

    const before = Date.now();
    await sweepCancelledOrdersToTrash();

    const query = mockedPrisma.parcels.findMany.mock.calls[0]![0];
    const cutoff: Date = query.where.OR[1].updated_at.lt;
    const expected = before - CANCELLED_TRASH_AFTER_DAYS * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoff.getTime() - expected)).toBeLessThan(5000);
  });

  it("caps a single run so one sweep can't take the whole back catalogue", async () => {
    mockedPrisma.parcels.findMany.mockResolvedValue([]);

    await sweepCancelledOrdersToTrash();

    const query = mockedPrisma.parcels.findMany.mock.calls[0]![0];
    expect(query.take).toBe(500);
  });

  it("does nothing at all when there is nothing to sweep", async () => {
    mockedPrisma.parcels.findMany.mockResolvedValue([]);

    const result = await sweepCancelledOrdersToTrash();

    expect(result).toEqual({ checked: 0, trashed: 0 });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockedSyncAsync).not.toHaveBeenCalled();
  });

  it("trashes the batch and reports what it did", async () => {
    mockedPrisma.parcels.findMany.mockResolvedValue(candidates);
    const tx = wireTransaction();

    const result = await sweepCancelledOrdersToTrash();

    expect(result).toEqual({ checked: 2, trashed: 2 });
    const args = tx.parcels.updateMany.mock.calls[0]![0];
    // The deleted_at guard is repeated in the write, so a parcel trashed by a
    // concurrent sweep between the read and the write is not re-stamped.
    expect(args.where).toMatchObject({ id: { in: ["p1", "p2"] }, deleted_at: null });
    expect(args.data.deleted_at).toBeInstanceOf(Date);
  });

  it("audits each swept parcel as an automatic trashing", async () => {
    mockedPrisma.parcels.findMany.mockResolvedValue(candidates);
    const tx = wireTransaction();

    await sweepCancelledOrdersToTrash();

    const audit = tx.audit_logs.createMany.mock.calls[0]![0];
    expect(audit.data).toHaveLength(2);
    // Distinguishable from a hand-trashing, and with no actor - nobody did it.
    expect(audit.data[0]).toMatchObject({ action: "TRASH_ORDER_AUTO", entity_id: "p1" });
    expect(audit.data[0].actor_id).toBeUndefined();
  });

  it("re-syncs the ledger for the batch outside the transaction", async () => {
    mockedPrisma.parcels.findMany.mockResolvedValue(candidates);
    wireTransaction();

    await sweepCancelledOrdersToTrash();

    // Async, so posting up to 500 parcels can't hold the sweep's transaction.
    expect(mockedSyncAsync).toHaveBeenCalledWith(["p1", "p2"], expect.any(Object));
    expect(mockedSync).not.toHaveBeenCalled();
  });

  it("invalidates finance caches only for the parties that exist", async () => {
    mockedPrisma.parcels.findMany.mockResolvedValue(candidates);
    wireTransaction();

    await sweepCancelledOrdersToTrash();

    expect(mockedVendorCache).toHaveBeenCalledTimes(1);
    expect(mockedVendorCache).toHaveBeenCalledWith("v1");
    expect(mockedRiderCache).toHaveBeenCalledTimes(1);
    expect(mockedRiderCache).toHaveBeenCalledWith("r2");
  });

  it("is idempotent: a second pass with nothing left trashes nothing", async () => {
    mockedPrisma.parcels.findMany.mockResolvedValueOnce(candidates).mockResolvedValueOnce([]);
    wireTransaction();

    const first = await sweepCancelledOrdersToTrash();
    const second = await sweepCancelledOrdersToTrash();

    expect(first.trashed).toBe(2);
    expect(second).toEqual({ checked: 0, trashed: 0 });
  });
});
