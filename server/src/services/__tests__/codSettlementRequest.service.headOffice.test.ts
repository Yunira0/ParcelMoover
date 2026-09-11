// COD settlement requests used to have zero branch awareness - any admin,
// branch-scoped or not, could list/view/approve any vendor's request. Vendor
// COD settlement is centralised at head office everywhere else in the app
// (see assertHeadOfficeForVendorSettlement in finance.service.ts); these lock
// down the same rule here via the shared assertHeadOfficeOnly helper.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../utils/AppError";

vi.mock("../../lib/prisma", () => ({
  default: {
    cod_settlement_requests: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    vendors: { findFirst: vi.fn() },
    vendor_staff: { findFirst: vi.fn() },
  },
}));
vi.mock("../../lib/branchScope", () => ({
  assertHeadOfficeOnly: vi.fn(),
}));
vi.mock("../notification.service", () => ({ createNotification: vi.fn() }));
vi.mock("../order.service", () => ({ notifyAdmins: vi.fn() }));
vi.mock("../billing.service", () => ({ getVendorAccountBalance: vi.fn() }));

import prisma from "../../lib/prisma";
import { assertHeadOfficeOnly } from "../../lib/branchScope";
import {
  listCodSettlementRequests,
  getCodSettlementRequestById,
  updateCodSettlementRequestStatus,
} from "../codSettlementRequest.service";

const mockedPrisma = prisma as unknown as {
  cod_settlement_requests: {
    findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>;
  };
  vendors: { findFirst: ReturnType<typeof vi.fn> };
  vendor_staff: { findFirst: ReturnType<typeof vi.fn> };
};
const mockedAssertHeadOfficeOnly = assertHeadOfficeOnly as unknown as ReturnType<typeof vi.fn>;

const SUPER_ADMIN = { id: "root-1", roles: ["super_admin"] };
const BRANCH_ADMIN = { id: "admin-1", roles: ["admin"] };
const VENDOR_ACTOR = { id: "vendor-user-1", roles: ["vendor"] };

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "req-1", request_no: "CSR-1", vendor_id: "vendor-1",
    bank_name: "Nabil", account_number: "123", account_name: "Acme",
    note: null, amount_snapshot: 1000, status: "pending",
    decision_note: null, reviewed_at: null, closed_at: null, created_at: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listCodSettlementRequests", () => {
  it("asserts head-office-only for staff and lets a real 403 propagate", async () => {
    mockedAssertHeadOfficeOnly.mockRejectedValue(new AppError(403, "blocked"));

    await expect(listCodSettlementRequests(BRANCH_ADMIN, {})).rejects.toMatchObject({ statusCode: 403 });
    expect(mockedAssertHeadOfficeOnly).toHaveBeenCalledWith(BRANCH_ADMIN, expect.any(String));
  });

  it("lists everything for staff once the head-office check passes", async () => {
    mockedAssertHeadOfficeOnly.mockResolvedValue(undefined);
    mockedPrisma.cod_settlement_requests.findMany.mockResolvedValue([]);
    mockedPrisma.cod_settlement_requests.count.mockResolvedValue(0);

    await listCodSettlementRequests(SUPER_ADMIN, {});

    const where = mockedPrisma.cod_settlement_requests.findMany.mock.calls[0]![0].where;
    expect(where.vendor_id).toBeUndefined();
  });

  it("never calls the head-office check for a vendor actor - they're scoped to their own vendor instead", async () => {
    mockedPrisma.vendors.findFirst.mockResolvedValue({ id: "vendor-1" });
    mockedPrisma.cod_settlement_requests.findMany.mockResolvedValue([]);
    mockedPrisma.cod_settlement_requests.count.mockResolvedValue(0);

    await listCodSettlementRequests(VENDOR_ACTOR, {});

    expect(mockedAssertHeadOfficeOnly).not.toHaveBeenCalled();
  });
});

describe("getCodSettlementRequestById", () => {
  it("blocks a branch-scoped admin from viewing any request", async () => {
    mockedPrisma.cod_settlement_requests.findUnique.mockResolvedValue(requestRow());
    mockedAssertHeadOfficeOnly.mockRejectedValue(new AppError(403, "blocked"));

    await expect(getCodSettlementRequestById(BRANCH_ADMIN, "req-1")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("allows a head-office admin through", async () => {
    mockedPrisma.cod_settlement_requests.findUnique.mockResolvedValue(requestRow());
    mockedAssertHeadOfficeOnly.mockResolvedValue(undefined);

    await expect(getCodSettlementRequestById(SUPER_ADMIN, "req-1")).resolves.toBeDefined();
  });
});

describe("updateCodSettlementRequestStatus", () => {
  it("blocks a branch-scoped admin from actioning a request", async () => {
    mockedAssertHeadOfficeOnly.mockRejectedValue(new AppError(403, "blocked"));

    await expect(
      updateCodSettlementRequestStatus(BRANCH_ADMIN, "req-1", { status: "settled" } as any),
    ).rejects.toMatchObject({ statusCode: 403 });
    // Refused before the row is even loaded.
    expect(mockedPrisma.cod_settlement_requests.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a non-staff actor before the head-office check ever runs", async () => {
    await expect(
      updateCodSettlementRequestStatus(VENDOR_ACTOR, "req-1", { status: "settled" } as any),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockedAssertHeadOfficeOnly).not.toHaveBeenCalled();
  });
});
