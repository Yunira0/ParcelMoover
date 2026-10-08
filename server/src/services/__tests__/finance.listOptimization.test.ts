import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/prisma", () => ({ default: { settlements: { count: vi.fn(), findMany: vi.fn() } } }));
vi.mock("../../lib/redis", () => ({ default: { get: vi.fn(), setex: vi.fn() }, scanAndDelete: vi.fn() }));
vi.mock("../vendor-scope.service", () => ({ resolveOwnVendorId: vi.fn() }));
vi.mock("../notification.service", () => ({ createNotification: vi.fn() }));
vi.mock("../billing.service", () => ({ evaluateVendorBillingAsync: vi.fn() }));
vi.mock("../accounting/sync", () => ({ syncSettlementPostings: vi.fn() }));
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";
import { resolveOwnVendorId } from "../vendor-scope.service";
import { listSettlements } from "../finance.service";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(redis.get).mockResolvedValue(null);
  vi.mocked(redis.setex).mockResolvedValue("OK");
  vi.mocked(resolveOwnVendorId).mockResolvedValue("vendor-a");
  vi.mocked(prisma.settlements.count).mockResolvedValue(21);
  vi.mocked(prisma.settlements.findMany).mockResolvedValue([{
    id: "statement-1", statement_id: "STM-1", _count: { settlement_items: 345 }, riders: null,
    vendors: { client_name: "Contact", business_name: "Store", phone: "9800000000", bank_name: "Bank", bank_account_no: "123", bank_account_holder: "Store" },
    settlement_date: null, created_at: new Date("2026-10-06T00:00:00Z"), payable_amount: 900, amount: 1000,
    status: "partially_paid", paid_amount: 100, payments: [{ method: "Cash", amount: 100 }], remark: "First instalment",
  }] as any);
});

describe("settlement list relation counts", () => {
  it("returns exact item totals and existing payment fields without loading every linked ID", async () => {
    const result = await listSettlements({ id: "user-a", roles: ["vendor"] }, "vendor", "vendor-b");
    expect(result.data[0]).toMatchObject({ orderCount: 345, amount: 900, payeeName: "Store", paidAmount: 100, bankAccountNo: "123" });
    expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 21, totalPages: 2 });
    expect(prisma.settlements.count).toHaveBeenCalledWith({ where: { payee_type: "vendor", vendor_id: "vendor-a" } });
    const args = vi.mocked(prisma.settlements.findMany).mock.calls[0]![0]!;
    expect(args.include).toHaveProperty("_count", { select: { settlement_items: true } });
    expect(args.include).not.toHaveProperty("settlement_items");
    expect(args.orderBy).toEqual([{ created_at: "desc" }, { id: "desc" }]);
  });
  it("rejects a vendor without a valid profile before querying finance records", async () => {
    vi.mocked(resolveOwnVendorId).mockResolvedValue(null);
    await expect(listSettlements({ id: "user-a", roles: ["vendor"] }, "vendor", undefined)).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.settlements.findMany).not.toHaveBeenCalled();
  });
});
