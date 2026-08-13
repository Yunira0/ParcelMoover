import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../utils/AppError";

// Regression coverage for reconcileCodCollectionOnStatusChange: a parcel
// reverted away from delivered/partially_delivered/returned_to_vendor must
// not leave a stale, settlement-eligible cod_collections row behind (the bug
// that let PM-260806-AD7W734DPANEM-X get paid out before it was genuinely
// delivered - see order.service.ts's reconcileCodCollectionOnStatusChange).

vi.mock("../../lib/prisma", () => ({
  default: {
    parcels: { findFirst: vi.fn(), findMany: vi.fn() },
    locations: { findUnique: vi.fn() },
    vendors: { findUnique: vi.fn(), findMany: vi.fn() },
    riders: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../lib/redis", () => ({
  default: { set: vi.fn(), del: vi.fn() },
  scanAndDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../vendor-scope.service", () => ({
  resolveOwnVendorId: vi.fn(),
}));
vi.mock("../notification.service", () => ({
  createNotification: vi.fn(),
}));

import { updateParcelStatus, bulkUpdateParcelStatus } from "../order.service";
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";

const mockedPrisma = prisma as unknown as {
  parcels: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  vendors: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  riders: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const mockedRedis = redis as unknown as { set: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> };

// cod_collections.findUnique's return shape as consumed by
// reconcileCodCollectionOnStatusChange (id + settlement_items -> settlements).
function makeCollection(settlementItems: Array<{ statement_id: string; payee_type: string; status: string }>) {
  return {
    id: "cod-1",
    parcel_id: "parcel-1",
    settlement_items: settlementItems.map((s) => ({ settlements: s })),
  };
}

function makeMockTx(collection: ReturnType<typeof makeCollection> | null) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "cod-1" }]),
    cod_collections: {
      findUnique: vi.fn().mockResolvedValue(collection),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      upsert: vi.fn().mockResolvedValue({}),
    },
    pickup_tasks: { update: vi.fn(), updateMany: vi.fn() },
    parcels: {
      update: vi.fn().mockResolvedValue({ id: "parcel-1", status: "ready_to_deliver" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    parcel_status_history: { create: vi.fn(), createMany: vi.fn() },
    parcel_remarks: { create: vi.fn(), createMany: vi.fn() },
    audit_logs: { create: vi.fn(), createMany: vi.fn() },
    webhook_endpoints: { findMany: vi.fn().mockResolvedValue([]) },
    webhook_deliveries: { createMany: vi.fn() },
  };
}

// A parcel sitting in "delivered" - only a super_admin-forced transition can
// move it anywhere (see TERMINAL_STATUSES / STATUS_TRANSITIONS), which is
// exactly the real-world path that caused the incident.
function makeDeliveredParcel(overrides: Record<string, unknown> = {}) {
  return {
    id: "parcel-1",
    status: "delivered",
    order_type: "delivery",
    vendor_id: null,
    delivery_rider_id: null,
    cod_amount: 1700,
    tracking_id: "PM-TEST",
    current_location_id: null,
    destination_location_id: null,
    pickup_tasks: null,
    vendors: null,
    ...overrides,
  };
}

const superAdmin = { id: "admin-1", roles: ["super_admin"] };

describe("cod_collections reconciliation on parcel status revert", () => {
  beforeEach(() => {
    mockedRedis.set.mockResolvedValue("OK");
    mockedRedis.del.mockResolvedValue(1);
  });

  it("blocks reverting a delivered parcel when its cod_collections row is already claimed by a settlement", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeDeliveredParcel());
    const collection = makeCollection([{ statement_id: "STM-R-260808-E862TG", payee_type: "rider", status: "settled" }]);
    const tx = makeMockTx(collection);
    mockedPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await expect(
      updateParcelStatus(superAdmin, "parcel-1", { status: "ready_to_deliver" as any }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // The block must happen before any write - parcel status itself must not change.
    expect(tx.parcels.update).not.toHaveBeenCalled();
    expect(tx.cod_collections.update).not.toHaveBeenCalled();
  });

  it("auto-resets cod_collections when reverting a delivered parcel that isn't claimed by any settlement", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeDeliveredParcel());
    const collection = makeCollection([]); // unclaimed
    const tx = makeMockTx(collection);
    mockedPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await expect(
      updateParcelStatus(superAdmin, "parcel-1", { status: "ready_to_deliver" as any }),
    ).resolves.toBeDefined();

    expect(tx.cod_collections.update).toHaveBeenCalledWith({
      where: { parcel_id: "parcel-1" },
      data: {
        collected_at: null,
        collected_amount: 0,
        payment_status: "pending",
        rider_payment_status: "pending",
        remitted_amount: 0,
        rider_remitted_amount: 0,
        rider_settled_at: null,
      },
    });
    // And the parcel status transition itself still goes through.
    expect(tx.parcels.update).toHaveBeenCalled();
  });

  it("resets payment_status back to pending when a parcel is genuinely re-delivered on an unclaimed row", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeDeliveredParcel({ status: "ready_to_deliver" }),
    );
    const collection = makeCollection([]);
    const tx = makeMockTx(collection);
    mockedPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await expect(
      updateParcelStatus(superAdmin, "parcel-1", { status: "delivered" as any }),
    ).resolves.toBeDefined();

    expect(tx.cod_collections.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          payment_status: "pending",
          rider_payment_status: "pending",
        }),
      }),
    );
  });

  it("rejects a whole bulk batch atomically when any one parcel's collection is claimed by a settlement", async () => {
    const parcelA = makeDeliveredParcel({ id: "parcel-a", tracking_id: "PM-A" });
    const parcelB = makeDeliveredParcel({ id: "parcel-b", tracking_id: "PM-B" });
    mockedPrisma.parcels.findMany.mockResolvedValue([parcelA, parcelB]);

    const claimedCollection = makeCollection([{ statement_id: "STM-V-1", payee_type: "vendor", status: "settled" }]);
    const tx = makeMockTx(null); // findUnique overridden per-call below
    (tx.cod_collections.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeCollection([])) // parcel-a: unclaimed
      .mockResolvedValueOnce(claimedCollection); // parcel-b: claimed -> should abort the batch
    mockedPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await expect(
      bulkUpdateParcelStatus(superAdmin, { ids: ["parcel-a", "parcel-b"], status: "ready_to_deliver" as any }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // Neither parcel's status write should have happened - all-or-nothing.
    expect(tx.parcels.updateMany).not.toHaveBeenCalled();
  });
});
