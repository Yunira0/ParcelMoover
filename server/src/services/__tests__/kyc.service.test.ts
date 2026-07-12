import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../utils/AppError";

vi.mock("../../lib/prisma", () => ({
  default: {
    vendor_kyc_applications: { findUnique: vi.fn() },
    users: { findFirst: vi.fn() },
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

import { approveKycApplication } from "../kyc.service";
import prisma from "../../lib/prisma";

const mockedPrisma = prisma as unknown as {
  vendor_kyc_applications: { findUnique: ReturnType<typeof vi.fn> };
  users: { findFirst: ReturnType<typeof vi.fn> };
  roles: { findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

// A fully-populated pending application - every optional field filled in,
// so a mapping regression (a field silently dropped) is caught by asserting
// the exact payload handed to vendors.create.
const pendingApplication = {
  id: "app-1",
  status: "pending",
  online_business_name: "Acme Delivery",
  pickup_location: "Kathmandu, Baneshwor",
  pickup_landmark: "Near the big chowk",
  business_contact: "9800000000",
  owner_name: "Jane Owner",
  owner_email: "jane@example.com",
  owner_contact: "9811111111",
  billing_business_name: "Acme Pvt Ltd",
  registered_address: "Kathmandu, Ward 10",
  registration_no: "REG-123",
  pan_vat_no: "PAN-456",
  citizenship_doc: "uploads/registration/citizenship.pdf",
  pan_vat_doc: "uploads/registration/pan.pdf",
  business_cert_doc: "uploads/registration/cert.pdf",
  bank_name: "Nepal Bank",
  bank_account_no: "1234567890",
  bank_account_holder: "Jane Owner",
};

function makeMockTx() {
  return {
    vendor_kyc_applications: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    users: {
      create: vi.fn().mockResolvedValue({ id: "new-user-1" }),
    },
    user_roles: {
      create: vi.fn().mockResolvedValue({}),
    },
    vendors: {
      create: vi.fn().mockResolvedValue({ id: "new-vendor-1" }),
    },
    audit_logs: {
      create: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("approveKycApplication", () => {
  beforeEach(() => {
    mockedPrisma.vendor_kyc_applications.findUnique.mockResolvedValue(pendingApplication);
    mockedPrisma.users.findFirst.mockResolvedValue(null);
    mockedPrisma.roles.findUnique.mockResolvedValue({ id: "role-vendor", code: "vendor" });
  });

  it("carries every KYC application field over to the new vendor record", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await approveKycApplication("app-1", "reviewer-1");

    expect(tx.vendors.create).toHaveBeenCalledOnce();
    const call = tx.vendors.create.mock.calls[0];
    if (!call) throw new Error("vendors.create was not called");
    const vendorData = call[0].data;

    expect(vendorData).toMatchObject({
      user_id: "new-user-1",
      client_name: pendingApplication.owner_name,
      business_name: pendingApplication.online_business_name,
      phone: pendingApplication.owner_contact,
      email: pendingApplication.owner_email,
      address: pendingApplication.pickup_location,
      pickup_landmark: pendingApplication.pickup_landmark,
      billing_business_name: pendingApplication.billing_business_name,
      registration_no: pendingApplication.registration_no,
      pan_vat_no: pendingApplication.pan_vat_no,
      citizenship_doc: pendingApplication.citizenship_doc,
      pan_vat_doc: pendingApplication.pan_vat_doc,
      business_cert_doc: pendingApplication.business_cert_doc,
      bank_name: pendingApplication.bank_name,
      bank_account_no: pendingApplication.bank_account_no,
      bank_account_holder: pendingApplication.bank_account_holder,
      status: "active",
    });
  });

  it("rejects when the application is not pending", async () => {
    mockedPrisma.vendor_kyc_applications.findUnique.mockResolvedValue({
      ...pendingApplication,
      status: "approved",
    });

    await expect(approveKycApplication("app-1", "reviewer-1")).rejects.toThrow(AppError);
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects when a user account already exists for the owner email", async () => {
    mockedPrisma.users.findFirst.mockResolvedValue({ id: "existing-user" });

    await expect(approveKycApplication("app-1", "reviewer-1")).rejects.toThrow(AppError);
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });
});
