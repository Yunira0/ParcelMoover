import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    users: { findUnique: vi.fn() },
    admins: { findUnique: vi.fn() },
    user_roles: { findFirst: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../lib/mailer", () => ({ sendWelcomeEmail: vi.fn() }));
vi.mock("../../lib/branchScope", () => ({ adminBranchScopeIds: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/redis", () => ({ default: { get: vi.fn(), setex: vi.fn(), del: vi.fn() } }));

import { updateManagedUserProfile } from "../auth.service";
import prisma from "../../lib/prisma";

const mocked = prisma as unknown as {
  users: { findUnique: ReturnType<typeof vi.fn> };
  admins: { findUnique: ReturnType<typeof vi.fn> };
  user_roles: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const ROLE_ROWS = [
  { id: "r-admin", code: "admin" },
  { id: "r-sales", code: "sales" },
  { id: "r-accountant", code: "accountant" },
];

/** A transaction over a target account that holds `targetRoles`. */
function stubTx(targetRoles: string[]) {
  const held = new Set(targetRoles);
  const tx = {
    users: { update: vi.fn() },
    admins: { update: vi.fn().mockResolvedValue({ id: "admin-1" }) },
    audit_logs: { create: vi.fn() },
    roles: { findMany: vi.fn(async () => ROLE_ROWS) },
    user_roles: {
      findMany: vi.fn(async () => [...held].map((code) => ({ roles: { code } }))),
      findUnique: vi.fn(async ({ where }: { where: { user_id_role_id: { role_id: string } } }) => {
        const code = ROLE_ROWS.find((r) => r.id === where.user_id_role_id.role_id)!.code;
        return held.has(code) ? { role_id: where.user_id_role_id.role_id } : null;
      }),
      create: vi.fn(async ({ data }: { data: { role_id: string } }) => held.add(ROLE_ROWS.find((r) => r.id === data.role_id)!.code)),
      delete: vi.fn(async ({ where }: { where: { user_id_role_id: { role_id: string } } }) =>
        held.delete(ROLE_ROWS.find((r) => r.id === where.user_id_role_id.role_id)!.code)),
    },
  };
  mocked.$transaction.mockImplementation(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx));
  return { tx, held };
}

const edit = (actorUserId: string, data: Record<string, unknown>) =>
  updateManagedUserProfile(actorUserId, "admin-1", { type: "admin", ...data });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.users.findUnique.mockResolvedValue({
    id: "super-1",
    user_roles: [{ roles: { code: "super_admin" } }],
    admins: { permissions: [], location_id: null },
  });
  mocked.admins.findUnique.mockResolvedValue({ id: "admin-1", user_id: "target-user" });
  // No root super admin in play.
  mocked.user_roles.findFirst.mockResolvedValue({ user_id: "root-user" });
  mocked.user_roles.findMany.mockResolvedValue([]);
});

describe("updateManagedUserProfile - admin role", () => {
  it("moves an admin to the sales role, and logs it", async () => {
    const { tx, held } = stubTx(["admin"]);

    await edit("super-1", { department: "Sales", role: "sales" });

    expect([...held]).toEqual(["sales"]);
    expect(tx.audit_logs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "CHANGE_ADMIN_ROLE", old_data: { roles: ["admin"] }, new_data: { role: "sales" } }),
    });
  });

  it("leaves access alone when only the department changes", async () => {
    const { tx, held } = stubTx(["admin"]);

    await edit("super-1", { department: "Sales" });

    expect([...held]).toEqual(["admin"]);
    expect(tx.user_roles.create).not.toHaveBeenCalled();
  });

  it("writes nothing when the role is unchanged", async () => {
    const { tx } = stubTx(["accountant"]);

    await edit("super-1", { role: "accountant" });

    expect(tx.user_roles.create).not.toHaveBeenCalled();
    expect(tx.user_roles.delete).not.toHaveBeenCalled();
    expect(tx.audit_logs.create).not.toHaveBeenCalled();
  });

  it("refuses to change your own role", async () => {
    mocked.admins.findUnique.mockResolvedValue({ id: "admin-1", user_id: "super-1" });
    const { held } = stubTx(["admin"]);

    await expect(edit("super-1", { role: "sales" })).rejects.toMatchObject({ statusCode: 400 });
    expect([...held]).toEqual(["admin"]);
  });

  it("refuses to change a super admin's base role", async () => {
    const { held } = stubTx(["super_admin", "admin"]);

    await expect(edit("super-1", { role: "sales" })).rejects.toMatchObject({ statusCode: 400 });
    expect(held.has("admin")).toBe(true);
  });
});
