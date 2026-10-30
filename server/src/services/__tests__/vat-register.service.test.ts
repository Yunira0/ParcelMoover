import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/prisma", () => {
  const db: any = {
    settlements: { findMany: vi.fn() },
    carrier_settlements: { findMany: vi.fn() },
    purchase_bills: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    audit_logs: { create: vi.fn() },
  };
  db.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(db));
  return { default: db };
});
vi.mock("../../lib/branchScope", () => ({ assertHeadOfficeOnly: vi.fn() }));
import prisma from "../../lib/prisma";
import { assertHeadOfficeOnly } from "../../lib/branchScope";
import { cancelPurchaseBill, createPurchaseBill, getVatRegister, splitVat } from "../vat-register.service";

const staff = { id: "staff-1", roles: ["accountant"] };
// 2083-05-10 BS, a date safely inside Bhadra 2083.
const inBhadra = new Date("2026-08-26T06:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertHeadOfficeOnly).mockResolvedValue(undefined);
  vi.mocked(prisma.settlements.findMany).mockResolvedValue([]);
  vi.mocked(prisma.carrier_settlements.findMany).mockResolvedValue([]);
  vi.mocked(prisma.purchase_bills.findMany).mockResolvedValue([]);
  process.env.COMPANY_NAME = "ParcelMoover";
  process.env.COMPANY_PAN = "600000001";
});

describe("splitVat", () => {
  it("takes 13% VAT out of a VAT-inclusive amount, to the paisa", () => {
    expect(splitVat(113)).toEqual({ taxable: 100, vat: 13 });
    expect(splitVat(250)).toEqual({ taxable: 221.24, vat: 28.76 });
  });
});

describe("getVatRegister", () => {
  it("lists vendor statements' delivery charges as sales, split into value and VAT", async () => {
    vi.mocked(prisma.settlements.findMany).mockResolvedValue([{
      id: "s1", statement_id: "STM-V-1", invoice_no: "INV-2083-0142", created_at: inBhadra, cancelled_at: null, status: "settled",
      amount: 5000, payable_amount: 4774, vendor_credit_applied: 0, vat_rate: 13,
      vendors: { client_name: "Ram", business_name: "Ram Store", billing_business_name: null, pan_vat_no: "609862489" },
    }] as any);

    const result = await getVatRegister(staff, "sales", 2083, 5);
    expect(result.taxpayer).toEqual({ name: "ParcelMoover", pan: "600000001" });
    expect(result.rows).toEqual([expect.objectContaining({
      invoiceNo: "INV-2083-0142", partyName: "Ram Store", partyPan: "609862489", date: "2083.05.10", total: 226, taxable: 200, vat: 26,
    })]);
    expect(result.totals).toMatchObject({ total: 226, taxable: 200, vat: 26 });
    // Sales are every statement drawn up inside the period, cancelled since or not.
    const where = vi.mocked(prisma.settlements.findMany).mock.calls[0]![0]!.where as any;
    expect(where.status).toBeUndefined();
    expect(where.created_at.gte).toBeInstanceOf(Date);
  });

  it("puts vendor statements on the sales return register in the month they were cancelled", async () => {
    const cancelledAt = new Date("2026-09-20T06:00:00Z");
    vi.mocked(prisma.settlements.findMany).mockResolvedValue([{
      id: "s1", statement_id: "STM-V-1", invoice_no: null, created_at: inBhadra, cancelled_at: cancelledAt, status: "cancelled",
      amount: 5000, payable_amount: 4774, vendor_credit_applied: 0, vat_rate: 13, vendors: null,
    }] as any);

    const { rows } = await getVatRegister(staff, "sales-return", 2083, 6);
    const where = vi.mocked(prisma.settlements.findMany).mock.calls[0]![0]!.where as any;
    expect(where.status).toBe("cancelled");
    expect(where.cancelled_at.gte).toBeInstanceOf(Date);
    expect(rows[0]).toMatchObject({ invoiceNo: "STM-V-1", date: "2083.06.04", total: 226, cancelled: true });
  });

  it("dates carrier and bill reversals by their cancellation", async () => {
    await getVatRegister(staff, "purchase-return", 2083, 5);
    const carrierWhere = vi.mocked(prisma.carrier_settlements.findMany).mock.calls[0]![0]!.where as any;
    const billWhere = vi.mocked(prisma.purchase_bills.findMany).mock.calls[0]![0]!.where as any;
    expect(carrierWhere.cancelled_at.gte).toBeInstanceOf(Date);
    expect(billWhere.cancelled_at.gte).toBeInstanceOf(Date);
  });

  it("combines carrier statements and purchase bills, placing each bill in its type's columns", async () => {
    process.env.NCM_PAN = "301234567";
    vi.mocked(prisma.carrier_settlements.findMany).mockResolvedValue([{
      id: "c1", statement_no: "CS-1", carrier_code: "ncm", settlement_date: inBhadra, cancelled_at: null, status: "settled", carrier_charges: 1130,
    }] as any);
    vi.mocked(prisma.purchase_bills.findMany).mockResolvedValue([{
      id: "b1", bill_no: "77", customs_no: null, supplier_name: "Kathmandu Motors", supplier_pan: "123456789",
      description: "Delivery bike", purchase_type: "capital", bill_date: inBhadra, cancelled_at: inBhadra, status: "cancelled",
      total_amount: 226000, exempt_amount: 0, taxable_amount: 200000, vat_amount: 26000,
    }] as any);

    const { rows, totals } = await getVatRegister(staff, "purchase", 2083, 5);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ partyName: "Nepal Can Move (NCM)", partyPan: "301234567", taxable: 1000, vat: 130 });
    // A bill cancelled since still counts here; its reversal is on the return register.
    expect(rows[1]).toMatchObject({ taxable: 0, vat: 0, capitalTaxable: 200000, capitalVat: 26000, cancelled: true });
    expect(totals).toMatchObject({ total: 227130, taxable: 1000, vat: 130, capitalTaxable: 200000 });
    const billWhere = vi.mocked(prisma.purchase_bills.findMany).mock.calls[0]![0]!.where as any;
    expect(billWhere.status).toBeUndefined();
  });

  it("refuses a branch-scoped admin", async () => {
    vi.mocked(assertHeadOfficeOnly).mockRejectedValue(Object.assign(new Error("no"), { statusCode: 403 }));
    await expect(getVatRegister(staff, "sales", 2083, 5)).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.settlements.findMany).not.toHaveBeenCalled();
  });
});

describe("purchase bills", () => {
  const input = {
    billDate: "2026-08-26", billNo: "77", supplierName: "Kathmandu Motors", purchaseType: "local" as const,
    totalAmount: 1230, exemptAmount: 100,
  };

  it("works out the taxable value and VAT from what is left after the exempt part", async () => {
    vi.mocked(prisma.purchase_bills.create).mockResolvedValue({ id: "b1" } as any);
    await createPurchaseBill(staff, input);
    expect(prisma.purchase_bills.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ total_amount: 1230, exempt_amount: 100, taxable_amount: 1000, vat_amount: 130 }),
    });
  });

  it("rejects an exempt amount above the total", async () => {
    await expect(createPurchaseBill(staff, { ...input, exemptAmount: 2000 })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.purchase_bills.create).not.toHaveBeenCalled();
  });

  it("cancels a bill once", async () => {
    vi.mocked(prisma.purchase_bills.findUnique).mockResolvedValueOnce({ status: "active" } as any);
    await cancelPurchaseBill(staff, "b1", "Entered twice");
    expect(prisma.purchase_bills.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "cancelled", cancel_remark: "Entered twice" }),
    }));

    vi.mocked(prisma.purchase_bills.findUnique).mockResolvedValueOnce({ status: "cancelled" } as any);
    await expect(cancelPurchaseBill(staff, "b1", "again")).rejects.toMatchObject({ statusCode: 409 });
  });
});
