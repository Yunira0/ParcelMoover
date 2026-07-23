import prisma from "../lib/prisma";
import bcrypt from "bcrypt";
import { randomInt } from "crypto";
import path from "path";
import { unlink } from "fs/promises";
import { AppError } from "../utils/AppError";
import { sendWelcomeEmail } from "../lib/mailer";

export interface KycApplicationInput {
  // Business Details
  onlineBusinessName: string;
  pickupLocation: string;
  pickupLandmark?: string;
  businessContact: string;

  // Owner / Contact Person
  ownerName: string;
  ownerEmail: string;
  ownerContact: string;

  // Billing Details
  billingBusinessName?: string;
  registeredAddress?: string;
  registrationNo?: string;
  panVatNo?: string;

  // Bank Details
  bankName?: string;
  bankAccountNo?: string;
  bankAccountHolder?: string;

  // Document file paths (set by controller after multer processes files)
  citizenshipDocPath?: string | undefined;
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
function validateKycInput(input: KycApplicationInput) {
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

  // Citizenship and PAN/VAT scans are mandatory to verify against; the business
  // certificate stays optional.
  if (!input.citizenshipDocPath) throw new AppError(400, "Citizenship document is required");
  if (!input.panVatDocPath) throw new AppError(400, "PAN/VAT document is required");

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
        citizenship_doc: data.citizenshipDocPath || null,
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
            citizenshipDoc: !!app.citizenship_doc,
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
const MAX_PAGE_SIZE = 100;

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

  const data = apps.map((app, index) => ({
    id: app.id,
    sn: skip + index + 1,
    status: app.status,
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
    citizenshipDoc: app.citizenship_doc,
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
        citizenship_doc: app.citizenship_doc,
        pan_vat_doc: app.pan_vat_doc,
        business_cert_doc: app.business_cert_doc,
        bank_name: app.bank_name,
        bank_account_no: app.bank_account_no,
        bank_account_holder: app.bank_account_holder,
        status: "active",
        joined_at: new Date(),
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
        { citizenship_doc: { not: null } },
        { pan_vat_doc: { not: null } },
        { business_cert_doc: { not: null } },
      ],
    },
    select: { id: true, citizenship_doc: true, pan_vat_doc: true, business_cert_doc: true },
  });

  let purged = 0;

  for (const app of candidates) {
    const [citizenshipDeleted, panVatDeleted, businessCertDeleted] = await Promise.all([
      deleteDocumentFile(app.citizenship_doc),
      deleteDocumentFile(app.pan_vat_doc),
      deleteDocumentFile(app.business_cert_doc),
    ]);

    const clearedFields: Record<string, null> = {};
    if (app.citizenship_doc && citizenshipDeleted) clearedFields.citizenship_doc = null;
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
