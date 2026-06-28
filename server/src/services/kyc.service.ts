import prisma from "../lib/prisma";
import bcrypt from "bcrypt";
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

function validateKycInput(input: KycApplicationInput) {
  if (!input.onlineBusinessName?.trim()) throw new AppError(400, "Online business name is required");
  if (!input.pickupLocation?.trim()) throw new AppError(400, "Pickup location is required");
  if (!input.businessContact?.trim()) throw new AppError(400, "Business contact number is required");
  if (!input.ownerName?.trim()) throw new AppError(400, "Owner name is required");
  if (!input.ownerEmail?.trim()) throw new AppError(400, "Owner email is required");
  if (!input.ownerContact?.trim()) throw new AppError(400, "Owner contact number is required");
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

  return prisma.vendor_kyc_applications.create({
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
}

export async function listKycApplications(status?: string) {
  const where = status && ["pending", "approved", "rejected"].includes(status)
    ? { status: status as "pending" | "approved" | "rejected" }
    : {};

  const apps = await prisma.vendor_kyc_applications.findMany({
    where,
    orderBy: { created_at: "desc" },
  });

  return apps.map((app, index) => ({
    id: app.id,
    sn: index + 1,
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
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
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

    await tx.vendors.create({
      data: {
        user_id: user.id,
        client_name: app.owner_name,
        business_name: app.online_business_name,
        phone: app.owner_contact,
        email: app.owner_email,
        address: app.pickup_location,
        status: "active",
        joined_at: new Date(),
      },
    });

    await tx.vendor_kyc_applications.update({
      where: { id },
      data: {
        status: "approved",
        reviewed_by: reviewerId,
        reviewed_at: new Date(),
        notes: notes?.trim() || null,
        updated_at: new Date(),
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

  await prisma.vendor_kyc_applications.update({
    where: { id },
    data: {
      status: "rejected",
      reviewed_by: reviewerId,
      reviewed_at: new Date(),
      rejection_reason: rejectionReason.trim(),
      notes: notes?.trim() || null,
      updated_at: new Date(),
    },
  });
}
