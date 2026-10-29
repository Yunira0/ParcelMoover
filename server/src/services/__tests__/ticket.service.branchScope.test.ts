// A branch-scoped admin sees tickets raised by their branch's admins and by the
// vendors (owner + staff) registered at their branch - not other branches'.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    admins: { findMany: vi.fn() },
    vendors: { findMany: vi.fn() },
    support_tickets: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("../../lib/branchScope", () => ({ adminBranchScopeIds: vi.fn() }));
vi.mock("../notification.service", () => ({ createNotification: vi.fn() }));
vi.mock("../order.service", () => ({ notifyAdmins: vi.fn() }));

import { listTickets } from "../ticket.service";
import prisma from "../../lib/prisma";
import { adminBranchScopeIds } from "../../lib/branchScope";

const mocked = prisma as unknown as {
  admins: { findMany: ReturnType<typeof vi.fn> };
  vendors: { findMany: ReturnType<typeof vi.fn> };
  support_tickets: { count: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
};
const mockedScope = adminBranchScopeIds as unknown as ReturnType<typeof vi.fn>;

const BRANCH_ADMIN = { id: "admin-self", roles: ["admin"] };

beforeEach(() => {
  vi.clearAllMocks();
  mocked.support_tickets.count.mockResolvedValue(0);
  mocked.support_tickets.groupBy.mockResolvedValue([]);
  mocked.support_tickets.findMany.mockResolvedValue([]);
});

const creatorFilter = () => mocked.support_tickets.findMany.mock.calls[0]![0].where.created_by.in as string[];

describe("listTickets — branch-scoped admin", () => {
  it("includes tickets from the branch's admins and its vendors' owner and staff accounts", async () => {
    mockedScope.mockResolvedValue(["hub-hetauda", "area-bazaar"]);
    mocked.admins.findMany.mockResolvedValue([{ user_id: "admin-colleague" }]);
    mocked.vendors.findMany.mockResolvedValue([
      { user_id: "vendor-owner", vendor_staff: [{ user_id: "vendor-staff-1" }] },
      { user_id: null, vendor_staff: [{ user_id: "vendor-staff-2" }] },
    ]);

    await listTickets(BRANCH_ADMIN);

    expect(mocked.vendors.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { location_id: { in: ["hub-hetauda", "area-bazaar"] } } }),
    );
    expect(creatorFilter().sort()).toEqual(
      ["admin-self", "admin-colleague", "vendor-owner", "vendor-staff-1", "vendor-staff-2"].sort(),
    );
  });

  it("leaves an unscoped admin unfiltered", async () => {
    mockedScope.mockResolvedValue(undefined);

    await listTickets(BRANCH_ADMIN);

    expect(mocked.vendors.findMany).not.toHaveBeenCalled();
    expect(mocked.support_tickets.findMany.mock.calls[0]![0].where.created_by).toBeUndefined();
  });

  it("counts one category's tickets within the branch scope for an operations page", async () => {
    mockedScope.mockResolvedValue(["hub-hetauda"]);
    mocked.admins.findMany.mockResolvedValue([]);
    mocked.vendors.findMany.mockResolvedValue([{ user_id: "vendor-owner", vendor_staff: [] }]);
    mocked.support_tickets.groupBy
      .mockResolvedValueOnce([{ status: "pending", _count: { _all: 5 } }])
      .mockResolvedValueOnce([
        { status: "pending", _count: { _all: 2 } },
        { status: "in_progress", _count: { _all: 1 } },
        { status: "resolved", _count: { _all: 3 } },
      ]);

    const { meta } = await listTickets(BRANCH_ADMIN, { category: "pickup", status: "pending" });

    const categoryWhere = mocked.support_tickets.groupBy.mock.calls[1]![0].where;
    expect(categoryWhere.category).toBe("pickup");
    expect(categoryWhere.status).toBeUndefined();
    expect((categoryWhere.created_by.in as string[]).sort()).toEqual(["admin-self", "vendor-owner"]);
    expect(meta.categoryStatusCounts).toEqual({ all: 6, pending: 2, open: 1, closed: 3 });
    expect(meta.statusCounts).toEqual({ all: 5, pending: 5, open: 0, closed: 0 });
  });

  it("omits category counts when no category is requested", async () => {
    mockedScope.mockResolvedValue(undefined);

    const { meta } = await listTickets(BRANCH_ADMIN);

    expect(mocked.support_tickets.groupBy).toHaveBeenCalledTimes(1);
    expect(meta).not.toHaveProperty("categoryStatusCounts");
  });
});
