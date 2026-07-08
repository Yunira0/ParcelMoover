import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../utils/AppError";

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
import { resolveOwnVendorId } from "../vendor-scope.service";

const mockedPrisma = prisma as unknown as {
  parcels: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  vendors: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  riders: { findFirst: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};
const mockedRedis = redis as unknown as { set: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> };
const mockedResolveOwnVendorId = resolveOwnVendorId as unknown as ReturnType<typeof vi.fn>;

function makeMockTx() {
  return {
    pickup_tasks: { update: vi.fn(), updateMany: vi.fn() },
    parcels: {
      update: vi.fn().mockResolvedValue({ id: "parcel-1", status: "cancelled" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    parcel_status_history: { create: vi.fn(), createMany: vi.fn() },
    audit_logs: { create: vi.fn(), createMany: vi.fn() },
  };
}

// A parcel in a status that legally allows a "cancelled" transition
// (see STATUS_TRANSITIONS in types/order.type.ts).
function makeFakeParcel(overrides: Record<string, unknown> = {}) {
  return {
    id: "parcel-1",
    status: "pickup_ordered",
    vendor_id: null,
    tracking_id: "TRK-1",
    current_location_id: null,
    pickup_tasks: null,
    ...overrides,
  };
}

describe("order status cancellation authorization", () => {
  beforeEach(() => {
    mockedRedis.set.mockResolvedValue("OK");
    mockedRedis.del.mockResolvedValue(1);
    mockedPrisma.vendors.findUnique.mockResolvedValue(null);
    mockedPrisma.vendors.findMany.mockResolvedValue([]);
    mockedPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) =>
      fn(makeMockTx()),
    );
  });

  describe("updateParcelStatus (single order)", () => {
    it("allows an admin to cancel any order", async () => {
      mockedPrisma.parcels.findFirst.mockResolvedValue(makeFakeParcel());

      await expect(
        updateParcelStatus({ id: "admin-1", roles: ["admin"] }, "parcel-1", { status: "cancelled" }),
      ).resolves.toBeDefined();
    });

    it("allows a vendor to cancel their own order", async () => {
      mockedResolveOwnVendorId.mockResolvedValue("vendor-1");
      mockedPrisma.parcels.findFirst.mockResolvedValue(makeFakeParcel({ vendor_id: "vendor-1" }));

      await expect(
        updateParcelStatus({ id: "vendor-user-1", roles: ["vendor"] }, "parcel-1", {
          status: "cancelled",
        }),
      ).resolves.toBeDefined();
    });

    it("allows vendor_staff to cancel their vendor's order", async () => {
      mockedResolveOwnVendorId.mockResolvedValue("vendor-1");
      mockedPrisma.parcels.findFirst.mockResolvedValue(makeFakeParcel({ vendor_id: "vendor-1" }));

      await expect(
        updateParcelStatus({ id: "staff-1", roles: ["vendor_staff"] }, "parcel-1", {
          status: "cancelled",
        }),
      ).resolves.toBeDefined();
    });

    it("rejects a rider trying to cancel an order", async () => {
      mockedResolveOwnVendorId.mockResolvedValue(null);
      mockedPrisma.riders.findFirst.mockResolvedValue({ id: "rider-profile-1" });
      mockedPrisma.parcels.findFirst.mockResolvedValue(makeFakeParcel());

      await expect(
        updateParcelStatus({ id: "rider-1", roles: ["rider"] }, "parcel-1", { status: "cancelled" }),
      ).rejects.toThrow(AppError);
    });

    it("rejects an actor with no recognized role from cancelling", async () => {
      mockedPrisma.parcels.findFirst.mockResolvedValue(makeFakeParcel());

      await expect(
        updateParcelStatus({ id: "sales-1", roles: ["sales"] }, "parcel-1", { status: "cancelled" }),
      ).rejects.toThrow(AppError);
    });
  });

  describe("bulkUpdateParcelStatus stays consistent with the single-order rule", () => {
    it("allows a vendor to bulk-cancel their own orders", async () => {
      mockedResolveOwnVendorId.mockResolvedValue("vendor-1");
      mockedPrisma.parcels.findMany.mockResolvedValue([
        makeFakeParcel({ vendor_id: "vendor-1" }),
      ]);

      await expect(
        bulkUpdateParcelStatus({ id: "vendor-user-1", roles: ["vendor"] }, {
          ids: ["parcel-1"],
          status: "cancelled",
        }),
      ).resolves.toMatchObject({ updatedCount: 1, status: "cancelled" });
    });

    it("rejects a rider trying to bulk-cancel orders", async () => {
      mockedResolveOwnVendorId.mockResolvedValue(null);
      mockedPrisma.riders.findFirst.mockResolvedValue({ id: "rider-profile-1" });
      mockedPrisma.parcels.findMany.mockResolvedValue([makeFakeParcel()]);

      await expect(
        bulkUpdateParcelStatus({ id: "rider-1", roles: ["rider"] }, {
          ids: ["parcel-1"],
          status: "cancelled",
        }),
      ).rejects.toThrow(AppError);
    });
  });
});
