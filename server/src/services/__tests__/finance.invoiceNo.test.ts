import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/prisma", () => {
  const db: any = {
    $queryRaw: vi.fn(),
    settlements: { findUnique: vi.fn(), update: vi.fn() },
    audit_logs: { create: vi.fn() },
  };
  db.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(db));
  return { default: db };
});
vi.mock("../../lib/redis", () => ({ default: { get: vi.fn(), setex: vi.fn() }, scanAndDelete: vi.fn() }));
vi.mock("../vendor-scope.service", () => ({ resolveOwnVendorId: vi.fn() }));
vi.mock("../notification.service", () => ({ createNotification: vi.fn() }));
vi.mock("../billing.service", () => ({ evaluateVendorBillingAsync: vi.fn() }));
vi.mock("../accounting/sync", () => ({ syncSettlementPostings: vi.fn() }));
import prisma from "../../lib/prisma";
import { setSettlementInvoiceNo } from "../finance.service";
import { settlementInvoiceNoSchema } from "../../validators/finance.schema";

const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const superAdmin = { id: "staff-1", roles: ["super_admin"] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ id }] as any);
});

describe("setSettlementInvoiceNo", () => {
  it("refuses a vendor before touching the statement", async () => {
    await expect(setSettlementInvoiceNo({ id: "vendor-user", roles: ["vendor"] }, id, "INV-1")).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.settlements.update).not.toHaveBeenCalled();
  });

  it("rejects rider statements", async () => {
    vi.mocked(prisma.settlements.findUnique).mockResolvedValue({ payee_type: "rider", status: "settled", invoice_no: null } as any);
    await expect(setSettlementInvoiceNo(superAdmin, id, "INV-1")).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.settlements.update).not.toHaveBeenCalled();
  });

  it("rejects a statement with no payment recorded", async () => {
    vi.mocked(prisma.settlements.findUnique).mockResolvedValue({ payee_type: "vendor", status: "pending", invoice_no: null } as any);
    await expect(setSettlementInvoiceNo(superAdmin, id, "INV-1")).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.settlements.update).not.toHaveBeenCalled();
  });

  it("saves the number on a paid vendor statement and audits the change", async () => {
    vi.mocked(prisma.settlements.findUnique).mockResolvedValue({ payee_type: "vendor", status: "partially_paid", invoice_no: "OLD-1" } as any);
    await expect(setSettlementInvoiceNo(superAdmin, id, "INV-2083-0142")).resolves.toEqual({ id, invoiceNo: "INV-2083-0142" });
    expect(prisma.settlements.update).toHaveBeenCalledWith({ where: { id }, data: { invoice_no: "INV-2083-0142" } });
    expect(prisma.audit_logs.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "SET_SETTLEMENT_INVOICE_NO",
        old_data: { invoiceNo: "OLD-1" },
        new_data: { invoiceNo: "INV-2083-0142" },
      }),
    }));
  });
});

describe("settlementInvoiceNoSchema", () => {
  it("trims, turns blank into null, and caps the length", () => {
    expect(settlementInvoiceNoSchema.parse({ invoiceNo: "  INV-7  " })).toEqual({ invoiceNo: "INV-7" });
    expect(settlementInvoiceNoSchema.parse({ invoiceNo: "   " })).toEqual({ invoiceNo: null });
    expect(settlementInvoiceNoSchema.parse({ invoiceNo: null })).toEqual({ invoiceNo: null });
    expect(settlementInvoiceNoSchema.safeParse({ invoiceNo: "x".repeat(65) }).success).toBe(false);
  });
});
