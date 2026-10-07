import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    vendors: { findFirst: vi.fn(), findUnique: vi.fn() },
    vendor_staff: { findFirst: vi.fn() },
    cod_settlement_requests: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("../billing.service", () => ({ getVendorAccountBalance: vi.fn() }));
vi.mock("../order.service", () => ({ notifyFinanceStaff: vi.fn() }));
vi.mock("../notification.service", () => ({ createNotification: vi.fn() }));

import prisma from "../../lib/prisma";
import { getVendorAccountBalance } from "../billing.service";
import { notifyFinanceStaff } from "../order.service";
import { createCodSettlementRequest, listCodSettlementRequests } from "../codSettlementRequest.service";

const actor = { id: "vendor-user", roles: ["vendor"] };
const db = prisma as unknown as {
  vendors: { findFirst: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  cod_settlement_requests: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  db.vendors.findFirst.mockResolvedValue({ id: "vendor-1" });
  db.cod_settlement_requests.findFirst.mockResolvedValue(null);
  db.vendors.findUnique.mockResolvedValue({
    bank_name: "Registered Bank",
    bank_account_no: "123456789",
    bank_account_holder: "Vendor Store",
  });
  vi.mocked(getVendorAccountBalance).mockResolvedValue({ balance: 1400 } as any);
});

describe("vendor COD settlement request rules shared by dashboard and Partner API", () => {
  it("scopes request history to the vendor", async () => {
    db.cod_settlement_requests.findMany.mockResolvedValue([]);
    db.cod_settlement_requests.count.mockResolvedValue(0);
    await listCodSettlementRequests(actor, { status: "open" });
    expect(db.cod_settlement_requests.findMany.mock.calls[0]![0].where).toMatchObject({
      vendor_id: "vendor-1", status: "open",
    });
  });

  it("rejects a second live request before writing", async () => {
    db.cod_settlement_requests.findFirst.mockResolvedValue({
      id: "live-1", request_no: "CSR-1", vendor_id: "vendor-1",
      bank_name: "Registered Bank", account_number: "123", account_name: "Vendor Store",
      note: null, amount_snapshot: null, status: "open", decision_note: null,
      reviewed_at: null, closed_at: null, created_at: new Date(),
    });
    await expect(createCodSettlementRequest(actor, {})).rejects.toMatchObject({ statusCode: 409 });
    expect(db.cod_settlement_requests.create).not.toHaveBeenCalled();
  });

  it("rejects an incomplete registered bank account", async () => {
    db.vendors.findUnique.mockResolvedValue({ bank_name: "", bank_account_no: "123", bank_account_holder: "Vendor" });
    await expect(createCodSettlementRequest(actor, {})).rejects.toMatchObject({ statusCode: 400 });
    expect(db.cod_settlement_requests.create).not.toHaveBeenCalled();
  });

  it("stores only the registered bank account and opens the request", async () => {
    db.cod_settlement_requests.create.mockImplementation(async ({ data }: any) => ({
      id: "request-1", ...data, vendor_id: "vendor-1", note: data.note,
      bank_name: data.bank_name, account_number: data.account_number, account_name: data.account_name,
      amount_snapshot: data.amount_snapshot, status: "open", decision_note: null,
      reviewed_at: null, closed_at: null, created_at: new Date(),
    }));

    const created = await createCodSettlementRequest(actor, {
      note: "  Payout this week  ",
      ...({ bankName: "Other Bank", accountNumber: "000", accountName: "Other" } as any),
    });

    expect(db.cod_settlement_requests.create.mock.calls[0]![0].data).toMatchObject({
      vendor_id: "vendor-1",
      bank_name: "Registered Bank",
      account_number: "123456789",
      account_name: "Vendor Store",
      note: "Payout this week",
      amount_snapshot: 1400,
      status: "open",
    });
    expect(created.bankName).toBe("Registered Bank");
    expect(notifyFinanceStaff).toHaveBeenCalledOnce();
  });

  it("turns a concurrent unique-index collision into a conflict", async () => {
    db.cod_settlement_requests.create.mockRejectedValue({ code: "P2002" });
    await expect(createCodSettlementRequest(actor, {})).rejects.toMatchObject({ statusCode: 409 });
  });

  it("returns the saved request even if staff notification fails", async () => {
    db.cod_settlement_requests.create.mockResolvedValue({
      id: "request-2", request_no: "CSR-2", vendor_id: "vendor-1",
      bank_name: "Registered Bank", account_number: "123456789", account_name: "Vendor Store",
      note: null, amount_snapshot: 1400, status: "open", decision_note: null,
      reviewed_at: null, closed_at: null, created_at: new Date(),
    });
    vi.mocked(notifyFinanceStaff).mockRejectedValue(new Error("notification unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(createCodSettlementRequest(actor, {})).resolves.toMatchObject({ id: "request-2" });
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
