import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "../../utils/AppError";

vi.mock("../../lib/prisma", () => ({
  default: {
    vendor_kyc_applications: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    vendors: { findFirst: vi.fn() },
    audit_logs: { findFirst: vi.fn(), create: vi.fn() },
    users: { findFirst: vi.fn() },
    roles: { findUnique: vi.fn() },
    billing_settings: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("../../lib/redis", () => ({
  default: { get: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock("../../lib/mailer", () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("bcrypt", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-password") },
}));

import { approveKycApplication, getVendorKycStatus, startVendorVerification, submitVendorVerification } from "../kyc.service";
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";

const mockedRedis = redis as unknown as { get: ReturnType<typeof vi.fn> };

const mockedPrisma = prisma as unknown as {
  vendor_kyc_applications: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  vendors: { findFirst: ReturnType<typeof vi.fn> };
  audit_logs: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  users: { findFirst: ReturnType<typeof vi.fn> };
  billing_settings: { findFirst: ReturnType<typeof vi.fn> };
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
  citizenship_doc_front: "uploads/registration/citizenship-front.pdf",
  citizenship_doc_back: "uploads/registration/citizenship-back.pdf",
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
    // New vendors snapshot the current system default credit limit.
    mockedRedis.get.mockResolvedValue(null);
    mockedPrisma.billing_settings.findFirst.mockResolvedValue({
      id: "settings-1",
      warn_threshold: -2000,
      default_credit_limit: 77777,
      branch_warn_threshold: -50000,
      branch_block_threshold: -75000,
      payment_qr_path: null,
      payment_note: null,
    });
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
      citizenship_doc: pendingApplication.citizenship_doc_front,
      citizenship_doc_back: pendingApplication.citizenship_doc_back,
      pan_vat_doc: pendingApplication.pan_vat_doc,
      business_cert_doc: pendingApplication.business_cert_doc,
      bank_name: pendingApplication.bank_name,
      bank_account_no: pendingApplication.bank_account_no,
      bank_account_holder: pendingApplication.bank_account_holder,
      status: "active",
    });
  });

  // Regression: this used to be left unset, so it fell to the schema default of
  // "flat" and a vendor who signed up through KYC was priced on a different
  // model from one an admin created by hand (registerVendor already defaults to
  // per_destination).
  it("puts a KYC vendor on per-destination rates, like an admin-created vendor", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await approveKycApplication("app-1", "reviewer-1");

    const call = tx.vendors.create.mock.calls[0];
    if (!call) throw new Error("vendors.create was not called");
    expect(call[0].data.rate_type).toBe("per_destination");
  });

  it("assigns the current system default credit limit to the new vendor", async () => {
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await approveKycApplication("app-1", "reviewer-1");

    const call = tx.vendors.create.mock.calls[0];
    if (!call) throw new Error("vendors.create was not called");
    expect(call[0].data.credit_limit).toBe(77777);
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

const verificationVendor = {
  id: "vendor-1",
  status: "active",
  deleted_at: null,
  business_name: "Acme Delivery",
  client_name: "Jane Owner",
  address: "Kathmandu, Baneshwor",
  pickup_landmark: null,
  phone: "9800000000",
  email: "jane@example.com",
  billing_business_name: null,
  registration_no: null,
  pan_vat_no: null,
  citizenship_doc: "uploads/kyc/citizenship-front.pdf",
  citizenship_doc_back: "uploads/kyc/citizenship-back.pdf",
  pan_vat_doc: null,
  business_cert_doc: null,
  bank_name: "Test Bank",
  bank_account_no: "1234567890",
  bank_account_holder: "Jane Owner",
};

describe("KYC verification for existing vendors", () => {
  beforeEach(() => {
    mockedPrisma.vendors.findFirst.mockResolvedValue(verificationVendor);
    // Not yet verified, nothing pending.
    mockedPrisma.audit_logs.findFirst.mockResolvedValue(null);
    mockedPrisma.vendor_kyc_applications.findFirst.mockResolvedValue(null);
    mockedPrisma.vendor_kyc_applications.create.mockResolvedValue({
      id: "vapp-1", status: "pending", created_at: new Date(),
    });
  });

  it("starts a verification prefilled from the vendor profile and audits it", async () => {
    const started = await startVendorVerification("admin-1", "vendor-1");

    expect(started.vendorId).toBe("vendor-1");
    const payload = mockedPrisma.vendor_kyc_applications.create.mock.calls[0]?.[0].data;
    expect(payload).toMatchObject({
      vendor_id: "vendor-1",
      online_business_name: "Acme Delivery",
      owner_email: "jane@example.com",
      citizenship_doc_front: "uploads/kyc/citizenship-front.pdf",
      citizenship_doc_back: "uploads/kyc/citizenship-back.pdf",
    });
    expect(mockedPrisma.audit_logs.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "KYC_STARTED" }) }),
    );
  });

  it("refuses to start when the vendor is already verified", async () => {
    mockedPrisma.audit_logs.findFirst.mockResolvedValue({ entity_id: "kyc-old" });
    mockedPrisma.vendor_kyc_applications.findFirst.mockResolvedValue({ id: "kyc-old" });

    await expect(startVendorVerification("admin-1", "vendor-1")).rejects.toThrow("already KYC verified");
    expect(mockedPrisma.vendor_kyc_applications.create).not.toHaveBeenCalled();
  });

  it("lets staff override prefilled fields by hand, validating like onboarding", async () => {
    await startVendorVerification("admin-1", "vendor-1", {
      onlineBusinessName: "Corrected Shop Name",
      ownerEmail: "CORRECTED@Example.COM",
    });

    const payload = mockedPrisma.vendor_kyc_applications.create.mock.calls[0]?.[0].data;
    expect(payload).toMatchObject({
      online_business_name: "Corrected Shop Name",
      owner_email: "corrected@example.com",
      // Untouched fields keep the account defaults.
      business_contact: "9800000000",
    });

    await expect(startVendorVerification("admin-1", "vendor-1", { businessContact: "123" }))
      .rejects.toThrow("valid Nepali mobile");
    expect(mockedPrisma.vendor_kyc_applications.create).toHaveBeenCalledOnce();
  });

  it("lets a vendor fill the form itself but keeps the account email locked", async () => {
    const submitted = await submitVendorVerification({ id: "vendor-user-1" }, "vendor-1", {
      onlineBusinessName: "My Corrected Name",
      ownerEmail: "hijack@evil.example",
    }, {});

    expect(submitted).toEqual({ id: "vapp-1" });
    const payload = mockedPrisma.vendor_kyc_applications.create.mock.calls[0]?.[0].data;
    expect(payload).toMatchObject({
      online_business_name: "My Corrected Name",
      owner_email: "jane@example.com",
      citizenship_doc_front: "uploads/kyc/citizenship-front.pdf",
      citizenship_doc_back: "uploads/kyc/citizenship-back.pdf",
    });
    expect(mockedPrisma.audit_logs.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "KYC_SUBMIT", actor_id: "vendor-user-1" }) }),
    );
  });

  it("requires a citizenship scan when none is on file either", async () => {
    mockedPrisma.vendors.findFirst.mockResolvedValue({ ...verificationVendor, citizenship_doc: null, citizenship_doc_back: null });

    await expect(submitVendorVerification({ id: "vendor-user-1" }, "vendor-1", {}, {}))
      .rejects.toThrow("Citizenship document (front side) is required");
    expect(mockedPrisma.vendor_kyc_applications.create).not.toHaveBeenCalled();
  });

  it("reports status, prefill, and docs on file for the form", async () => {
    const status = await getVendorKycStatus("vendor-1");

    expect(status.hasApprovedKyc).toBe(false);
    expect(status.pendingApplication).toBeNull();
    expect(status.profile).toMatchObject({
      onlineBusinessName: "Acme Delivery",
      ownerEmail: "jane@example.com",
    });
    expect(status.docsOnFile).toEqual({ citizenship: true, panVat: false, businessCert: false });
  });

  it("approves a verification by linking the vendor, creating no accounts", async () => {
    mockedPrisma.vendor_kyc_applications.findUnique.mockResolvedValue({
      ...pendingApplication, id: "vapp-1", vendor_id: "vendor-1",
    });
    const tx = makeMockTx();
    mockedPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx));

    await approveKycApplication("vapp-1", "reviewer-1");

    expect(tx.users.create).not.toHaveBeenCalled();
    expect(tx.vendors.create).not.toHaveBeenCalled();
    expect(tx.audit_logs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "KYC_APPROVE",
          new_data: expect.objectContaining({ status: "approved", createdVendorId: "vendor-1" }),
        }),
      }),
    );
  });

  it("refuses to approve a verification whose vendor went inactive", async () => {
    mockedPrisma.vendor_kyc_applications.findUnique.mockResolvedValue({
      ...pendingApplication, id: "vapp-1", vendor_id: "vendor-1",
    });
    mockedPrisma.vendors.findFirst.mockResolvedValue({ id: "vendor-1", status: "inactive" });

    await expect(approveKycApplication("vapp-1", "reviewer-1")).rejects.toThrow("no longer active");
    expect(mockedPrisma.$transaction).not.toHaveBeenCalled();
  });
});
