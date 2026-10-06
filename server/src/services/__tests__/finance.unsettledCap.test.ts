import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../lib/prisma", () => ({ default: { vendors: { findFirst: vi.fn() }, cod_collections: { findMany: vi.fn() }, $queryRaw: vi.fn() } }));
vi.mock("../../lib/redis", () => ({ default: { get: vi.fn(), setex: vi.fn() }, scanAndDelete: vi.fn() }));
vi.mock("../notification.service", () => ({ createNotification: vi.fn() }));
vi.mock("../billing.service", () => ({ evaluateVendorBillingAsync: vi.fn() }));
vi.mock("../accounting/sync", () => ({ syncSettlementPostings: vi.fn() }));
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";
import { getUnsettledOrders } from "../finance.service";
const actor = { id: "vendor-user", roles: ["vendor"] };
const collection = { id: "cod", parcel_id: "parcel", cod_amount: 100, collected_amount: 80,
  parcels: { order_number: 1, tracking_id: "PM-ONE", delivery_charge: 10, order_type: "delivery", status: "delivered",
    parties_parcels_receiver_idToparties: { name: "Customer", phone: "9810000000", address: "Street" },
    locations_parcels_destination_location_idTolocations: { name: "Kathmandu" } } };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(redis.get).mockResolvedValue(null);
  vi.mocked(prisma.vendors.findFirst).mockResolvedValue({ id: "vendor-a" } as any);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ paid: "50", applied: "20" }]);
});
it("limits the shared picker without changing vendor scope, charges, partial cash or credit", async () => {
  vi.mocked(prisma.cod_collections.findMany).mockResolvedValue(Array.from({ length: 1001 }, () => collection) as any);
  const result = await getUnsettledOrders(actor, "vendor", "other-vendor");
  expect(result.items).toHaveLength(1000);
  expect(result).toMatchObject({ capped: true, availableCredit: 30, totalCod: 100000, totalDeliveryCharge: 10000, totalNetPayable: 70000 });
  expect(prisma.cod_collections.findMany).toHaveBeenCalledWith(expect.objectContaining({
    take: 1001, orderBy: [{ created_at: "desc" }, { id: "desc" }],
    where: expect.objectContaining({ vendor_id: "vendor-a", collected_at: { not: null }, payment_status: "pending" }),
  }));
  expect(redis.setex).toHaveBeenCalledWith("finance:vendor-a:unsettled:v3", 30, expect.any(String));
});
it("sets capped=false when the full eligible set fits", async () => {
  vi.mocked(prisma.cod_collections.findMany).mockResolvedValue([collection] as any);
  expect(await getUnsettledOrders(actor, "vendor")).toMatchObject({ capped: false, totalNetPayable: 70 });
});
