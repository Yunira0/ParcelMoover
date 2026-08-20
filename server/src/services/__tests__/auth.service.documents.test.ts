import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/prisma", () => ({
  default: {
    users: { findUnique: vi.fn() },
    vendors: { findUnique: vi.fn(), findFirst: vi.fn() },
    user_roles: { findFirst: vi.fn(), findMany: vi.fn() },
    roles: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../lib/mailer", () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("bcrypt", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-password") },
}));

import { registerUserBySuperAdmin, updateManagedUserProfile } from "../auth.service";
import prisma from "../../lib/prisma";

const mockedPrisma = prisma as unknown as {
  users: { findUnique: ReturnType<typeof vi.fn> };
  vendors: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  user_roles: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  roles: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

// The actor performing the write, with whatever roles the case needs.
const actorWithRoles = (codes: string[]) => ({
  id: "actor-1",
  user_roles: codes.map((code) => ({ roles: { code } })),
  admins: { permissions: [], location_id: null },
});

const validVendorInput = {
  type: "vendor" as const,
  fullName: "Jane Owner",
  email: "jane@example.com",
  password: "sufficiently-long",
  phone: "9800000000",
  clientName: "Jane Owner",
  businessName: "Acme Delivery",
  pickupLandmark: "Near the big chowk",
};

function makeMockTx() {
  return {
    users: { create: vi.fn().mockResolvedValue({ id: "new-user-1" }), update: vi.fn() },
    user_roles: { create: vi.fn().mockResolvedValue({}) },
    vendors: {
      create: vi.fn().mockResolvedValue({ id: "new-vendor-1" }),
      update: vi.fn().mockResolvedValue({ id: "vendor-1" }),
    },
    audit_logs: { create: vi.fn().mockResolvedValue({}) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedPrisma.roles.findUnique.mockResolvedValue({ id: "role-vendor", code: "vendor" });
  // No root super admin in play, and the target holds no protected role.
  mockedPrisma.user_roles.findFirst.mockResolvedValue({ user_id: "root-user" });
  mockedPrisma.user_roles.findMany.mockResolvedValue([]);
});

describe("registerUserBySuperAdmin - vendor documents", () => {
  it("rejects a vendor with no citizenship document", async () => {
    mockedPrisma.users.findUnique.mockResolvedValue(actorWithRoles(["super_admin"]));

    await expect(
      registerUserBySuperAdmin("actor-1", { ...validVendorInput }),
    ).rejects.toMatchObject({ statusCode: 400, message: "Citizenship document is required for vendor" });
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("stores the uploaded document paths when they are supplied", async () => {
    mockedPrisma.users.findUnique.mockResolvedValue(actorWithRoles(["super_admin"]));
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await registerUserBySuperAdmin("actor-1", {
      ...validVendorInput,
      citizenshipDocPath: "uploads/registration/citizenship.pdf",
      panVatDocPath: "uploads/registration/pan.pdf",
    });

    expect(tx.vendors.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          citizenship_doc: "uploads/registration/citizenship.pdf",
          pan_vat_doc: "uploads/registration/pan.pdf",
          business_cert_doc: null,
        }),
      }),
    );
  });
});

describe("updateManagedUserProfile - backfilling documents", () => {
  const vendorProfile = { id: "vendor-1", user_id: "vendor-user-1", sales_user_id: null, sales_edited_at: null };

  it("writes a document an admin attaches to an existing vendor", async () => {
    mockedPrisma.users.findUnique.mockResolvedValue(actorWithRoles(["admin"]));
    mockedPrisma.vendors.findUnique.mockResolvedValue(vendorProfile);
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await updateManagedUserProfile("actor-1", "vendor-1", {
      type: "vendor",
      citizenshipDocPath: "uploads/registration/backfilled.pdf",
    });

    expect(tx.vendors.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "vendor-1" },
        data: expect.objectContaining({ citizenship_doc: "uploads/registration/backfilled.pdf" }),
      }),
    );
    expect(tx.audit_logs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "UPDATE_USER_DOCUMENTS",
          new_data: { documentsAttached: ["citizenship_doc"] },
        }),
      }),
    );
  });

  it("leaves stored documents alone on an edit that uploads nothing", async () => {
    mockedPrisma.users.findUnique.mockResolvedValue(actorWithRoles(["admin"]));
    mockedPrisma.vendors.findUnique.mockResolvedValue(vendorProfile);
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await updateManagedUserProfile("actor-1", "vendor-1", {
      type: "vendor",
      clientName: "Renamed Vendor",
    });

    const data = tx.vendors.update.mock.calls[0]![0].data;
    expect(data).not.toHaveProperty("citizenship_doc");
    expect(data).not.toHaveProperty("pan_vat_doc");
    expect(data).not.toHaveProperty("business_cert_doc");
    expect(tx.audit_logs.create).not.toHaveBeenCalled();
  });

  it("ignores documents sent by a sales user, who may not view them", async () => {
    mockedPrisma.users.findUnique.mockResolvedValue(actorWithRoles(["sales"]));
    mockedPrisma.vendors.findFirst.mockResolvedValue({ id: "vendor-1" });
    mockedPrisma.vendors.findUnique.mockResolvedValue({ ...vendorProfile, sales_user_id: "actor-1" });
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: any) => fn(tx));

    await updateManagedUserProfile("actor-1", "vendor-1", {
      type: "vendor",
      clientName: "Renamed Vendor",
      citizenshipDocPath: "uploads/registration/sneaked.pdf",
    });

    expect(tx.vendors.update.mock.calls[0]![0].data).not.toHaveProperty("citizenship_doc");
    expect(tx.audit_logs.create).not.toHaveBeenCalled();
  });
});

