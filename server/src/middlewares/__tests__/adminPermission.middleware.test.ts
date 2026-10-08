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
