import { Request, Response } from "express";
import {
  getBillingSettings,
  getVendorBillingStatus,
  listVendorBalances,
  updateBillingSettings,
} from "../services/billing.service";
import { vendor_billing_state } from "../generated/prisma/enums";
import {
  listVendorPayments,
  reviewVendorPayment,
  submitVendorPayment,
  VendorPaymentStatusFilter,
} from "../services/vendor-payment.service";
import { resolveOwnVendorId } from "../services/vendor-scope.service";
import { flattenMulterFiles, secureUploadedFiles } from "../lib/secureUploadedFiles";
import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_PAYMENT_STATUSES: VendorPaymentStatusFilter[] = ["pending", "verified", "rejected"];

const isStaff = (roles: string[]) => roles.some((r) => ["super_admin", "admin"].includes(r));

function fail(res: Response, error: any, fallback: string) {
  return res.status(error?.statusCode || 500).json({
    success: false,
    message: error?.message || fallback,
    ...(error?.code ? { code: error.code } : {}),
  });
}

// Staff may look at any vendor by id; a vendor account is always pinned to its
// own record regardless of what it asks for.
async function resolveTargetVendorId(req: Request): Promise<string> {
  const roles = req.user!.roles;
  if (isStaff(roles)) {
    const raw = req.query.vendorId;
    if (typeof raw !== "string" || !UUID_REGEX.test(raw)) {
      throw new AppError(400, "vendorId is required and must be a valid UUID");
    }
    return raw;
  }

  const ownVendorId = await resolveOwnVendorId({ id: req.user!.id, roles });
  if (!ownVendorId) throw new AppError(403, "No vendor account for this user");
  return ownVendorId;
}

// GET /api/billing/status — balance, thresholds, and current state
export async function getBillingStatusController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const vendorId = await resolveTargetVendorId(req);
    const [status, settings] = await Promise.all([
      getVendorBillingStatus(vendorId),
      getBillingSettings(),
    ]);

    return res.status(200).json({
      success: true,
      data: { ...status, paymentQrPath: settings.paymentQrPath, paymentNote: settings.paymentNote },
    });
  } catch (error: any) {
    return fail(res, error, "Failed to load billing status");
  }
}

// GET /api/billing/settings — global thresholds + QR (admin)
export async function getBillingSettingsController(_req: Request, res: Response) {
  try {
    const settings = await getBillingSettings();
    return res.status(200).json({ success: true, data: settings });
  } catch (error: any) {
    return fail(res, error, "Failed to load billing settings");
  }
}

// PATCH /api/billing/settings — thresholds (admin)
export async function updateBillingSettingsController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const settings = await updateBillingSettings(req.user.id, {
      warnThreshold: req.body.warnThreshold,
      blockThreshold: req.body.blockThreshold,
      paymentNote: req.body.paymentNote,
    });
    return res.status(200).json({ success: true, data: settings });
  } catch (error: any) {
    return fail(res, error, "Failed to update billing settings");
  }
}

// POST /api/billing/settings/qr — replace the Fonepay QR shown to vendors (admin)
export async function uploadPaymentQrController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const qr = files?.qr?.[0];
    if (!qr) return res.status(400).json({ success: false, message: "A QR image is required" });

    await secureUploadedFiles(flattenMulterFiles(files));

    const settings = await updateBillingSettings(req.user.id, {
      paymentQrPath: `uploads/billing/${qr.filename}`,
    });
    return res.status(200).json({ success: true, data: settings });
  } catch (error: any) {
    return fail(res, error, "Failed to upload payment QR");
  }
}

// POST /api/billing/payments — vendor submits a payment claim
export async function submitVendorPaymentController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const proof = files?.proof?.[0];
    if (proof) await secureUploadedFiles(flattenMulterFiles(files));

    // multipart bodies arrive as strings.
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "amount must be greater than zero" });
    }

    const payment = await submitVendorPayment(
      { id: req.user.id, roles: req.user.roles },
      {
        amount,
        reference: req.body.reference,
        note: req.body.note,
        method: req.body.method,
        proofPath: proof ? `uploads/billing/${proof.filename}` : null,
      },
    );

    return res.status(201).json({
      success: true,
      message: "Payment submitted. It will be credited once our team verifies it.",
      data: payment,
    });
  } catch (error: any) {
    return fail(res, error, "Failed to submit payment");
  }
}

// GET /api/billing/payments — claim history (vendor) / review queue (admin)
export async function listVendorPaymentsController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    let status: VendorPaymentStatusFilter | undefined;
    if (req.query.status !== undefined) {
      if (
        typeof req.query.status !== "string" ||
        !VALID_PAYMENT_STATUSES.includes(req.query.status as VendorPaymentStatusFilter)
      ) {
        return res.status(400).json({
          success: false,
          message: `status must be one of: ${VALID_PAYMENT_STATUSES.join(", ")}`,
        });
      }
      status = req.query.status as VendorPaymentStatusFilter;
    }

    let vendorId: string | undefined;
    if (req.query.vendorId !== undefined) {
      if (typeof req.query.vendorId !== "string" || !UUID_REGEX.test(req.query.vendorId)) {
        return res.status(400).json({ success: false, message: "vendorId must be a valid UUID" });
      }
      vendorId = req.query.vendorId;
    }

    const page = req.query.page !== undefined ? Number(req.query.page) : undefined;
    const pageSize = req.query.pageSize !== undefined ? Number(req.query.pageSize) : undefined;

    const result = await listVendorPayments(
      { id: req.user.id, roles: req.user.roles },
      {
        ...(vendorId ? { vendorId } : {}),
        ...(status ? { status } : {}),
        ...(page !== undefined ? { page } : {}),
        ...(pageSize !== undefined ? { pageSize } : {}),
      },
    );
    return res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    return fail(res, error, "Failed to load payments");
  }
}

// PATCH /api/billing/payments/:id/review — admin verifies or rejects a claim
export async function reviewVendorPaymentController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { id } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid payment id" });
    }

    const decision = req.body.decision;
    if (decision !== "verified" && decision !== "rejected") {
      return res.status(400).json({ success: false, message: "decision must be 'verified' or 'rejected'" });
    }

    const payment = await reviewVendorPayment(
      { id: req.user.id, roles: req.user.roles },
      id,
      decision,
      req.body.remark,
    );
    return res.status(200).json({ success: true, data: payment });
  } catch (error: any) {
    return fail(res, error, "Failed to review payment");
  }
}

// GET /api/billing/vendors — every vendor's balance and state (admin).
// Doubles as the pre-deploy rollout report: it shows exactly who would be
// blocked before enforcement is switched on.
export async function listVendorBalancesController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const stateFilter = typeof req.query.state === "string" ? req.query.state : undefined;
    if (stateFilter && !["ok", "warned", "blocked"].includes(stateFilter)) {
      return res.status(400).json({ success: false, message: "state must be ok, warned, or blocked" });
    }

    const rows = await listVendorBalances(stateFilter as vendor_billing_state | undefined);
    return res.status(200).json({ success: true, data: rows });
  } catch (error: any) {
    return fail(res, error, "Failed to load vendor balances");
  }
}
