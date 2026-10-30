import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../lib/prisma", () => ({ default: { settlements: { findUnique: vi.fn() }, vendor_payments: { findMany: vi.fn() }, $queryRaw: vi.fn() } }));
vi.mock("../../lib/redis", () => ({ default: { get: vi.fn(), setex: vi.fn() }, scanAndDelete: vi.fn() }));
vi.mock("../notification.service", () => ({ createNotification: vi.fn() }));
vi.mock("../billing.service", () => ({ evaluateVendorBillingAsync: vi.fn() }));
vi.mock("../accounting/sync", () => ({ syncSettlementPostings: vi.fn() }));
import prisma from "../../lib/prisma";
import { getSettlementBillingPayments } from "../finance.service";
// super_admin skips the head-office lookup, so findUnique below is the payee lookup only.
const actor = { id: "staff", roles: ["super_admin"] };
beforeEach(() => vi.resetAllMocks());
it("lists the vendor's pending Billing payments and unapplied credit for a vendor statement", async () => {
  vi.mocked(prisma.settlements.findUnique).mockResolvedValue({ payee_type: "vendor", vendor_id: "vendor-a" } as any);
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ paid: "1500", applied: "30" }]);
  vi.mocked(prisma.vendor_payments.findMany).mockResolvedValue([
    { id: "vp1", amount: 1500, method: "fonepay", reference: "1SJ5N8P", created_at: new Date("2026-10-03T10:00:00Z") },
  ] as any);
  expect(await getSettlementBillingPayments(actor, "stmt")).toEqual({
    availableCredit: 1470,
    pendingPayments: [{ id: "vp1", amount: 1500, method: "fonepay", reference: "1SJ5N8P", submittedAt: "2026-10-03T10:00:00.000Z" }],
  });
  expect(prisma.vendor_payments.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendor_id: "vendor-a", status: "pending" } }));
});
it("returns nothing for a rider statement", async () => {
  vi.mocked(prisma.settlements.findUnique).mockResolvedValue({ payee_type: "rider", vendor_id: null } as any);
  expect(await getSettlementBillingPayments(actor, "stmt")).toEqual({ availableCredit: 0, pendingPayments: [] });
  expect(prisma.vendor_payments.findMany).not.toHaveBeenCalled();
});
it("404s an unknown statement", async () => {
  vi.mocked(prisma.settlements.findUnique).mockResolvedValue(null);
  await expect(getSettlementBillingPayments(actor, "missing")).rejects.toMatchObject({ statusCode: 404 });
});
