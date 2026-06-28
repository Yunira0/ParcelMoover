import { Request, Response } from "express";
import {
  approveKycApplication,
  getKycApplication,
  listKycApplications,
  rejectKycApplication,
  submitKycApplication,
} from "../services/kyc.service";
import { AppError } from "../utils/AppError";

export const submitKycController = async (req: Request, res: Response) => {
  try {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
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
      citizenshipDocPath: docPath(files?.citizenshipDoc?.[0]),
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
    const roles = req.user?.roles ?? [];
    if (!roles.includes("super_admin")) {
      throw new AppError(403, "Forbidden");
    }

    const status = req.query.status as string | undefined;
    const apps = await listKycApplications(status);
    return res.status(200).json({ success: true, data: apps });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to fetch KYC applications",
    });
  }
};

export const getKycController = async (req: Request, res: Response) => {
  try {
    const roles = req.user?.roles ?? [];
    if (!roles.includes("super_admin")) {
      throw new AppError(403, "Forbidden");
    }

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
    const roles = req.user?.roles ?? [];
    if (!roles.includes("super_admin")) {
      throw new AppError(403, "Only super admins can approve KYC applications");
    }

    await approveKycApplication(req.params.id as string, req.user!.id, req.body.notes);
    return res.status(200).json({ success: true, message: "KYC application approved and vendor account created" });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to approve KYC application",
    });
  }
};

export const rejectKycController = async (req: Request, res: Response) => {
  try {
    const roles = req.user?.roles ?? [];
    if (!roles.includes("super_admin")) {
      throw new AppError(403, "Only super admins can reject KYC applications");
    }

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
