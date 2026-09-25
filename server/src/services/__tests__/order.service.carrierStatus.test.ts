import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    parcels: { findFirst: vi.fn() },
    riders: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../lib/redis", () => ({
  default: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  scanAndDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../orders/statusLocks", () => ({
  withParcelStatusLocks: vi.fn((_ids: string[], fn: () => Promise<unknown>) => fn()),
}));

import { applyExternalCarrierFollowUp, applyExternalCarrierStatus } from "../order.service";
import prisma from "../../lib/prisma";

const db = prisma as unknown as {
  parcels: { findFirst: ReturnType<typeof vi.fn> };
  riders: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

function parcel(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "parcel-1",
    status,
    tracking_id: "TRK-1",
    vendor_id: null,
    current_location_id: "hub-1",
    delivery_rider_id: null,
    picked_up_at: new Date("2026-01-01"),
    cod_amount: 800,
    ...overrides,
  };
}

function transaction() {
  return {
    parcels: { update: vi.fn() },
    cod_collections: { upsert: vi.fn(), updateMany: vi.fn() },
    parcel_status_history: { create: vi.fn() },
    audit_logs: { create: vi.fn() },
    webhook_endpoints: { findMany: vi.fn().mockResolvedValue([]) },
    webhook_deliveries: { createMany: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.riders.findUnique.mockResolvedValue(null);
});

describe("external carrier status progression", () => {
  it.each([
    ["dispatched", "dispatched"],
    ["sent_for_delivery", "arrived_at_branch"],
    ["delivered", "sent_for_delivery"],
  ] as const)("ignores a %s parcel receiving %s, leaving money and rider untouched", async (current, reported) => {
    db.parcels.findFirst.mockResolvedValue(
      parcel(current, { delivery_rider_id: "employee-1" }),
    );

    await expect(
      applyExternalCarrierStatus("parcel-1", reported, "late webhook"),
    ).resolves.toMatchObject({ applied: false });

    expect(db.riders.findUnique).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("does not revive a parcel that ops moved off the carrier leg", async () => {
    db.parcels.findFirst.mockResolvedValue(parcel("follow_up"));

    await expect(
      applyExternalCarrierStatus("parcel-1", "delivered", "late delivery webhook"),
    ).resolves.toMatchObject({ applied: false });

    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("accepts forward progress while recording the previous and new statuses", async () => {
    const tx = transaction();
    db.parcels.findFirst.mockResolvedValue(parcel("dispatched"));
    db.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await expect(
      applyExternalCarrierStatus("parcel-1", "arrived_at_branch", "hub scan"),
    ).resolves.toMatchObject({ applied: true });

    expect(tx.parcels.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "arrived_at_branch" }) }),
    );
    expect(tx.parcel_status_history.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ old_status: "dispatched", new_status: "arrived_at_branch" }),
      }),
    );
    expect(tx.cod_collections.upsert).not.toHaveBeenCalled();
  });

  it("records a zero-COD delivery so its delivery charge can still be settled", async () => {
    const tx = transaction();
    db.parcels.findFirst.mockResolvedValue(parcel("sent_for_delivery", { cod_amount: 0 }));
    db.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await expect(
      applyExternalCarrierStatus("parcel-1", "delivered", "carrier delivered"),
    ).resolves.toMatchObject({ applied: true });

    expect(tx.cod_collections.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ collected_amount: 0, collected_at: expect.any(Date), rider_id: null }),
        update: expect.objectContaining({ collected_amount: 0, collected_at: expect.any(Date), rider_id: null }),
      }),
    );
  });

  it("releases an employee rider on carrier return without changing collected COD", async () => {
    const tx = transaction();
    db.parcels.findFirst.mockResolvedValue(
      parcel("sent_for_delivery", { delivery_rider_id: "employee-1" }),
    );
    db.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await expect(
      applyExternalCarrierFollowUp("parcel-1", "carrier returning parcel"),
    ).resolves.toMatchObject({ applied: true });

    expect(tx.parcels.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "follow_up", delivery_rider_id: null } }),
    );
    expect(tx.cod_collections.upsert).not.toHaveBeenCalled();
    expect(tx.cod_collections.updateMany).not.toHaveBeenCalled();
  });
});
