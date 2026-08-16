import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../utils/AppError";

vi.mock("../../lib/prisma", () => ({
  default: {
    parcels: { findFirst: vi.fn(), findMany: vi.fn() },
    locations: { findUnique: vi.fn() },
    vendors: { findUnique: vi.fn(), findMany: vi.fn() },
    riders: { findFirst: vi.fn(), findUnique: vi.fn() },
    cod_collections: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../lib/redis", () => ({
  default: { set: vi.fn(), del: vi.fn(), get: vi.fn() },
  scanAndDelete: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../vendor-scope.service", () => ({
  resolveOwnVendorId: vi.fn(),
  isStaffActor: vi.fn().mockReturnValue(false),
}));
vi.mock("../notification.service", () => ({
  createNotification: vi.fn(),
}));

import {
  updateParcelStatus,
  bulkUpdateParcelStatus,
  applyExternalCarrierStatus,
  applyExternalCarrierFollowUp,
  getOrderStatusesByTrackingIds,
  getOrderFilterOptions,
} from "../order.service";
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";
import { resolveOwnVendorId } from "../vendor-scope.service";

const mockedPrisma = prisma as unknown as {
  parcels: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  vendors: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  riders: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  cod_collections: { findFirst: ReturnType<typeof vi.fn> };
  locations: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const mockedRedis = redis as unknown as {
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
};
const mockedResolveOwnVendorId = resolveOwnVendorId as unknown as ReturnType<typeof vi.fn>;

const RIDER_ID = "rider-profile-1";
const RIDER_ACTOR = { id: "rider-user-1", roles: ["rider"] };

function makeMockTx() {
  return {
    pickup_tasks: { update: vi.fn(), updateMany: vi.fn() },
    parcels: {
      update: vi.fn().mockResolvedValue({ id: "parcel-1" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    parcel_status_history: { create: vi.fn(), createMany: vi.fn() },
    parcel_remarks: { create: vi.fn(), createMany: vi.fn() },
    audit_logs: { create: vi.fn(), createMany: vi.fn() },
    cod_collections: { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    run_sheets: {
      create: vi.fn().mockResolvedValue({ id: "sheet-1" }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    run_sheet_parcels: { createMany: vi.fn() },
    dispatches: {
      create: vi.fn().mockResolvedValue({ id: "d-1", dispatch_no: "DSP-0007" }),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    dispatch_parcels: { createMany: vi.fn() },
    webhook_endpoints: { findMany: vi.fn().mockResolvedValue([]) },
    webhook_deliveries: { createMany: vi.fn() },
  };
}

function makeFakeParcel(overrides: Record<string, unknown> = {}) {
  return {
    id: "parcel-1",
    status: "picked_up",
    vendor_id: null,
    tracking_id: "TRK-1",
    current_location_id: null,
    pickup_rider_id: null,
    delivery_rider_id: null,
    cod_amount: 0,
    delivery_charge: 0,
    order_type: "forward",
    pickup_tasks: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedRedis.set.mockResolvedValue("OK");
  mockedRedis.del.mockResolvedValue(1);
  mockedRedis.get.mockResolvedValue(null);
  mockedResolveOwnVendorId.mockResolvedValue(null);
  mockedPrisma.vendors.findUnique.mockResolvedValue(null);
  mockedPrisma.vendors.findMany.mockResolvedValue([]);
  mockedPrisma.riders.findFirst.mockResolvedValue({ id: RIDER_ID });
  // A real employee, not a "PM Rider N"-style carrier placeholder.
  mockedPrisma.riders.findUnique.mockResolvedValue({ carrier_code: null });
  // No settlement has swept this collection up, so an undeliver isn't blocked.
  mockedPrisma.cod_collections.findFirst.mockResolvedValue(null);
});

// A 3PL (NCM/Upaya) leg has no internal delivery rider: the carrier drives the
// parcel to sent_for_delivery with delivery_rider_id still NULL. The rider who
// originally picked it up must not inherit it.
describe("rider read scope is leg-aware", () => {
  // The listing rule has to be the strict one: riders run a sideloaded APK
  // that can't be pushed an update, so the only way an already-installed
  // client stops showing NCM parcels is the server not returning them.
  // A pickup rider's list claim ends at the origin-hub handover - including on
  // delivered, so a 3PL delivery never lands in "Orders you have delivered".
  it("drops parcels out of the rider's list once they leave the origin hub", async () => {
    mockedPrisma.parcels.findMany.mockResolvedValue([]);

    await getOrderFilterOptions(RIDER_ACTOR);

    const { where } = mockedPrisma.parcels.findMany.mock.calls[0]![0];
    const custody = where.AND.find((c: Record<string, unknown>) => "OR" in c);
    expect(custody.OR).toEqual([
      { delivery_rider_id: RIDER_ID },
      {
        pickup_rider_id: RIDER_ID,
        status: {
          in: ["pickup_ordered", "rider_assigned", "picked_up", "failed_pickup", "arrived"],
        },
      },
    ]);
    // Delivered is the one riders complained about by name: NCM completing a
    // parcel must not show up as that rider's own delivery.
    expect(custody.OR[1].status.in).not.toContain("delivered");
  });

  // Lookups and stats use the looser rule on purpose: a parcel the rider
  // collected still counts as theirs while it's in transit, so "Picked Up" on
  // the dashboard doesn't crater whenever the day's pickups are mid-route.
  it("keeps in-transit parcels for lookups and stats, minus the delivery leg", async () => {
    mockedPrisma.parcels.findMany.mockResolvedValue([]);

    await getOrderStatusesByTrackingIds(RIDER_ACTOR, ["TRK-1"]);

    const { where } = mockedPrisma.parcels.findMany.mock.calls[0]![0];
    expect(where.OR).toEqual([
      { delivery_rider_id: RIDER_ID },
      {
        pickup_rider_id: RIDER_ID,
        status: { notIn: ["ready_to_deliver", "sent_for_delivery", "failed_delivery"] },
      },
    ]);
    // Still counted here, unlike in the custody rule above.
    expect(where.OR[1].status.notIn).not.toContain("dispatched");
    // The flat `pickup OR delivery` predicate is what dragged NCM parcels into
    // the rider app - it must not come back.
    expect(where.OR).not.toContainEqual({ pickup_rider_id: RIDER_ID });
  });

  it("still refuses the write, so read and write scope agree", async () => {
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "sent_for_delivery", pickup_rider_id: RIDER_ID }),
    );

    await expect(
      updateParcelStatus(RIDER_ACTOR, "parcel-1", { status: "delivered" }),
    ).rejects.toThrow(AppError);
  });
});

// Without this, a released parcel kept its old delivery_rider_id through
// ready_to_deliver -> hold -> oov onto a 3PL leg, and the carrier's collected
// cash landed on that rider's COD settlement.
describe("delivery rider is released when the parcel leaves the delivery leg", () => {
  it("clears delivery_rider_id on failed_delivery -> ready_to_deliver", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "failed_delivery", delivery_rider_id: RIDER_ID }),
    );

    await updateParcelStatus({ id: "admin-1", roles: ["admin"] }, "parcel-1", {
      status: "ready_to_deliver",
    });

    expect(tx.parcels.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ delivery_rider_id: null }) }),
    );
  });

  // Releasing the rider and reversing the cash are different questions:
  // re-sending a delivered parcel keeps it on the delivery leg (rider stays)
  // but the delivery still didn't happen, so the COD must roll back.
  it("still reverses the COD when a delivered parcel is forced back out for delivery", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "delivered", delivery_rider_id: RIDER_ID }),
    );
    mockedPrisma.riders.findFirst.mockResolvedValue({ id: "rider-profile-2", status: "active" });

    await updateParcelStatus({ id: "root-1", roles: ["super_admin"] }, "parcel-1", {
      status: "sent_for_delivery",
      riderId: "rider-profile-2",
    });

    expect(tx.cod_collections.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ collected_amount: 0, rider_id: null }),
      }),
    );
  });

  it("keeps the rider across sent_for_delivery -> failed_delivery, so they can still release it", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "sent_for_delivery", delivery_rider_id: RIDER_ID }),
    );

    await updateParcelStatus({ id: "admin-1", roles: ["admin"] }, "parcel-1", {
      status: "failed_delivery",
      remarks: "customer unreachable",
    });

    const data = tx.parcels.update.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty("delivery_rider_id");
  });

  // sent_to_vendor assigns a delivery rider to carry the RTO parcel back, so
  // that claim has to survive the hand-over or the rider's returns history
  // empties out.
  it("keeps the rider across sent_to_vendor -> returned_to_vendor", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "sent_to_vendor", delivery_rider_id: RIDER_ID }),
    );

    await updateParcelStatus({ id: "admin-1", roles: ["admin"] }, "parcel-1", {
      status: "returned_to_vendor",
    });

    const data = tx.parcels.update.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty("delivery_rider_id");
  });

  // Both statuses are held, so leavingDelivery is false - but the reversal
  // nulls cod_collections.rider_id, and the parcel must not be left pointing
  // at a rider the money no longer does.
  it("releases the rider when a delivered parcel is forced to returned_to_vendor", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "delivered", delivery_rider_id: RIDER_ID }),
    );

    await updateParcelStatus({ id: "root-1", roles: ["super_admin"] }, "parcel-1", {
      status: "returned_to_vendor",
    });

    expect(tx.parcels.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ delivery_rider_id: null }) }),
    );
    expect(tx.cod_collections.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rider_id: null }) }),
    );
  });

  // ...but being in the held set is what makes the claim releasable at all: a
  // super_admin pulling the parcel back off the terminal RTV state must not
  // carry the old rider into whatever it does next.
  it("releases the rider when a super_admin forces returned_to_vendor back out", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "returned_to_vendor", delivery_rider_id: RIDER_ID }),
    );

    await updateParcelStatus({ id: "root-1", roles: ["super_admin"] }, "parcel-1", {
      status: "ready_to_deliver",
    });

    expect(tx.parcels.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ delivery_rider_id: null }) }),
    );
  });
});

// The pickup-leg mirror. Nothing cleared pickup_rider_id anywhere, so a rider
// who failed a pickup and released it back into the pool kept listing a parcel
// that was no longer theirs - and had no action available on it.
describe("pickup rider is released when the parcel goes back in the pool", () => {
  it("clears pickup_rider_id when a rider releases failed_pickup -> pickup_ordered", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "failed_pickup", pickup_rider_id: RIDER_ID }),
    );

    await updateParcelStatus(RIDER_ACTOR, "parcel-1", { status: "pickup_ordered" });

    expect(tx.parcels.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pickup_rider_id: null }) }),
    );
  });

  it("clears pickup_rider_id when a super_admin forces rider_assigned -> pickup_ordered", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "rider_assigned", pickup_rider_id: RIDER_ID }),
    );

    await updateParcelStatus({ id: "root-1", roles: ["super_admin"] }, "parcel-1", {
      status: "pickup_ordered",
    });

    expect(tx.parcels.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pickup_rider_id: null }) }),
    );
  });

  it("clears pickup_rider_id on the bulk path too", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findMany.mockResolvedValue([
      makeFakeParcel({ status: "failed_pickup", pickup_rider_id: RIDER_ID }),
    ]);

    await bulkUpdateParcelStatus({ id: "admin-1", roles: ["admin"] }, {
      ids: ["parcel-1"],
      status: "pickup_ordered",
    });

    expect(tx.parcels.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pickup_rider_id: null }) }),
    );
  });

  // The guard on the whole design: the release is keyed on arriving at
  // pickup_ordered, never on leaving the pickup leg. Clearing it at the hub
  // hand-over would erase who collected the parcel, which riderHandledFilter,
  // the dashboard's total_picked_up, auth.controller's per-rider counts and
  // finance.service's leg label all read.
  it("keeps pickup_rider_id at the hub handover, so the pickup record survives", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "picked_up", pickup_rider_id: RIDER_ID }),
    );

    await updateParcelStatus({ id: "admin-1", roles: ["admin"] }, "parcel-1", {
      status: "arrived",
    });

    const data = tx.parcels.update.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty("pickup_rider_id");
  });

  it("syncs the pickup task back to pickup_ordered so it can't disagree with the parcel", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({
        status: "failed_pickup",
        pickup_rider_id: RIDER_ID,
        pickup_tasks: { parcel_id: "parcel-1", status: "failed_pickup" },
      }),
    );

    await updateParcelStatus(RIDER_ACTOR, "parcel-1", { status: "pickup_ordered" });

    expect(tx.pickup_tasks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "pickup_ordered" } }),
    );
  });

  it("does not clear pickup_rider_id on the transition that assigns one", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(makeFakeParcel({ status: "pickup_ordered" }));
    mockedPrisma.riders.findFirst.mockResolvedValue({ id: RIDER_ID, status: "active" });

    await updateParcelStatus({ id: "admin-1", roles: ["admin"] }, "parcel-1", {
      status: "rider_assigned",
      riderId: RIDER_ID,
    });

    expect(tx.parcels.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pickup_rider_id: RIDER_ID }) }),
    );
  });
});

// The carrier paths bypass the actor-driven machinery entirely, so the
// leavingDelivery release never runs on them. A rider left attached there is
// what put NCM's collected cash on that rider's COD settlement.
describe("carrier legs drop a stale internal rider", () => {
  it("releases an employee rider when the carrier moves the parcel on", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "oov", delivery_rider_id: RIDER_ID }),
    );

    await applyExternalCarrierStatus("parcel-1", "dispatched", "NCM picked up");

    expect(tx.parcels.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ delivery_rider_id: null }) }),
    );
  });

  // The money half: without this the carrier's cash lands on the stale rider's
  // statement, which is what makes settlement impossible to close.
  it("attributes a carrier delivery to no rider, even with one still attached", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "sent_for_delivery", delivery_rider_id: RIDER_ID, cod_amount: 1500 }),
    );

    await applyExternalCarrierStatus("parcel-1", "delivered", "NCM delivered");

    const upsert = tx.cod_collections.upsert.mock.calls[0]![0];
    expect(upsert.update.rider_id).toBeNull();
    expect(upsert.create.rider_id).toBeNull();
  });

  // ...but a "PM Rider N"/"PM Rider U" placeholder is a deliberate manual
  // routing, and the finance queries read it to attribute the cash to that
  // carrier. It must survive.
  it("keeps a carrier placeholder rider, which is what attributes the cash to the carrier", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "sent_for_delivery", delivery_rider_id: "pm-rider-n", cod_amount: 900 }),
    );
    mockedPrisma.riders.findUnique.mockResolvedValue({ carrier_code: "ncm" });

    await applyExternalCarrierStatus("parcel-1", "delivered", "NCM delivered");

    const data = tx.parcels.update.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty("delivery_rider_id");
    expect(tx.cod_collections.upsert.mock.calls[0]![0].update.rider_id).toBe("pm-rider-n");
  });

  it("releases the rider when the carrier hands the parcel back into follow_up", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findFirst.mockResolvedValue(
      makeFakeParcel({ status: "sent_for_delivery", delivery_rider_id: RIDER_ID }),
    );

    await applyExternalCarrierFollowUp("parcel-1", "NCM returning to vendor");

    expect(tx.parcels.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ delivery_rider_id: null }) }),
    );
  });
});

// Nothing ever read dispatches.delivery_rider_id back, so ops picked a rider
// for a manifest and the choice vanished.
describe("the manifest rider is recorded where ops can see it", () => {
  const ADMIN = { id: "admin-1", roles: ["admin"] };

  function mockDispatchable() {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (t: unknown) => Promise<unknown>) => fn(tx));
    mockedPrisma.parcels.findMany.mockResolvedValue([
      makeFakeParcel({ status: "oov", current_location_id: "loc-a" }),
    ]);
    mockedPrisma.locations.findUnique.mockResolvedValue({ id: "loc-b", is_active: true });
    mockedPrisma.riders.findFirst.mockResolvedValue({ id: "rider-9", name: "Sunita Devi" });
    return tx;
  }

  it("names the manifest and its driver on the order timeline", async () => {
    const tx = mockDispatchable();

    await bulkUpdateParcelStatus(ADMIN, {
      ids: ["parcel-1"],
      status: "dispatched",
      toLocationId: "loc-b",
      riderId: "rider-9",
    });

    const history = tx.parcel_status_history.createMany.mock.calls[0]![0].data[0];
    expect(history.remarks).toBe("Manifest DSP-0007 · carried by Sunita Devi");
  });

  it("still records the manifest when no driver was picked", async () => {
    const tx = mockDispatchable();

    await bulkUpdateParcelStatus(ADMIN, {
      ids: ["parcel-1"],
      status: "dispatched",
      toLocationId: "loc-b",
    });

    expect(tx.parcel_status_history.createMany.mock.calls[0]![0].data[0].remarks).toBe(
      "Manifest DSP-0007",
    );
  });

  // Without a destination there is no manifest at all, so the rider would be
  // validated and then dropped along with it.
  it("refuses a manifest rider with no destination hub instead of dropping it", async () => {
    mockDispatchable();

    await expect(
      bulkUpdateParcelStatus(ADMIN, {
        ids: ["parcel-1"],
        status: "dispatched",
        riderId: "rider-9",
      }),
    ).rejects.toThrow(AppError);
  });
});
