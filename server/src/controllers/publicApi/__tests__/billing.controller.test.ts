import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../services/billing.service", () => ({
  getBillingSettings: vi.fn(),
  getVendorBillingStatus: vi.fn(),
}));
vi.mock("../../../services/vendor-payment.service", () => ({
  listVendorPayments: vi.fn(),
  submitVendorPayment: vi.fn(),
}));
vi.mock("../../../services/idempotency.service", () => ({
  // Pass-through: these tests are about scoping and response shaping, not
  // about replay detection (covered where withIdempotency itself is tested).
  withIdempotency: vi.fn(async (_key: string, _payload: unknown, fn: () => Promise<any>) => {
    const { result } = await fn();
    return result;
  }),
}));
vi.mock("../../../lib/secureUploadedFiles", () => ({
  secureUploadedFiles: vi.fn(),
  flattenMulterFiles: vi.fn(() => []),
}));
vi.mock("../../../lib/serveEncryptedDocument", () => ({
  sendEncryptedFile: vi.fn(),
}));

import {
  publicGetBillingStatusController,
  publicListVendorPaymentsController,
  publicSubmitVendorPaymentController,
} from "../billing.controller";
import { getBillingSettings, getVendorBillingStatus } from "../../../services/billing.service";
import { listVendorPayments, submitVendorPayment } from "../../../services/vendor-payment.service";

const OWN_VENDOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_VENDOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const mockedGetStatus = getVendorBillingStatus as unknown as ReturnType<typeof vi.fn>;
const mockedGetSettings = getBillingSettings as unknown as ReturnType<typeof vi.fn>;
const mockedListPayments = listVendorPayments as unknown as ReturnType<typeof vi.fn>;
const mockedSubmitPayment = submitVendorPayment as unknown as ReturnType<typeof vi.fn>;

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: { id: "key-1", vendorId: OWN_VENDOR, userId: KEY_USER },
    query: {},
    body: {},
    headers: {},
    ...overrides,
  } as any;
}

function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const payment = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  vendorId: OWN_VENDOR,
  vendorName: "My Store",
  amount: 1500,
  method: "fonepay",
  reference: "FP123",
  proofPath: "uploads/billing/1234-abcd.png",
  status: "pending",
  note: null,
  reviewRemark: null,
  reviewedAt: null,
  createdAt: "2026-08-16T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetSettings.mockResolvedValue({
    id: "s1",
    paymentQrPath: "uploads/billing/qr.png",
    paymentNote: "Add your business name",
    warnThreshold: -1000,
    blockThreshold: -5000,
  });
});

describe("publicGetBillingStatusController", () => {
  it("reads the key's own vendor and never a caller-supplied one", async () => {
    mockedGetStatus.mockResolvedValue({ vendorId: OWN_VENDOR, balance: -1800 });
    const req = makeReq({ query: { vendorId: OTHER_VENDOR } });
    const res = makeRes();

    await publicGetBillingStatusController(req, res);

    expect(mockedGetStatus).toHaveBeenCalledWith(OWN_VENDOR);
    expect(res.statusCode).toBe(200);
  });

  // paymentQrPath resolves under the admin-only /uploads mount, so handing it
  // to a key holder would just be an unfetchable path. GET /billing/qr is the
  // supported route in.
  it("exposes paymentNote but never the internal QR path", async () => {
    mockedGetStatus.mockResolvedValue({ vendorId: OWN_VENDOR, balance: -1800 });
    const res = makeRes();

    await publicGetBillingStatusController(makeReq(), res);

    expect(res.body.data.paymentNote).toBe("Add your business name");
    expect(res.body.data).not.toHaveProperty("paymentQrPath");
  });

  it("401s without an API key", async () => {
    const res = makeRes();
    await publicGetBillingStatusController(makeReq({ apiKey: undefined }), res);
    expect(res.statusCode).toBe(401);
  });
});

describe("publicListVendorPaymentsController", () => {
  it("forwards only the whitelisted filters, never a vendorId", async () => {
    mockedListPayments.mockResolvedValue({
      data: [payment],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    const req = makeReq({ query: { status: "pending", vendorId: OTHER_VENDOR } });

    await publicListVendorPaymentsController(req, makeRes());

    const [actor, filters] = mockedListPayments.mock.calls[0] ?? [];
    expect(actor).toEqual({ id: KEY_USER, roles: ["vendor"] });
    expect(filters).toEqual({ status: "pending" });
    expect(filters).not.toHaveProperty("vendorId");
  });

  it("replaces the internal proof path with a hasProof flag", async () => {
    mockedListPayments.mockResolvedValue({
      data: [payment, { ...payment, id: "no-proof", proofPath: null }],
      meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
    });
    const res = makeRes();

    await publicListVendorPaymentsController(makeReq(), res);

    expect(res.body.data[0].hasProof).toBe(true);
    expect(res.body.data[1].hasProof).toBe(false);
    for (const row of res.body.data) expect(row).not.toHaveProperty("proofPath");
  });
});

describe("publicSubmitVendorPaymentController", () => {
  const withKey = (body: Record<string, unknown>) =>
    makeReq({ body, headers: { "idempotency-key": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" } });

  it("requires an Idempotency-Key header, like every other v1 write", async () => {
    const res = makeRes();
    await publicSubmitVendorPaymentController(makeReq({ body: { amount: "1500" } }), res);
    expect(res.statusCode).toBe(400);
    expect(mockedSubmitPayment).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID Idempotency-Key", async () => {
    const res = makeRes();
    const req = makeReq({ body: { amount: "1500" }, headers: { "idempotency-key": "abc" } });
    await publicSubmitVendorPaymentController(req, res);
    expect(res.statusCode).toBe(400);
    expect(mockedSubmitPayment).not.toHaveBeenCalled();
  });

  // Multipart fields arrive as strings, so an un-coerced amount would reach the
  // service as NaN and a "0" would slip past a truthiness check.
  it("coerces the multipart amount and rejects non-positive values", async () => {
    mockedSubmitPayment.mockResolvedValue(payment);
    const res = makeRes();

    await publicSubmitVendorPaymentController(withKey({ amount: "1500" }), res);
    expect(mockedSubmitPayment.mock.calls[0]?.[1].amount).toBe(1500);

    for (const bad of ["0", "-5", "abc", undefined]) {
      mockedSubmitPayment.mockClear();
      const badRes = makeRes();
      await publicSubmitVendorPaymentController(withKey({ amount: bad }), badRes);
      expect(badRes.statusCode).toBe(400);
      expect(mockedSubmitPayment).not.toHaveBeenCalled();
    }
  });

  it("returns 201 with the claim, proof path stripped", async () => {
    mockedSubmitPayment.mockResolvedValue(payment);
    const res = makeRes();

    await publicSubmitVendorPaymentController(withKey({ amount: "1500" }), res);

    expect(res.statusCode).toBe(201);
    expect(res.body.data.hasProof).toBe(true);
    expect(res.body.data).not.toHaveProperty("proofPath");
  });

  it("submits as the key's own vendor actor", async () => {
    mockedSubmitPayment.mockResolvedValue(payment);

    await publicSubmitVendorPaymentController(
      withKey({ amount: "1500", vendorId: OTHER_VENDOR }),
      makeRes(),
    );

    const [actor, input] = mockedSubmitPayment.mock.calls[0] ?? [];
    expect(actor).toEqual({ id: KEY_USER, roles: ["vendor"] });
    expect(input).not.toHaveProperty("vendorId");
  });
});
