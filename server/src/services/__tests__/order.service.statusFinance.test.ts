import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    parcels: { findFirst: vi.fn(), findMany: vi.fn() },
    cod_collections: { findFirst: vi.fn(), findMany: vi.fn() },
    admins: { findFirst: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../lib/redis", () => ({
  default: { set: vi.fn(), del: vi.fn(), get: vi.fn() },
  scanAndDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../accounting/sync", () => ({
  syncParcelPostings: vi.fn().mockResolvedValue(undefined),
  syncParcelPostingsAsync: vi.fn(),
}));
vi.mock("../notification.service", () => ({ createNotification: vi.fn() }));
vi.mock("../orders/statusLocks", () => ({
  withParcelStatusLocks: vi.fn((_ids: string[], fn: () => Promise<unknown>) => fn()),
}));

import { bulkUpdateParcelStatus, updateParcelStatus } from "../order.service";
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";

const db = prisma as unknown as {
  parcels: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  cod_collections: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const cache = redis as unknown as { set: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> };
const admin = { id: "admin-1", roles: ["admin"] };
const root = { id: "root-1", roles: ["super_admin"] };

function parcel(id: string, status: string) {
  return {
    id,
    status,
    tracking_id: `TRK-${id}`,
    vendor_id: null,
    order_type: "forward",
    cod_amount: 1200,
    delivery_charge: 100,
    delivery_rider_id: "rider-1",
    pickup_tasks: null,
    current_location_id: null,
    destination_location_id: null,
    picked_up_at: new Date("2026-01-01"),
  };
}

function transaction() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    parcels: {
      update: vi.fn().mockResolvedValue({ id: "p1", status: "follow_up" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    cod_collections: { updateMany: vi.fn(), upsert: vi.fn() },
    parcel_status_history: { create: vi.fn(), createMany: vi.fn() },
    parcel_remarks: { create: vi.fn(), createMany: vi.fn() },
    audit_logs: { create: vi.fn(), createMany: vi.fn() },
    webhook_endpoints: { findMany: vi.fn().mockResolvedValue([]) },
    webhook_deliveries: { createMany: vi.fn() },
    return_manifest_parcels: { deleteMany: vi.fn() },
    transit_manifest_parcels: { deleteMany: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cache.set.mockResolvedValue("OK");
  cache.del.mockResolvedValue(1);
  db.cod_collections.findFirst.mockResolvedValue(null);
  db.cod_collections.findMany.mockResolvedValue([]);
});

describe("status changes preserve settled COD", () => {
  const settlement = {
    parcels: { tracking_id: "TRK-p1" },
    settlement_items: [{ settlements: { statement_id: "STM-1", payee_type: "rider" } }],
  };

  it("refuses a single delivered-order reversal before writing anything", async () => {
    db.parcels.findFirst.mockResolvedValue(parcel("p1", "delivered"));
    db.cod_collections.findMany.mockResolvedValue([{ parcels: settlement.parcels }]);

    await expect(
      updateParcelStatus(root, "p1", { status: "follow_up" }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a bulk reversal atomically when one order is in a settlement", async () => {
    db.parcels.findMany.mockResolvedValue([
      parcel("p1", "delivered"),
      parcel("p2", "partially_delivered"),
    ]);
    db.cod_collections.findMany.mockResolvedValue([{ parcels: settlement.parcels }]);
    db.cod_collections.findFirst.mockResolvedValue(settlement);

    await expect(
      bulkUpdateParcelStatus(root, { ids: ["p1", "p2"], status: "follow_up" }),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("lets a partial delivery proceed to follow up without reversing its cash", async () => {
    const tx = transaction();
    db.parcels.findFirst.mockResolvedValue(parcel("p1", "partially_delivered"));
    db.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await updateParcelStatus(admin, "p1", { status: "follow_up" });

    expect(tx.parcels.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ delivery_rider_id: null }) }),
    );
    expect(db.cod_collections.findFirst).not.toHaveBeenCalled();
    expect(tx.cod_collections.updateMany).not.toHaveBeenCalled();
  });

  it("keeps partial delivery cash intact in the bulk path too", async () => {
    const tx = transaction();
    db.parcels.findMany.mockResolvedValue([parcel("p1", "partially_delivered")]);
    db.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await expect(
      bulkUpdateParcelStatus(admin, { ids: ["p1"], status: "follow_up" }),
    ).resolves.toMatchObject({ updatedCount: 1 });

    expect(db.cod_collections.findFirst).not.toHaveBeenCalled();
    expect(tx.cod_collections.updateMany).not.toHaveBeenCalled();
    expect(tx.parcels.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { delivery_rider_id: null } }),
    );
  });
});
