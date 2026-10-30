import prisma from "../lib/prisma";
import { assertHeadOfficeOnly } from "../lib/branchScope";
import { AppError } from "../utils/AppError";
import { bsMonthRange, formatBs } from "../utils/bikramSambat";
import { DELIVERY_CHARGE_VAT_RATE } from "./money-rules";
import { CARRIER_CODES, type CarrierCode } from "./orders/carrier";

// The four VAT registers (IRD Rule 23(1)(h)) for one BS tax period.
//   sales           - vendor statements drawn up in the period (their delivery charges)
//   sales-return    - vendor statements cancelled in the period
//   purchase        - 3PL carrier statements dated in the period + purchase bills
//   purchase-return - carrier statements and purchase bills cancelled in the period
// Every amount is VAT-inclusive, so VAT is taken out of it: value = amount / 1.13.

export const REGISTER_KINDS = ["sales", "sales-return", "purchase", "purchase-return"] as const;
export type RegisterKind = (typeof REGISTER_KINDS)[number];
export const PURCHASE_TYPES = ["local", "import", "capital"] as const;
export type PurchaseType = (typeof PURCHASE_TYPES)[number];

type Actor = { id: string; roles: string[] };

const HEAD_OFFICE_ONLY = "VAT registers are kept centrally at Imadol, not by a branch";

export interface RegisterRow {
  id: string;
  source: "statement" | "carrier" | "bill";
  /** BS date, `2083.05.01` as on the IRD form. */
  date: string;
  invoiceNo: string;
  customsNo: string | null;
  /** Vendor id on the sales registers, so the page can group and filter by vendor; null otherwise. */
  partyId: string | null;
  partyName: string;
  partyPan: string | null;
  description: string | null;
  total: number;
  exempt: number;
  /** Local taxable value and VAT (excluding capital). */
  taxable: number;
  vat: number;
  importTaxable: number;
  importVat: number;
  capitalTaxable: number;
  capitalVat: number;
}

export interface RegisterResult {
  kind: RegisterKind;
  period: { year: number; month: number };
  taxpayer: { name: string; pan: string };
  rows: RegisterRow[];
  totals: Omit<RegisterRow, "id" | "source" | "date" | "invoiceNo" | "customsNo" | "partyId" | "partyName" | "partyPan" | "description">;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Splits a VAT-inclusive amount into its taxable value and VAT. */
export function splitVat(amount: number, ratePercent: number = DELIVERY_CHARGE_VAT_RATE): { taxable: number; vat: number } {
  const taxable = round2((amount * 100) / (100 + ratePercent));
  return { taxable, vat: round2(amount - taxable) };
}

const bsDot = (date: Date) => formatBs(date).replace(/-/g, ".");

const CARRIER_NAMES: Record<CarrierCode, string> = { ncm: "Nepal Can Move (NCM)", upaya: "Upaya City Cargo" };
const carrierPan = (code: CarrierCode) => process.env[`${code.toUpperCase()}_PAN`] || null;

const ZERO = { importTaxable: 0, importVat: 0, capitalTaxable: 0, capitalVat: 0 };

async function vendorStatementRows(start: Date, end: Date, cancelled: boolean): Promise<RegisterRow[]> {
  const statements = await prisma.settlements.findMany({
    where: {
      payee_type: "vendor",
      vendor_id: { not: null },
      ...(cancelled
        ? { status: "cancelled", updated_at: { gte: start, lt: end } }
        : { status: { not: "cancelled" }, created_at: { gte: start, lt: end } }),
    },
    orderBy: [{ created_at: "asc" }, { statement_id: "asc" }],
    select: {
      id: true,
      statement_id: true,
      invoice_no: true,
      created_at: true,
      updated_at: true,
      amount: true,
      payable_amount: true,
      vendor_credit_applied: true,
      vat_rate: true,
      vendor_id: true,
      vendors: { select: { client_name: true, business_name: true, billing_business_name: true, pan_vat_no: true } },
    },
  });

  return statements.flatMap((s) => {
    // payable = collected - delivery charges + credit, so the charges billed are:
    const charges = round2(Number(s.amount) - Number(s.payable_amount ?? s.amount) + Number(s.vendor_credit_applied));
    if (charges <= 0) return [];
    const { taxable, vat } = splitVat(charges, s.vat_rate === null ? DELIVERY_CHARGE_VAT_RATE : Number(s.vat_rate));
    const v = s.vendors;
    return [{
      id: s.id,
      source: "statement" as const,
      date: bsDot(cancelled ? s.updated_at : s.created_at),
      // The invoice number recorded on the statement; the statement ID until one is.
      invoiceNo: s.invoice_no || s.statement_id,
      customsNo: null,
      partyId: s.vendor_id,
      partyName: v?.billing_business_name || v?.business_name || v?.client_name || "",
      partyPan: v?.pan_vat_no || null,
      description: cancelled ? "Delivery service" : null,
      total: charges,
      exempt: 0,
      taxable,
      vat,
      ...ZERO,
    }];
  });
}

async function carrierStatementRows(start: Date, end: Date, cancelled: boolean): Promise<RegisterRow[]> {
  const statements = await prisma.carrier_settlements.findMany({
    where: cancelled
      ? { status: "cancelled", updated_at: { gte: start, lt: end } }
      : { status: { not: "cancelled" }, settlement_date: { gte: start, lt: end } },
    orderBy: [{ settlement_date: "asc" }, { statement_no: "asc" }],
    select: { id: true, statement_no: true, carrier_code: true, settlement_date: true, updated_at: true, carrier_charges: true },
  });

  return statements.flatMap((s) => {
    const charges = round2(Number(s.carrier_charges));
    if (charges <= 0) return [];
    const code = (CARRIER_CODES as readonly string[]).includes(s.carrier_code) ? (s.carrier_code as CarrierCode) : null;
    const { taxable, vat } = splitVat(charges);
    return [{
      id: s.id,
      source: "carrier" as const,
      date: bsDot(cancelled ? s.updated_at : s.settlement_date),
      invoiceNo: s.statement_no,
      customsNo: null,
      partyId: null,
      partyName: code ? CARRIER_NAMES[code] : s.carrier_code.toUpperCase(),
      partyPan: code ? carrierPan(code) : null,
      description: cancelled ? "Delivery service" : null,
      total: charges,
      exempt: 0,
      taxable,
      vat,
      ...ZERO,
    }];
  });
}

async function purchaseBillRows(start: Date, end: Date, cancelled: boolean): Promise<RegisterRow[]> {
  const bills = await prisma.purchase_bills.findMany({
    where: cancelled
      ? { status: "cancelled", cancelled_at: { gte: start, lt: end } }
      : { status: "active", bill_date: { gte: start, lt: end } },
    orderBy: [{ bill_date: "asc" }, { created_at: "asc" }],
  });

  return bills.map((b) => {
    const taxable = Number(b.taxable_amount);
    const vat = Number(b.vat_amount);
    const type = b.purchase_type as PurchaseType;
    return {
      id: b.id,
      source: "bill" as const,
      date: bsDot(cancelled && b.cancelled_at ? b.cancelled_at : b.bill_date),
      invoiceNo: b.bill_no,
      customsNo: b.customs_no,
      partyId: null,
      partyName: b.supplier_name,
      partyPan: b.supplier_pan,
      description: b.description,
      total: Number(b.total_amount),
      exempt: Number(b.exempt_amount),
      taxable: type === "local" ? taxable : 0,
      vat: type === "local" ? vat : 0,
      importTaxable: type === "import" ? taxable : 0,
      importVat: type === "import" ? vat : 0,
      capitalTaxable: type === "capital" ? taxable : 0,
      capitalVat: type === "capital" ? vat : 0,
    };
  });
}

export async function getVatRegister(actor: Actor, kind: RegisterKind, year: number, month: number): Promise<RegisterResult> {
  await assertHeadOfficeOnly(actor, HEAD_OFFICE_ONLY);
  const { start, end } = bsMonthRange(year, month);
  const returns = kind.endsWith("-return");

  const rows = kind.startsWith("sales")
    ? await vendorStatementRows(start, end, returns)
    : [...(await carrierStatementRows(start, end, returns)), ...(await purchaseBillRows(start, end, returns))].sort((a, b) =>
        a.date.localeCompare(b.date),
      );

  const sum = (key: keyof RegisterResult["totals"]) => round2(rows.reduce((total, row) => total + row[key], 0));
  return {
    kind,
    period: { year, month },
    taxpayer: { name: process.env.COMPANY_NAME || "", pan: process.env.COMPANY_PAN || "" },
    rows,
    totals: {
      total: sum("total"),
      exempt: sum("exempt"),
      taxable: sum("taxable"),
      vat: sum("vat"),
      importTaxable: sum("importTaxable"),
      importVat: sum("importVat"),
      capitalTaxable: sum("capitalTaxable"),
      capitalVat: sum("capitalVat"),
    },
  };
}

export interface CreatePurchaseBillInput {
  billDate: string;
  billNo: string;
  customsNo?: string | null;
  supplierName: string;
  supplierPan?: string | null;
  purchaseType: PurchaseType;
  description?: string | null;
  totalAmount: number;
  exemptAmount: number;
}

export async function createPurchaseBill(actor: Actor, input: CreatePurchaseBillInput) {
  await assertHeadOfficeOnly(actor, HEAD_OFFICE_ONLY);
  if (input.exemptAmount > input.totalAmount) {
    throw new AppError(400, "The tax-exempt amount can't be more than the total");
  }
  const { taxable, vat } = splitVat(round2(input.totalAmount - input.exemptAmount));

  return prisma.$transaction(async (tx) => {
    const bill = await tx.purchase_bills.create({
      data: {
        bill_date: new Date(`${input.billDate}T00:00:00Z`),
        bill_no: input.billNo,
        customs_no: input.customsNo || null,
        supplier_name: input.supplierName,
        supplier_pan: input.supplierPan || null,
        purchase_type: input.purchaseType,
        description: input.description || null,
        total_amount: input.totalAmount,
        exempt_amount: input.exemptAmount,
        taxable_amount: taxable,
        vat_amount: vat,
        created_by: actor.id,
      },
    });
    await tx.audit_logs.create({
      data: { actor_id: actor.id, entity_type: "purchase_bill", entity_id: bill.id, action: "CREATE_PURCHASE_BILL", new_data: { ...input } },
    });
    return { id: bill.id };
  });
}

export async function cancelPurchaseBill(actor: Actor, id: string, remark: string) {
  await assertHeadOfficeOnly(actor, HEAD_OFFICE_ONLY);
  return prisma.$transaction(async (tx) => {
    const bill = await tx.purchase_bills.findUnique({ where: { id }, select: { status: true } });
    if (!bill) throw new AppError(404, "Purchase bill not found");
    if (bill.status === "cancelled") throw new AppError(409, "This purchase bill is already cancelled");

    await tx.purchase_bills.update({
      where: { id },
      data: { status: "cancelled", cancelled_at: new Date(), cancel_remark: remark },
    });
    await tx.audit_logs.create({
      data: { actor_id: actor.id, entity_type: "purchase_bill", entity_id: id, action: "CANCEL_PURCHASE_BILL", new_data: { remark } },
    });
    return { id };
  });
}
