import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/finance.service", () => ({
  getPendingCodBill: vi.fn(),
  listOrderCod: vi.fn(),
  listSettlements: vi.fn(),
  getUnsettledOrders: vi.fn(),
  getSettlementDetail: vi.fn(),
  getSettlementDocumentPath: vi.fn(),
}));
vi.mock("../../../lib/serveEncryptedDocument", () => ({ sendEncryptedFile: vi.fn() }));
vi.mock("../../../lib/prisma", () => ({
  default: { audit_logs: { create: vi.fn(() => Promise.resolve()) } },
}));

import {
  publicGetPendingCodController,
  publicListOrderCodController,
  publicListSettlementsController,
  publicGetSettlementController,
  publicGetUnsettledOrdersController,
  publicGetSettlementDocumentController,
} from "../finance.controller";
import {
  getPendingCodBill,
  listOrderCod,
  listSettlements,
  getUnsettledOrders,
  getSettlementDetail,
  getSettlementDocumentPath,
} from "../../../services/finance.service";
import { sendEncryptedFile } from "../../../lib/serveEncryptedDocument";

const keyUser = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const settlementId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const actor = { id: keyUser, roles: ["vendor"] };

function request(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: { id: "key-1", vendorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userId: keyUser },
    query: {},
    params: {},
    headers: {},
    get: vi.fn(() => null),
    ...overrides,
  } as any;
}

function response() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res.body = body; return res; },
  };
  return res;
}

beforeEach(() => vi.clearAllMocks());

describe("partner finance API", () => {
  it("reads pending COD for the key owner", async () => {
    const bill = { items: [], totals: { totalCod: 0, deliveryCharges: 0, payableAmount: 0 } };
    vi.mocked(getPendingCodBill).mockResolvedValue(bill as any);
    const res = response();

    await publicGetPendingCodController(request({ query: { vendorId: "other-vendor" } }), res);

    expect(getPendingCodBill).toHaveBeenCalledWith(actor);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toBe(bill);
  });

  it("passes only COD filters and the key owner's vendor actor", async () => {
    vi.mocked(listOrderCod).mockResolvedValue({ data: [], meta: { total: 0 } } as any);
    const res = response();

    await publicListOrderCodController(request({
      query: { status: "not_settled", page: 2, pageSize: 10, vendorId: "other-vendor" },
    }), res);

    expect(listOrderCod).toHaveBeenCalledWith(actor, undefined, "not_settled", 2, 10);
    expect(res.statusCode).toBe(200);
  });

  it("lists only vendor settlements with date filters", async () => {
    vi.mocked(listSettlements).mockResolvedValue({ data: [], meta: { total: 0 } } as any);
    const res = response();

    await publicListSettlementsController(request({ query: {
      fromDate: "2026-01-01T00:00:00Z",
      toDate: "2026-02-01T00:00:00Z",
      page: 2,
      pageSize: 10,
      vendorId: "other-vendor",
    } }), res);

    expect(listSettlements).toHaveBeenCalledWith(
      actor, "vendor", undefined, 2, 10,
      new Date("2026-01-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"),
    );
    expect(res.statusCode).toBe(200);
  });

  it("reads unsettled delivery records as vendor records", async () => {
    const records = { items: [{ trackingId: "PM-TEST", collectedAmount: 100 }] };
    vi.mocked(getUnsettledOrders).mockResolvedValue(records as any);
    const res = response();

    await publicGetUnsettledOrdersController(request(), res);

    expect(getUnsettledOrders).toHaveBeenCalledWith(actor, "vendor");
    expect(res.body.data).toBe(records);
  });

  it("requires a valid settlement ID before reading its line items", async () => {
    const bad = response();
    await publicGetSettlementController(request({ params: { id: "bad" } }), bad);
    expect(bad.statusCode).toBe(400);
    expect(getSettlementDetail).not.toHaveBeenCalled();

    const detail = { id: settlementId, items: [{ trackingId: "PM-TEST" }] };
    vi.mocked(getSettlementDetail).mockResolvedValue(detail as any);
    const good = response();
    await publicGetSettlementController(request({ params: { id: settlementId } }), good);
    expect(getSettlementDetail).toHaveBeenCalledWith(actor, settlementId);
    expect(good.body.data).toBe(detail);
  });

  it("only streams an allowed document from an authorized settlement", async () => {
    const invalid = response();
    await publicGetSettlementDocumentController(request({ params: { id: settlementId, kind: "other" } }), invalid);
    expect(invalid.statusCode).toBe(400);
    expect(getSettlementDocumentPath).not.toHaveBeenCalled();

    vi.mocked(getSettlementDocumentPath).mockResolvedValue("uploads/settlement/receipt.pdf");
    const good = response();
    await publicGetSettlementDocumentController(request({ params: { id: settlementId, kind: "receipt" } }), good);
    expect(getSettlementDocumentPath).toHaveBeenCalledWith(actor, settlementId, "receipt");
    expect(sendEncryptedFile).toHaveBeenCalledWith(good, "uploads/settlement/receipt.pdf");
  });
});
