import { Request, Response } from "express";
import { getBillingSettings, getVendorBillingStatus } from "../../services/billing.service";
import {
  listVendorPayments,
  submitVendorPayment,
  VendorPaymentItem,
} from "../../services/vendor-payment.service";
import { withIdempotency } from "../../services/idempotency.service";
import { flattenMulterFiles, secureUploadedFiles } from "../../lib/secureUploadedFiles";
import { sendEncryptedFile } from "../../lib/serveEncryptedDocument";
import { PublicVendorPaymentsQuery } from "../../validators/publicApi.schema";
import { actorFrom, sendError, UUID_REGEX } from "./shared";

// Read-only mirrors of the vendor dashboard's Billing & Payments views, plus
// the one write a vendor can make there: filing a payment claim. As everywhere
// else on /api/v1, the API key's own vendor is the scope — vendorId is never
// accepted as a param, and the services below pin a vendor actor to its own
// record regardless of what it asks for.

// Stored upload paths (proof_path, payment_qr_path) resolve under the
// admin-only /uploads mount, so they are useless to a key holder and are
// stripped from public responses. GET /billing/qr is the supported way to
// fetch the QR; whether a claim carried proof is exposed as a boolean.
function toPublicPayment(payment: VendorPaymentItem) {
  const { proofPath, ...rest } = payment;
  return { ...rest, hasProof: Boolean(proofPath) };
}

export async function publicGetBillingStatusController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const [status, settings] = await Promise.all([
      getVendorBillingStatus(req.apiKey.vendorId),
      getBillingSettings(),
    ]);

    return res.status(200).json({
      success: true,
      data: { ...status, paymentNote: settings.paymentNote },
    });
  } catch (error: any) {
    return sendError(res, error, "Failed to load billing status");
  }
}

export async function publicListVendorPaymentsController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const query = req.query as unknown as PublicVendorPaymentsQuery;
    const result = await listVendorPayments(actorFrom(req), {
      ...(query.status ? { status: query.status } : {}),
      ...(query.page ? { page: query.page } : {}),
      ...(query.pageSize ? { pageSize: query.pageSize } : {}),
    });

    return res.status(200).json({
      success: true,
      data: result.data.map(toPublicPayment),
      meta: result.meta,
    });
  } catch (error: any) {
    return sendError(res, error, "Failed to load payments");
  }
}

export async function publicSubmitVendorPaymentController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey) {
      return res.status(400).json({
        success: false,
        message: "Idempotency-Key header is required",
      });
    }
    if (!UUID_REGEX.test(idempotencyKey)) {
      return res.status(400).json({
        success: false,
        message: "Idempotency-Key must be a valid UUID",
      });
    }

    // Multipart bodies arrive as strings, so validation happens here rather
    // than in a validate() schema — the body doesn't exist until multer runs.
    const amount = Number(req.body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "amount must be greater than zero" });
    }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const proof = files?.proof?.[0];
    if (proof) await secureUploadedFiles(flattenMulterFiles(files));

    const responseBody = await withIdempotency(
      `billing-payment:${idempotencyKey}`,
      req.body,
      async () => {
        const payment = await submitVendorPayment(actorFrom(req), {
          amount,
          reference: req.body.reference,
          note: req.body.note,
          method: req.body.method,
          proofPath: proof ? `uploads/billing/${proof.filename}` : null,
        });

        const body = {
          success: true,
          message: "Payment submitted. It will be credited once our team verifies it.",
          data: toPublicPayment(payment),
        };

        return { result: body, response: { statusCode: 201, body, resourceID: payment.id } };
      },
    );

    return res.status(201).json(responseBody);
  } catch (error: any) {
    return sendError(res, error, "Failed to submit payment");
  }
}

export async function publicGetPaymentQrFileController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const settings = await getBillingSettings();
    if (!settings.paymentQrPath) {
      return res.status(404).json({ success: false, message: "No payment QR configured" });
    }

    return await sendEncryptedFile(res, settings.paymentQrPath);
  } catch (error: any) {
    return sendError(res, error, "Failed to load payment QR");
  }
}
