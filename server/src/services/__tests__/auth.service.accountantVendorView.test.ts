// Accountants open a vendor's details read-only from Vendor Management's View
// action; they still cannot read other account types or edit a vendor.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    users: { findUnique: vi.fn() },
    vendors: { findUnique: vi.fn(), findFirst: vi.fn() },
    user_roles: { findMany: vi.fn() },
  },
}));
vi.mock("../../lib/mailer", () => ({ sendWelcomeEmail: vi.fn() }));
vi.mock("../../lib/branchScope", () => ({ adminBranchScopeIds: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/redis", () => ({ default: { get: vi.fn(), setex: vi.fn(), del: vi.fn() } }));

import { getManagedUserDetail, updateManagedUserProfile } from "../auth.service";
import prisma from "../../lib/prisma";

const mocked = prisma as unknown as {
  users: { findUnique: ReturnType<typeof vi.fn> };
  vendors: { findUnique: ReturnType<typeof vi.fn> };
  user_roles: { findMany: ReturnType<typeof vi.fn> };
};

const ACCOUNTANT_ROLES = [{ roles: { code: "accountant" } }];

beforeEach(() => {
  vi.clearAllMocks();
  mocked.user_roles.findMany.mockResolvedValue(ACCOUNTANT_ROLES);
  mocked.users.findUnique.mockResolvedValue({ id: "acct-1", user_roles: ACCOUNTANT_ROLES, admins: null });
  mocked.vendors.findUnique.mockResolvedValue({
    id: "vendor-1",
    user_id: "vendor-user-1",
    client_name: "Jane Owner",
    business_name: "Acme Delivery",
    bank_name: "Nabil Bank",
    bank_account_no: "0123456789",
    bank_account_holder: "Acme Delivery",
    sales_user_id: null,
    sales_edited_at: null,
    joined_at: null,
  });
});

describe("getManagedUserDetail — accountant", () => {
  it("reads a vendor's details, bank account included", async () => {
    const data = await getManagedUserDetail("acct-1", "vendor", "vendor-1");

    expect(data).toMatchObject({ id: "vendor-1", businessName: "Acme Delivery", bankAccountNo: "0123456789" });
  });

  it("is refused other account types", async () => {
    await expect(getManagedUserDetail("acct-1", "admin", "admin-1")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("still cannot edit a vendor", async () => {
    await expect(
      updateManagedUserProfile("acct-1", "vendor-1", { type: "vendor", businessName: "Renamed" } as never),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
