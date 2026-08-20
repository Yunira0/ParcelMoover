import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    users: { findUnique: vi.fn(), update: vi.fn() },
    vendors: { findUnique: vi.fn(), findFirst: vi.fn() },
    user_roles: { findFirst: vi.fn() },
  },
}));
vi.mock("bcrypt", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-password") },
}));

import { updateManagedUserPassword } from "../auth.service";
import prisma from "../../lib/prisma";

const mockedPrisma = prisma as unknown as {
  users: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  vendors: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  user_roles: { findFirst: ReturnType<typeof vi.fn> };
};

const actorWithRoles = (codes: string[]) => ({
  id: "actor-1",
  user_roles: codes.map((code) => ({ roles: { code } })),
  admins: { permissions: [] },
});

// Resetting a vendor's password revokes every one of their sessions and forces
// a change on next login, so who may do it matters as much as to whom.
describe("updateManagedUserPassword - sales ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refuses a sales rep resetting a vendor that is not their client", async () => {
    mockedPrisma.users.findUnique.mockResolvedValue(actorWithRoles(["sales"]));
    // No row matching { id, sales_user_id: actor } - someone else's client.
    mockedPrisma.vendors.findFirst.mockResolvedValue(null);

    await expect(
      updateManagedUserPassword("actor-1", "vendor", "vendor-9", "sufficiently-long"),
    ).rejects.toMatchObject({ statusCode: 403 });

    // Rejected before anything was read or written about the target.
    expect(mockedPrisma.vendors.findUnique).not.toHaveBeenCalled();
    expect(mockedPrisma.users.update).not.toHaveBeenCalled();
  });

  it("lets a sales rep past the ownership gate for their own client", async () => {
    mockedPrisma.users.findUnique.mockResolvedValue(actorWithRoles(["sales"]));
    mockedPrisma.vendors.findFirst.mockResolvedValue({ id: "vendor-1" });
    // Ownership passed; the next step is loading the profile. Returning null
    // stops the chain here with its own 404, which is enough to show the 403
    // gate did not fire.
    mockedPrisma.vendors.findUnique.mockResolvedValue(null);

    await expect(
      updateManagedUserPassword("actor-1", "vendor", "vendor-1", "sufficiently-long"),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockedPrisma.vendors.findFirst).toHaveBeenCalled();
  });

  it("does not run the ownership query for an admin", async () => {
    mockedPrisma.users.findUnique.mockResolvedValue(actorWithRoles(["admin"]));
    mockedPrisma.vendors.findUnique.mockResolvedValue(null);

    await expect(
      updateManagedUserPassword("actor-1", "vendor", "vendor-1", "sufficiently-long"),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(mockedPrisma.vendors.findFirst).not.toHaveBeenCalled();
  });

  it("still rejects a too-short password", async () => {
    mockedPrisma.users.findUnique.mockResolvedValue(actorWithRoles(["admin"]));

    await expect(
      updateManagedUserPassword("actor-1", "vendor", "vendor-1", "short"),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
