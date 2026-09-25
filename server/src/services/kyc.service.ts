import prisma from "../lib/prisma";
import { Prisma } from "../generated/prisma/client";
import bcrypt from "bcrypt";
import { randomInt } from "crypto";
import path from "path";
import { unlink } from "fs/promises";
import { AppError } from "../utils/AppError";
import { sendWelcomeEmail } from "../lib/mailer";
import { getDefaultCreditLimit } from "./billing.service";

export interface KycApplicationInput {
  // Business Details
  onlineBusinessName: string;
  pickupLocation: string;
  pickupLandmark?: string | undefined;
  businessContact: string;

  // Owner / Contact Person
  ownerName: string;
  ownerEmail: string;
  ownerContact: string;

  // Billing Details
  billingBusinessName?: string | undefined;
  registeredAddress?: string | undefined;
  registrationNo?: string | undefined;
  panVatNo?: string | undefined;

  // Bank Details
  bankName: string;
  bankAccountNo: string;
  bankAccountHolder: string;

  // Document file paths (set by controller after multer processes files)
  citizenshipDocFrontPath?: string | undefined;
  citizenshipDocBackPath?: string | undefined;
  panVatDocPath?: string | undefined;
  businessCertDocPath?: string | undefined;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Person name: starts with a letter, then letters/marks/spaces/. ' ’ - (Unicode
// aware, so Nepali/Devanagari names pass).
const NAME_REGEX = /^\p{L}[\p{L}\p{M}\s.'’-]*$/u;
// Names/labels that may contain digits but must have at least one letter.
const LETTER_REGEX = /\p{L}/u;
// Nepali mobile: 10 digits starting 97/98, optional +977 (mirrors phoneSchema).
const PHONE_REGEX = /^(?:\+?977)?9[78]\d{8}$/;
const MAX_SHORT_FIELD_LENGTH = 200;
const MAX_LONG_FIELD_LENGTH = 1000;

// This endpoint is public/unauthenticated, so it can't lean on the trust
// internal endpoints get - every free-text field gets a length cap and the
// email gets format-checked instead of just a truthy check.
export function validateKycInput(input: KycApplicationInput) {
  if (!input.onlineBusinessName?.trim()) throw new AppError(400, "Online business name is required");
  if (!LETTER_REGEX.test(input.onlineBusinessName)) throw new AppError(400, "Business name must contain letters");
  if (!input.pickupLocation?.trim()) throw new AppError(400, "Pickup location is required");
  if (!input.businessContact?.trim()) throw new AppError(400, "Business contact number is required");
  if (!PHONE_REGEX.test(input.businessContact.trim())) throw new AppError(400, "Enter a valid Nepali mobile number");
  if (!input.ownerName?.trim()) throw new AppError(400, "Owner name is required");
  if (!NAME_REGEX.test(input.ownerName.trim())) throw new AppError(400, "Enter a valid owner name (letters, spaces, . ' - only)");
  if (!input.ownerEmail?.trim()) throw new AppError(400, "Owner email is required");
  if (!EMAIL_REGEX.test(input.ownerEmail.trim())) throw new AppError(400, "Invalid owner email address");
  if (!input.ownerContact?.trim()) throw new AppError(400, "Owner contact number is required");
  if (!PHONE_REGEX.test(input.ownerContact.trim())) throw new AppError(400, "Enter a valid Nepali mobile number");
  if (!input.bankName?.trim()) throw new AppError(400, "Bank name is required");
  if (!input.bankAccountNo?.trim()) throw new AppError(400, "Bank account number is required");
  if (!input.bankAccountHolder?.trim()) throw new AppError(400, "Bank account holder name is required");

  // Both sides of the citizenship document are mandatory to verify against;
  // PAN/VAT and business certificate scans are optional.
  if (!input.citizenshipDocFrontPath) throw new AppError(400, "Citizenship document (front side) is required");
  if (!input.citizenshipDocBackPath) throw new AppError(400, "Citizenship document (back side) is required");

  const shortFields: Array<[string, string | undefined]> = [
    ["Online business name", input.onlineBusinessName],
    ["Pickup location", input.pickupLocation],
    ["Pickup landmark", input.pickupLandmark],
    ["Business contact", input.businessContact],
    ["Owner name", input.ownerName],
    ["Owner email", input.ownerEmail],
    ["Owner contact", input.ownerContact],
    ["Billing business name", input.billingBusinessName],
    ["Registration no.", input.registrationNo],
    ["PAN/VAT no.", input.panVatNo],
    ["Bank name", input.bankName],
    ["Bank account no.", input.bankAccountNo],
    ["Bank account holder", input.bankAccountHolder],
  ];
  for (const [label, value] of shortFields) {
    if (value && value.trim().length > MAX_SHORT_FIELD_LENGTH) {
      throw new AppError(400, `${label} must be ${MAX_SHORT_FIELD_LENGTH} characters or fewer`);
    }
  }
  if (input.registeredAddress && input.registeredAddress.trim().length > MAX_LONG_FIELD_LENGTH) {
    throw new AppError(400, `Registered address must be ${MAX_LONG_FIELD_LENGTH} characters or fewer`);
  }
}

export async function submitKycApplication(data: KycApplicationInput) {
  validateKycInput(data);

  const normalizedEmail = data.ownerEmail.trim().toLowerCase();

  const existingUser = await prisma.users.findFirst({
    where: { email: normalizedEmail, deleted_at: null },
  });
  if (existingUser) {
    throw new AppError(409, "This email is already registered. Please log in or contact support if you need help.");
  }

  const existingApp = await prisma.vendor_kyc_applications.findFirst({
    where: { owner_email: normalizedEmail, status: "pending" },
  });
  if (existingApp) {
    throw new AppError(409, "A pending KYC application already exists for this email. Our team will review it shortly.");
  }

  return prisma.$transaction(async (tx) => {
    const app = await tx.vendor_kyc_applications.create({
      data: {
        online_business_name: data.onlineBusinessName.trim(),
        pickup_location: data.pickupLocation.trim(),
        pickup_landmark: data.pickupLandmark?.trim() || null,
        business_contact: data.businessContact.trim(),
        owner_name: data.ownerName.trim(),
        owner_email: normalizedEmail,
        owner_contact: data.ownerContact.trim(),
        billing_business_name: data.billingBusinessName?.trim() || null,
        registered_address: data.registeredAddress?.trim() || null,
        registration_no: data.registrationNo?.trim() || null,
        pan_vat_no: data.panVatNo?.trim() || null,
        citizenship_doc_front: data.citizenshipDocFrontPath || null,
        citizenship_doc_back: data.citizenshipDocBackPath || null,
        pan_vat_doc: data.panVatDocPath || null,
        business_cert_doc: data.businessCertDocPath || null,
        bank_name: data.bankName?.trim() || null,
        bank_account_no: data.bankAccountNo?.trim() || null,
        bank_account_holder: data.bankAccountHolder?.trim() || null,
      },
    });

    // No actor_id: this is the public, unauthenticated application form.
    await tx.audit_logs.create({
      data: {
        entity_type: "vendor_kyc_application",
        entity_id: app.id,
        action: "KYC_SUBMIT",
        new_data: {
          ownerEmail: normalizedEmail,
          onlineBusinessName: app.online_business_name,
          documentsSubmitted: {
            citizenshipDocFront: !!app.citizenship_doc_front,
            citizenshipDocBack: !!app.citizenship_doc_back,
            panVatDoc: !!app.pan_vat_doc,
            businessCertDoc: !!app.business_cert_doc,
          },
        },
      },
    });

    return app;
  });
}

const DEFAULT_PAGE_SIZE = 20;
// 500 so the list can offer the same largest page as every other screen.
const MAX_PAGE_SIZE = 500;

export async function listKycApplications(status?: string, page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const where = status && ["pending", "approved", "rejected"].includes(status)
    ? { status: status as "pending" | "approved" | "rejected" }
    : {};

  const take = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));
  const safePage = Math.max(1, page);
  const skip = (safePage - 1) * take;

  const [total, apps] = await Promise.all([
    prisma.vendor_kyc_applications.count({ where }),
    prisma.vendor_kyc_applications.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip,
      take,
    }),
  ]);

  const vendorIds = [...new Set(apps.map((a) => a.vendor_id).filter((id): id is string => !!id))];
  const linked = vendorIds.length
    ? await prisma.vendors.findMany({
        where: { id: { in: vendorIds } },
        select: { id: true, business_name: true, client_name: true },
      })
    : [];
  const vendorNameById = new Map(linked.map((v) => [v.id, v.business_name || v.client_name]));

  const data = apps.map((app, index) => ({
    id: app.id,
    sn: skip + index + 1,
    status: app.status,
    // Verification = an existing vendor proving itself (e.g. to unlock
    // vouchers); onboarding = a brand-new vendor. Approving the former links
    // the vendor, approving the latter creates one.
    applicationType: (app.vendor_id ? "verification" : "onboarding") as "verification" | "onboarding",
    vendorId: app.vendor_id,
    vendorName: app.vendor_id ? vendorNameById.get(app.vendor_id) ?? null : null,
    onlineBusinessName: app.online_business_name,
    pickupLocation: app.pickup_location,
    pickupLandmark: app.pickup_landmark,
    businessContact: app.business_contact,
    ownerName: app.owner_name,
    ownerEmail: app.owner_email,
    ownerContact: app.owner_contact,
    billingBusinessName: app.billing_business_name,
    registeredAddress: app.registered_address,
    registrationNo: app.registration_no,
    panVatNo: app.pan_vat_no,
    citizenshipDocFront: app.citizenship_doc_front,
    citizenshipDocBack: app.citizenship_doc_back,
    panVatDoc: app.pan_vat_doc,
    businessCertDoc: app.business_cert_doc,
    bankName: app.bank_name,
    bankAccountNo: app.bank_account_no,
    bankAccountHolder: app.bank_account_holder,
    rejectionReason: app.rejection_reason,
    notes: app.notes,
    reviewedAt: app.reviewed_at,
    createdAt: app.created_at,
  }));

  return {
    data,
    meta: {
      page: safePage,
      pageSize: take,
      total,
      totalPages: Math.max(1, Math.ceil(total / take)),
    },
  };
}

export async function getKycApplication(id: string) {
  const app = await prisma.vendor_kyc_applications.findUnique({ where: { id } });
  if (!app) throw new AppError(404, "KYC application not found");
  return app;
}

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let pwd = "";
  for (let i = 0; i < 12; i++) {
    pwd += chars.charAt(randomInt(chars.length));
  }
  return pwd;
}

export async function approveKycApplication(id: string, reviewerId: string, notes?: string) {
  const app = await prisma.vendor_kyc_applications.findUnique({ where: { id } });
  if (!app) throw new AppError(404, "KYC application not found");
  if (app.status !== "pending") throw new AppError(400, "Only pending applications can be approved");

  // Verification of a living vendor: no new user or vendor account — just mark
  // the application approved and link it, which is exactly what the voucher
  // gate reads (a KYC_APPROVE audit pointing at this vendor).
  if (app.vendor_id) {
    const vendor = await prisma.vendors.findFirst({
      where: { id: app.vendor_id, deleted_at: null },
      select: { id: true, status: true },
    });
    if (!vendor || vendor.status !== "active") {
      throw new AppError(400, "The linked vendor is no longer active, so this verification cannot be approved");
    }
    await prisma.$transaction(async (tx) => {
      const claim = await tx.vendor_kyc_applications.updateMany({
        where: { id, status: "pending" },
        data: {
          status: "approved",
          reviewed_by: reviewerId,
          reviewed_at: new Date(),
          notes: notes?.trim() || null,
          updated_at: new Date(),
        },
      });
      if (claim.count === 0) {
        throw new AppError(409, "This application has already been reviewed");
      }
      await tx.audit_logs.create({
        data: {
          actor_id: reviewerId,
          entity_type: "vendor_kyc_application",
          entity_id: id,
          action: "KYC_APPROVE",
          old_data: { status: "pending" },
          new_data: { status: "approved", notes: notes?.trim() || null, createdVendorId: vendor.id },
        },
      });
    });
    return { verification: true };
  }

  const existingUser = await prisma.users.findFirst({
    where: { email: app.owner_email, deleted_at: null },
  });
  if (existingUser) {
    throw new AppError(409, "A user account already exists with this email. Reject this application and ask the applicant to log in with their existing account.");
  }

  const vendorRole = await prisma.roles.findUnique({ where: { code: "vendor" } });
  if (!vendorRole) throw new AppError(500, "Vendor role not configured");

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 12);

  // Like an admin-created vendor, a KYC vendor starts on the current system
  // default credit limit — snapshotted here, so later default changes only
  // affect later vendors.
  const defaultCreditLimit = await getDefaultCreditLimit();

  await prisma.$transaction(async (tx) => {
    // Atomically claim the application: the WHERE clause only matches (and the
    // update only affects a row) if it's still "pending", closing the race
    // where two concurrent approve/reject requests both pass the earlier
    // status check before either one commits.
    const claim = await tx.vendor_kyc_applications.updateMany({
      where: { id, status: "pending" },
      data: {
        status: "approved",
        reviewed_by: reviewerId,
        reviewed_at: new Date(),
        notes: notes?.trim() || null,
        updated_at: new Date(),
      },
    });
    if (claim.count === 0) {
      throw new AppError(409, "This application has already been reviewed");
    }

    const user = await tx.users.create({
      data: {
        full_name: app.owner_name,
        email: app.owner_email,
        phone: app.owner_contact,
        password_hash: passwordHash,
        status: "active",
        must_change_password: true,
      },
    });

    await tx.user_roles.create({
      data: { user_id: user.id, role_id: vendorRole.id },
    });

    const vendor = await tx.vendors.create({
      data: {
        user_id: user.id,
        client_name: app.owner_name,
        business_name: app.online_business_name,
        phone: app.owner_contact,
        email: app.owner_email,
        address: app.pickup_location,
        pickup_landmark: app.pickup_landmark,
        billing_business_name: app.billing_business_name,
        registration_no: app.registration_no,
        pan_vat_no: app.pan_vat_no,
        citizenship_doc: app.citizenship_doc_front,
        citizenship_doc_back: app.citizenship_doc_back,
        pan_vat_doc: app.pan_vat_doc,
        business_cert_doc: app.business_cert_doc,
        bank_name: app.bank_name,
        bank_account_no: app.bank_account_no,
        bank_account_holder: app.bank_account_holder,
        status: "active",
        joined_at: new Date(),
        credit_limit: defaultCreditLimit,
        // Same default an admin-created vendor gets (see registerVendor in
        // auth.service.ts). Without it this row fell to the schema default of
        // "flat", so vendors who arrived through KYC were priced on a different
        // model from vendors an admin added by hand.
        rate_type: "per_destination",
      },
    });

    await tx.audit_logs.create({
      data: {
        actor_id: reviewerId,
        entity_type: "vendor_kyc_application",
        entity_id: id,
        action: "KYC_APPROVE",
        old_data: { status: "pending" },
        new_data: { status: "approved", notes: notes?.trim() || null, createdVendorId: vendor.id, createdUserId: user.id },
      },
    });
  });

  sendWelcomeEmail({ to: app.owner_email, name: app.owner_name, password: tempPassword })
    .catch((err) => console.error("[kyc] Welcome email failed:", err));
  return { verification: false };
}

export async function rejectKycApplication(
  id: string,
  reviewerId: string,
  rejectionReason: string,
  notes?: string,
) {
  if (!rejectionReason?.trim()) throw new AppError(400, "Rejection reason is required");

  const app = await prisma.vendor_kyc_applications.findUnique({ where: { id } });
  if (!app) throw new AppError(404, "KYC application not found");
  if (app.status !== "pending") throw new AppError(400, "Only pending applications can be rejected");

  await prisma.$transaction(async (tx) => {
    // Atomic compare-and-swap: only updates if still "pending", closing the
    // race with a concurrent approve/reject on the same application.
    const claim = await tx.vendor_kyc_applications.updateMany({
      where: { id, status: "pending" },
      data: {
        status: "rejected",
        reviewed_by: reviewerId,
        reviewed_at: new Date(),
        rejection_reason: rejectionReason.trim(),
        notes: notes?.trim() || null,
        updated_at: new Date(),
      },
    });
    if (claim.count === 0) {
      throw new AppError(409, "This application has already been reviewed");
    }

    await tx.audit_logs.create({
      data: {
        actor_id: reviewerId,
        entity_type: "vendor_kyc_application",
        entity_id: id,
        action: "KYC_REJECT",
        old_data: { status: "pending" },
        new_data: { status: "rejected", rejectionReason: rejectionReason.trim(), notes: notes?.trim() || null },
      },
    });
  });
}

// Deletes a document file on disk given its stored relative path (e.g.
// "uploads/kyc/xyz.jpg"). Returns true if the file is gone afterward -
// including when it was already missing, which we treat as success so a
// half-purged record from a previous run still gets its DB fields cleared.
async function deleteDocumentFile(relativePath: string | null): Promise<boolean> {
  if (!relativePath) return true;
  try {
    await unlink(path.join(process.cwd(), relativePath));
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return true;
    console.error(`[kyc] Failed to delete document file "${relativePath}":`, error);
    return false;
  }
}

const REJECTED_DOCUMENT_RETENTION_DAYS = 30;

// Rejected applicants were never onboarded, so there's no ongoing business or
// compliance reason to keep their citizenship/PAN/business-cert scans once
// the review window has passed. Approved applications become vendors and are
// intentionally excluded - see project memory on document retention.
export async function purgeExpiredRejectedKycDocuments(): Promise<{ checked: number; purged: number }> {
  const cutoff = new Date(Date.now() - REJECTED_DOCUMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const candidates = await prisma.vendor_kyc_applications.findMany({
    where: {
      status: "rejected",
      reviewed_at: { lt: cutoff },
      OR: [
        { citizenship_doc_front: { not: null } },
        { citizenship_doc_back: { not: null } },
        { pan_vat_doc: { not: null } },
        { business_cert_doc: { not: null } },
      ],
    },
    select: { id: true, citizenship_doc_front: true, citizenship_doc_back: true, pan_vat_doc: true, business_cert_doc: true },
  });

  let purged = 0;

  for (const app of candidates) {
    const [citizenshipFrontDeleted, citizenshipBackDeleted, panVatDeleted, businessCertDeleted] = await Promise.all([
      deleteDocumentFile(app.citizenship_doc_front),
      deleteDocumentFile(app.citizenship_doc_back),
      deleteDocumentFile(app.pan_vat_doc),
      deleteDocumentFile(app.business_cert_doc),
    ]);

    const clearedFields: Record<string, null> = {};
    if (app.citizenship_doc_front && citizenshipFrontDeleted) clearedFields.citizenship_doc_front = null;
    if (app.citizenship_doc_back && citizenshipBackDeleted) clearedFields.citizenship_doc_back = null;
    if (app.pan_vat_doc && panVatDeleted) clearedFields.pan_vat_doc = null;
    if (app.business_cert_doc && businessCertDeleted) clearedFields.business_cert_doc = null;
    if (Object.keys(clearedFields).length === 0) continue;

    await prisma.$transaction(async (tx) => {
      await tx.vendor_kyc_applications.update({
        where: { id: app.id },
        data: clearedFields,
      });
      await tx.audit_logs.create({
        data: {
          entity_type: "vendor_kyc_application",
          entity_id: app.id,
          action: "KYC_PURGE_DOCUMENTS",
          new_data: { purgedFields: Object.keys(clearedFields), retentionDays: REJECTED_DOCUMENT_RETENTION_DAYS },
        },
      });
    });
    purged++;
  }

  return { checked: candidates.length, purged };
}

// ── Verification of existing vendors ─────────────────────────────────────────
// Legacy vendors (created by staff, never through an onboarding application)
// have no KYC_APPROVE audit behind them, so gates like voucher claiming refuse
// them. A verification application carries the same review queue and the same
// approval audit — linked to the living vendor instead of creating one.

// Structural Prisma surface this check needs, so both the app client and a
// transaction client satisfy it.
export type KycApprovalDb = {
  audit_logs: { findFirst(args: never): Promise<{ entity_id: string | null } | null> };
  vendor_kyc_applications: { findFirst(args: never): Promise<{ id: string } | null> };
};

export async function vendorHasApprovedKyc(db: KycApprovalDb, vendorId: string): Promise<boolean> {
  // Approval currently links the vendor through the KYC audit record.
  // Do not infer approval from a matching phone or uploaded documents.
  const approval = await db.audit_logs.findFirst({
    where: {
      action: "KYC_APPROVE", entity_type: "vendor_kyc_application",
      new_data: { path: ["createdVendorId"], equals: vendorId },
    },
  } as never);
  if (!approval?.entity_id) return false;
  return !!(await db.vendor_kyc_applications.findFirst({
    where: { id: approval.entity_id, status: "approved" }, select: { id: true },
  } as never));
}

async function activeVendorOrThrow(vendorId: string) {
  const vendor = await prisma.vendors.findFirst({
    where: { id: vendorId, deleted_at: null, status: "active" },
  });
  if (!vendor) throw new AppError(404, "Active vendor not found");
  return vendor;
}

// Prefills a verification application from the vendor's own profile. Every
// NOT NULL application column is covered; a vendor missing the identity
// behind it is told what to fix instead of failing on a blank column.
export interface VendorKycStatus {
  hasApprovedKyc: boolean;
  pendingApplication: { id: string; createdAt: string } | null;
  profile: {
    onlineBusinessName: string; pickupLocation: string; pickupLandmark: string;
    businessContact: string; ownerName: string; ownerEmail: string; ownerContact: string;
    billingBusinessName: string; registeredAddress: string; registrationNo: string; panVatNo: string;
    bankName: string; bankAccountNo: string; bankAccountHolder: string;
  };
  docsOnFile: { citizenship: boolean; panVat: boolean; businessCert: boolean };
}

export async function getVendorKycStatus(vendorId: string): Promise<VendorKycStatus> {
  const vendor = await activeVendorOrThrow(vendorId);
  const [hasApprovedKyc, pending] = await Promise.all([
    vendorHasApprovedKyc(prisma, vendorId),
    prisma.vendor_kyc_applications.findFirst({
      where: { vendor_id: vendorId, status: "pending" },
      select: { id: true, created_at: true },
    }),
  ]);
  const text = (v: string | null | undefined) => v || "";
  return {
    hasApprovedKyc,
    pendingApplication: pending ? { id: pending.id, createdAt: pending.created_at.toISOString() } : null,
    profile: {
      onlineBusinessName: vendor.business_name || vendor.client_name,
      pickupLocation: vendor.address || vendor.pickup_landmark || "",
      pickupLandmark: text(vendor.pickup_landmark),
      businessContact: vendor.phone,
      ownerName: vendor.client_name,
      ownerEmail: vendor.email || "",
      ownerContact: vendor.phone,
      billingBusinessName: text(vendor.billing_business_name),
      registeredAddress: text(vendor.address),
      registrationNo: text(vendor.registration_no),
      panVatNo: text(vendor.pan_vat_no),
      bankName: text(vendor.bank_name),
      bankAccountNo: text(vendor.bank_account_no),
      bankAccountHolder: text(vendor.bank_account_holder),
    },
    docsOnFile: {
      citizenship: !!(vendor.citizenship_doc && vendor.citizenship_doc_back),
      panVat: !!vendor.pan_vat_doc,
      businessCert: !!vendor.business_cert_doc,
    },
  };
}

// Manually filled verification fields, shared by the staff form (every field
// editable) and the vendor self-service form (owner email locked to the
// account — identity is not self-assertable). Empty string means "keep the
// account default".
export interface VerificationFields {
  onlineBusinessName?: string;
  pickupLocation?: string;
  pickupLandmark?: string;
  businessContact?: string;
  ownerName?: string;
  ownerEmail?: string;
  ownerContact?: string;
  billingBusinessName?: string;
  registeredAddress?: string;
  registrationNo?: string;
  panVatNo?: string;
  bankName?: string;
  bankAccountNo?: string;
  bankAccountHolder?: string;
}

export interface VerificationDocs {
  citizenshipDocFrontPath?: string | undefined;
  citizenshipDocBackPath?: string | undefined;
  /** Legacy single-scan upload — maps to front when no front scan is given. */
  citizenshipDocPath?: string | undefined;
  panVatDocPath?: string | undefined;
  businessCertDocPath?: string | undefined;
}

type VendorProfileRow = {
  business_name: string | null; client_name: string; address: string | null;
  pickup_landmark: string | null; phone: string; email: string | null;
  billing_business_name: string | null; registration_no: string | null; pan_vat_no: string | null;
  bank_name: string | null; bank_account_no: string | null; bank_account_holder: string | null;
  citizenship_doc: string | null; citizenship_doc_back: string | null;
  pan_vat_doc: string | null; business_cert_doc: string | null;
};

function verificationPrefill(vendor: VendorProfileRow) {
  return {
    onlineBusinessName: vendor.business_name || vendor.client_name,
    pickupLocation: vendor.address || vendor.pickup_landmark || "",
    pickupLandmark: vendor.pickup_landmark || "",
    businessContact: vendor.phone,
    ownerName: vendor.client_name,
    ownerEmail: vendor.email || "",
    ownerContact: vendor.phone,
    billingBusinessName: vendor.billing_business_name || "",
    registeredAddress: vendor.address || "",
    registrationNo: vendor.registration_no || "",
    panVatNo: vendor.pan_vat_no || "",
    bankName: vendor.bank_name || "",
    bankAccountNo: vendor.bank_account_no || "",
    bankAccountHolder: vendor.bank_account_holder || "",
  };
}

// Merges manually filled fields over the account defaults, then runs the
// same validation as the public application — a verification must be just as
// complete as an onboarding file to be reviewable.
function resolveVerificationFields(
  vendor: VendorProfileRow,
  overrides: VerificationFields,
  docs: VerificationDocs,
  lockOwnerEmail: boolean,
) {
  const base = verificationPrefill(vendor);
  // Multipart text fields always arrive as strings, but never trust the
  // transport — a non-string value falls back instead of crashing on .trim().
  const take = (raw: string | undefined, fallback: string) => {
    const t = typeof raw === "string" ? raw.trim() : "";
    return t ? t : fallback;
  };
  const email = lockOwnerEmail ? base.ownerEmail : take(overrides.ownerEmail, base.ownerEmail);
  if (!email) throw new AppError(400, "This vendor has no email on file — add one to the vendor profile first");
  const pickup = take(overrides.pickupLocation, base.pickupLocation);
  if (!pickup) throw new AppError(400, "Pickup location is required");
  const input: KycApplicationInput = {
    onlineBusinessName: take(overrides.onlineBusinessName, base.onlineBusinessName),
    pickupLocation: pickup,
    pickupLandmark: take(overrides.pickupLandmark, base.pickupLandmark) || undefined,
    businessContact: take(overrides.businessContact, base.businessContact),
    ownerName: take(overrides.ownerName, base.ownerName),
    ownerEmail: email.toLowerCase(),
    ownerContact: take(overrides.ownerContact, base.ownerContact),
    billingBusinessName: take(overrides.billingBusinessName, base.billingBusinessName) || undefined,
    registeredAddress: take(overrides.registeredAddress, base.registeredAddress) || undefined,
    registrationNo: take(overrides.registrationNo, base.registrationNo) || undefined,
    panVatNo: take(overrides.panVatNo, base.panVatNo) || undefined,
    bankName: take(overrides.bankName, base.bankName),
    bankAccountNo: take(overrides.bankAccountNo, base.bankAccountNo),
    bankAccountHolder: take(overrides.bankAccountHolder, base.bankAccountHolder),
    citizenshipDocFrontPath: docs.citizenshipDocFrontPath || docs.citizenshipDocPath || vendor.citizenship_doc || undefined,
    citizenshipDocBackPath: docs.citizenshipDocBackPath || vendor.citizenship_doc_back || undefined,
    panVatDocPath: docs.panVatDocPath || vendor.pan_vat_doc || undefined,
    businessCertDocPath: docs.businessCertDocPath || vendor.business_cert_doc || undefined,
  };
  validateKycInput(input);
  return {
    online_business_name: input.onlineBusinessName.trim(),
    pickup_location: input.pickupLocation.trim(),
    pickup_landmark: input.pickupLandmark?.trim() || null,
    business_contact: input.businessContact.trim(),
    owner_name: input.ownerName.trim(),
    owner_email: input.ownerEmail.trim().toLowerCase(),
    owner_contact: input.ownerContact.trim(),
    billing_business_name: input.billingBusinessName?.trim() || null,
    registered_address: input.registeredAddress?.trim() || null,
    registration_no: input.registrationNo?.trim() || null,
    pan_vat_no: input.panVatNo?.trim() || null,
    citizenship_doc_front: input.citizenshipDocFrontPath || null,
    citizenship_doc_back: input.citizenshipDocBackPath || null,
    pan_vat_doc: input.panVatDocPath || null,
    business_cert_doc: input.businessCertDocPath || null,
    bank_name: input.bankName?.trim() || null,
    bank_account_no: input.bankAccountNo?.trim() || null,
    bank_account_holder: input.bankAccountHolder?.trim() || null,
  };
}

function pendingVerificationConflict(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new AppError(409, "This vendor already has a pending KYC verification");
  }
  throw e;
}

/**
 * Staff start KYC for a vendor from Vendor Management, filling the form by
 * hand: every field arrives from the request and only blanks fall back to
 * the on-file profile and documents. Lands in the normal pending queue —
 * reviewing it works exactly like any other application, and approving
 * verifies the vendor.
 */
export async function startVendorVerification(
  actorId: string,
  vendorId: string,
  fields: VerificationFields = {},
  docs: VerificationDocs = {},
) {
  const vendor = await activeVendorOrThrow(vendorId);
  if (await vendorHasApprovedKyc(prisma, vendorId)) {
    throw new AppError(409, "This vendor is already KYC verified");
  }
  try {
    const app = await prisma.vendor_kyc_applications.create({
      data: {
        ...resolveVerificationFields(vendor, fields, docs, false),
        vendor_id: vendorId,
      },
    });
    await prisma.audit_logs.create({
      data: {
        actor_id: actorId,
        entity_type: "vendor_kyc_application",
        entity_id: app.id,
        action: "KYC_STARTED",
        new_data: { vendorId },
      },
    });
    return {
      id: app.id, status: app.status,
      vendorId, vendorName: vendor.business_name || vendor.client_name,
      createdAt: app.created_at.toISOString(),
    };
  } catch (e) {
    pendingVerificationConflict(e);
  }
}

/**
 * A vendor verifies itself: the form arrives filled by hand, the owner email
 * stays locked to the account, and a citizenship scan is required unless one
 * is already on file (reused then).
 */
export async function submitVendorVerification(
  actor: { id: string },
  vendorId: string,
  fields: VerificationFields = {},
  docs: VerificationDocs = {},
) {
  const vendor = await activeVendorOrThrow(vendorId);
  if (await vendorHasApprovedKyc(prisma, vendorId)) {
    throw new AppError(409, "This vendor is already KYC verified");
  }
  try {
    const app = await prisma.vendor_kyc_applications.create({
      data: {
        ...resolveVerificationFields(vendor, fields, docs, true),
        vendor_id: vendorId,
      },
    });
    await prisma.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "vendor_kyc_application",
        entity_id: app.id,
        action: "KYC_SUBMIT",
        new_data: { vendorId },
      },
    });
    return { id: app.id };
  } catch (e) {
    pendingVerificationConflict(e);
  }
}
