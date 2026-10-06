import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../../../utils/AppError";

vi.mock("../../../services/codSettlementRequest.service", () => ({
  createCodSettlementRequest: vi.fn(),
  getCodSettlementRequestById: vi.fn(),
  getRegisteredBankDetails: vi.fn(),
  listCodSettlementRequests: vi.fn(),
}));
vi.mock("../../../services/idempotency.service", () => ({
  withIdempotency: vi.fn(async (_key: string, _body: unknown, fn: () => Promise<any>) => (await fn()).result),
}));

import {
  publicCreateCodSettlementRequestController,
  publicGetCodSettlementRequestController,
  publicGetRegisteredBankDetailsController,
  publicListCodSettlementRequestsController,
} from "../codSettlementRequests.controller";
import {
  createCodSettlementRequest,
  getCodSettlementRequestById,
  getRegisteredBankDetails,
  listCodSettlementRequests,
} from "../../../services/codSettlementRequest.service";
import { withIdempotency } from "../../../services/idempotency.service";

const vendorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const idempotencyKey = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const actor = { id: userId, roles: ["vendor"] };

function request(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: { id: "key-1", vendorId, userId },
    query: {},
    params: {},
    body: {},
    headers: {},
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

describe("Partner API COD settlement requests", () => {
  it("lists only through the vendor actor and forwards validated filters", async () => {
    vi.mocked(listCodSettlementRequests).mockResolvedValue({ data: [], meta: { total: 0 } } as any);
    const res = response();
    await publicListCodSettlementRequestsController(request({ query: { status: "open", page: 2 } }), res);
    expect(listCodSettlementRequests).toHaveBeenCalledWith(actor, { status: "open", page: 2 });
    expect(res.body).toMatchObject({ success: true, data: [], meta: { total: 0 } });
  });

  it("reads the key owner's registered payout account", async () => {
    const bank = { bankName: "Bank", accountNumber: "123", accountName: "Vendor" };
    vi.mocked(getRegisteredBankDetails).mockResolvedValue(bank);
    const res = response();
    await publicGetRegisteredBankDetailsController(request(), res);
    expect(getRegisteredBankDetails).toHaveBeenCalledWith(actor);
    expect(res.body.data).toBe(bank);
  });

  it("rejects an invalid request ID before accessing any record", async () => {
    const res = response();
    await publicGetCodSettlementRequestController(request({ params: { id: "bad" } }), res);
    expect(res.statusCode).toBe(400);
    expect(getCodSettlementRequestById).not.toHaveBeenCalled();
  });

  it("reads a request by ID using vendor ownership checks in the shared service", async () => {
    const record = { id: requestId, status: "open" };
    vi.mocked(getCodSettlementRequestById).mockResolvedValue(record as any);
    const res = response();
    await publicGetCodSettlementRequestController(request({ params: { id: requestId } }), res);
    expect(getCodSettlementRequestById).toHaveBeenCalledWith(actor, requestId);
    expect(res.body.data).toBe(record);
  });

  it("requires an idempotency UUID and scopes replay to the vendor", async () => {
    const missing = response();
    await publicCreateCodSettlementRequestController(request({ body: { note: "Please pay" } }), missing);
    expect(missing.statusCode).toBe(400);
    expect(createCodSettlementRequest).not.toHaveBeenCalled();

    const record = { id: requestId, requestNo: "CSR-1", status: "open" };
    vi.mocked(createCodSettlementRequest).mockResolvedValue(record as any);
    const res = response();
    await publicCreateCodSettlementRequestController(request({
      body: { note: "Please pay" },
      headers: { "idempotency-key": idempotencyKey },
    }), res);
    expect(withIdempotency).toHaveBeenCalledWith(
      `cod-settlement-request:${vendorId}:${idempotencyKey}`,
      { note: "Please pay" },
      expect.any(Function),
    );
    expect(createCodSettlementRequest).toHaveBeenCalledWith(actor, { note: "Please pay" });
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toBe(record);
  });

  it("returns a structured conflict when a live request already exists", async () => {
    vi.mocked(createCodSettlementRequest).mockRejectedValue(new AppError(409, "Already requested"));
    const res = response();
    await publicCreateCodSettlementRequestController(request({
      headers: { "idempotency-key": idempotencyKey },
    }), res);
    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });
});
