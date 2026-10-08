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
});
