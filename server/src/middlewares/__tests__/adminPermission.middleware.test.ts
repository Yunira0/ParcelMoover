import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: { admins: { findFirst: vi.fn() } },
  pool: {},
}));

import prisma from "../../lib/prisma";
import { hasAdminPermission } from "../adminPermission.middleware";

const findFirst = prisma.admins.findFirst as unknown as ReturnType<typeof vi.fn>;

describe("branch tracking permission implication", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets BRANCH_TRACKING_WRITE satisfy read checks", async () => {
    findFirst.mockResolvedValue({ permissions: ["BRANCH_TRACKING_WRITE"] });
    await expect(hasAdminPermission({ id: "admin", roles: ["admin"] }, "BRANCH_TRACKING_READ")).resolves.toBe(true);
  });

  it("does not let read-only access satisfy write checks", async () => {
    findFirst.mockResolvedValue({ permissions: ["BRANCH_TRACKING_READ"] });
    await expect(hasAdminPermission({ id: "admin", roles: ["admin"] }, "BRANCH_TRACKING_WRITE")).resolves.toBe(false);
  });

  it("always permits a super admin without a database lookup", async () => {
    await expect(hasAdminPermission({ id: "root", roles: ["super_admin"] }, "BRANCH_TRACKING_WRITE")).resolves.toBe(true);
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("department workspace permissions", () => {
  beforeEach(() => vi.clearAllMocks());
  const admin = { id: "admin", roles: ["admin"] };

  it.each(["Operation", "Customer Experience"])("gives a %s admin read-only Branch Overview", async (department) => {
    findFirst.mockResolvedValue({ permissions: [], department, branch_scoped: false });
    await expect(hasAdminPermission(admin, "BRANCH_TRACKING_READ")).resolves.toBe(true);
    await expect(hasAdminPermission(admin, "BRANCH_TRACKING_WRITE")).resolves.toBe(false);
    await expect(hasAdminPermission(admin, "ACCOUNTING_ACCESS")).resolves.toBe(false);
  });

  it("never lifts a branch-scoped admin's scope by department", async () => {
    findFirst.mockResolvedValue({ permissions: [], department: "Operation", branch_scoped: true });
    await expect(hasAdminPermission(admin, "BRANCH_TRACKING_READ")).resolves.toBe(false);
  });

  it("grants nothing for other departments", async () => {
    findFirst.mockResolvedValue({ permissions: [], department: "Sales", branch_scoped: false });
    await expect(hasAdminPermission(admin, "BRANCH_TRACKING_READ")).resolves.toBe(false);
  });
});
