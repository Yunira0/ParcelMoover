import { Request, Response } from "express";
import { z } from "zod";
import {
  approveKycApplication,
  getKycApplication,
  getVendorKycStatus,
  listKycApplications,
  rejectKycApplication,
  startVendorVerification,
  submitKycApplication,
  submitVendorVerification,
  type VerificationFields,
} from "../services/kyc.service";
import { resolveOwnVendorId } from "../services/vendor-scope.service";
import { AppError } from "../utils/AppError";
import { flattenMulterFiles, secureUploadedFiles } from "../lib/secureUploadedFiles";

export const submitKycController = async (req: Request, res: Response) => {
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    await secureUploadedFiles(flattenMulterFiles(files));

    const docPath = (f?: Express.Multer.File) =>
      f?.filename ? `uploads/kyc/${f.filename}` : undefined;

    const app = await submitKycApplication({
      onlineBusinessName: req.body.onlineBusinessName,
      pickupLocation: req.body.pickupLocation,
      pickupLandmark: req.body.pickupLandmark,
      businessContact: req.body.businessContact,
      ownerName: req.body.ownerName,
      ownerEmail: req.body.ownerEmail,
      ownerContact: req.body.ownerContact,
      billingBusinessName: req.body.billingBusinessName,
      registeredAddress: req.body.registeredAddress,
      registrationNo: req.body.registrationNo,
      panVatNo: req.body.panVatNo,
      bankName: req.body.bankName,
      bankAccountNo: req.body.bankAccountNo,
      bankAccountHolder: req.body.bankAccountHolder,
      citizenshipDocFrontPath: docPath(files?.citizenshipDocFront?.[0]),
      citizenshipDocBackPath: docPath(files?.citizenshipDocBack?.[0]),
      panVatDocPath: docPath(files?.panVatDoc?.[0]),
      businessCertDocPath: docPath(files?.businessCertDoc?.[0]),
    });

    return res.status(201).json({
      success: true,
      message: "KYC application submitted successfully. We will review it and get back to you.",
      data: { id: app.id },
    });
  } catch (error: any) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to submit KYC application",
    });
  }
};

export const listKycController = async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const page = Number.isFinite(Number(req.query.page)) ? Number(req.query.page) : undefined;
    const pageSize = Number.isFinite(Number(req.query.pageSize)) ? Number(req.query.pageSize) : undefined;
    const { data, meta } = await listKycApplications(status, page, pageSize);
    return res.status(200).json({ success: true, data, meta });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch KYC applications",
    });
  }
};

export const getKycController = async (req: Request, res: Response) => {
  try {
    const app = await getKycApplication(req.params.id as string);
    return res.status(200).json({ success: true, data: app });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch KYC application",
    });
  }
};

export const approveKycController = async (req: Request, res: Response) => {
  try {
    const result = await approveKycApplication(req.params.id as string, req.user!.id, req.body.notes);
    return res.status(200).json({
      success: true,
      message: result?.verification
        ? "KYC application approved and vendor verified"
        : "KYC application approved and vendor account created",
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to approve KYC application",
    });
  }
};

export const rejectKycController = async (req: Request, res: Response) => {
  try {
    const { rejectionReason, notes } = req.body;
    await rejectKycApplication(req.params.id as string, req.user!.id, rejectionReason, notes);
    return res.status(200).json({ success: true, message: "KYC application rejected" });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to reject KYC application",
    });
  }
};

// POST /api/kyc/applications/start — staff start verification for an existing
// vendor, filling the form by hand. Multipart: text fields plus optional
// document scans; blanks fall back to the on-file profile and documents.
export const startKycVerificationController = async (req: Request, res: Response) => {
  try {
    const { vendorId } = z.object({ vendorId: z.uuid() }).parse(req.body);
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    await secureUploadedFiles(flattenMulterFiles(files));
    const docPath = (f?: Express.Multer.File) =>
      f?.filename ? `uploads/kyc/${f.filename}` : undefined;
    const data = await startVendorVerification(req.user!.id, vendorId, verificationFieldsFromBody(req.body), {
      citizenshipDocFrontPath: docPath(files?.citizenshipDocFront?.[0]) || docPath(files?.citizenshipDoc?.[0]),
      citizenshipDocBackPath: docPath(files?.citizenshipDocBack?.[0]),
      panVatDocPath: docPath(files?.panVatDoc?.[0]),
      businessCertDocPath: docPath(files?.businessCertDoc?.[0]),
    });
    return res.status(201).json({
      success: true,
      message: `KYC verification started for ${data.vendorName}. Review it under KYC Applications.`,
      data,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to start KYC verification",
    });
  }
};

const VERIFICATION_TEXT_FIELDS = [
  "onlineBusinessName", "pickupLocation", "pickupLandmark", "businessContact",
  "ownerName", "ownerEmail", "ownerContact", "billingBusinessName",
  "registeredAddress", "registrationNo", "panVatNo",
  "bankName", "bankAccountNo", "bankAccountHolder",
] as const;

// Picks the manually filled fields out of a multipart body. Everything is
// optional — blanks keep the account default (the service decides).
function verificationFieldsFromBody(body: unknown): VerificationFields {
  const fields: VerificationFields = {};
  if (body && typeof body === "object") {
    for (const key of VERIFICATION_TEXT_FIELDS) {
      const value = (body as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) {
        (fields as Record<string, string>)[key] = value;
      }
    }
  }
  return fields;
}

function ownVendorOr403(req: Request): Promise<string> {
  return resolveOwnVendorId({ id: req.user!.id, roles: req.user!.roles }).then((vendorId) => {
    if (!vendorId) throw new AppError(403, "Only a vendor account can verify KYC");
    return vendorId;
  });
}

// POST /api/kyc/my-application — a vendor verifies itself, filling the form
// by hand. Owner email stays locked to the account; the rest is editable.
export const submitMyKycController = async (req: Request, res: Response) => {
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    await secureUploadedFiles(flattenMulterFiles(files));
    const docPath = (f?: Express.Multer.File) =>
      f?.filename ? `uploads/kyc/${f.filename}` : undefined;
    const vendorId = await ownVendorOr403(req);
    const data = await submitVendorVerification({ id: req.user!.id }, vendorId,
      verificationFieldsFromBody(req.body), {
        citizenshipDocFrontPath: docPath(files?.citizenshipDocFront?.[0]) || docPath(files?.citizenshipDoc?.[0]),
        citizenshipDocBackPath: docPath(files?.citizenshipDocBack?.[0]),
        panVatDocPath: docPath(files?.panVatDoc?.[0]),
        businessCertDocPath: docPath(files?.businessCertDoc?.[0]),
      });
    return res.status(201).json({
      success: true,
      message: "KYC verification submitted. We will review it and unlock vouchers once approved.",
      data,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to submit KYC verification",
    });
  }
};

// GET /api/kyc/my-status — whether this vendor can claim vouchers yet, plus
// the prefill for the verification form.
export const myKycStatusController = async (req: Request, res: Response) => {
  try {
    const vendorId = await ownVendorOr403(req);
    return res.status(200).json({ success: true, data: await getVendorKycStatus(vendorId) });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load KYC status",
    });
  }
};

// GET /api/kyc/verification-prefill?vendorId= — staff prefill for the manual
// start form. Same shape as the vendor's own status.
export const verificationPrefillController = async (req: Request, res: Response) => {
  try {
    const { vendorId } = z.object({ vendorId: z.uuid() }).parse(req.query);
    return res.status(200).json({ success: true, data: await getVendorKycStatus(vendorId) });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load vendor KYC prefill",
    });
  }
};
