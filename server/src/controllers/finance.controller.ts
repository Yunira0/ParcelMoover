import { Request, Response } from "express";
import { getPendingCodBill, listOrderCod, listSettlements, getUnsettledOrders, createSettlement, payForSettlement, attachSettlementDocuments, deleteSettlementDocument, updateSettlement, revertSettlement, cancelSettlement, getSettlementDetail, getSettlementDocumentPath } from "../services/finance.service";
import { CodPaymentFilter, CreateSettlementInput, PaySettlementInput, UpdateSettlementInput, RevertSettlementInput, CancelSettlementInput } from "../types/finance.type";
import { flattenMulterFiles, secureUploadedFiles } from "../lib/secureUploadedFiles";
import { sendEncryptedFile } from "../lib/serveEncryptedDocument";
import prisma from "../lib/prisma";

// General UUID shape — not strict about RFC-4122 version/variant nibbles, so
// seeded/demo ids (e.g. 55555555-0000-0000-0000-000000000002) are accepted.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Multer gives one array per field (several receipts can be uploaded at once);
// read `filename` only after secureUploadedFiles has run, since it rewrites the
// name when a large image is recompressed to JPEG.
const toUploadPaths = (files: Express.Multer.File[] | undefined): string[] =>
  (files ?? []).map((file) => `uploads/settlements/${file.filename}`);

function parseVendorIdParam(req: Request): { error?: string; vendorId?: string } {
  const raw = req.query.vendorId;
  if (raw === undefined) return {};
  if (typeof raw !== "string" || !UUID_REGEX.test(raw)) {
    return { error: "vendorId must be a valid UUID" };
  }
  return { vendorId: raw };
}

function parsePagination(req: Request): {
  error?: string;
  page?: number | undefined;
  pageSize?: number | undefined;
} {
  let page: number | undefined;
  let pageSize: number | undefined;

  if (req.query.page !== undefined) {
    page = Number(req.query.page);
    if (!Number.isInteger(page) || page < 1) {
      return { error: "page must be a positive integer" };
    }
  }
  if (req.query.pageSize !== undefined) {
    pageSize = Number(req.query.pageSize);
    if (!Number.isInteger(pageSize) || pageSize < 1) {
      return { error: "pageSize must be a positive integer" };
    }
  }

  return { page, pageSize };
}

export async function getPendingCodController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { error, vendorId } = parseVendorIdParam(req);
    if (error) {
      return res.status(400).json({ success: false, message: error });
    }

    const bill = await getPendingCodBill({ id: req.user.id, roles: req.user.roles }, vendorId);
    return res.status(200).json({ success: true, data: bill });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load pending COD",
    });
  }
}

const VALID_COD_STATUS_FILTERS: CodPaymentFilter[] = ["settled", "not_settled"];

export async function listOrderCodController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { error: vendorError, vendorId } = parseVendorIdParam(req);
    if (vendorError) {
      return res.status(400).json({ success: false, message: vendorError });
    }

    const { error: pageError, page, pageSize } = parsePagination(req);
    if (pageError) {
      return res.status(400).json({ success: false, message: pageError });
    }

    let status: CodPaymentFilter | undefined;
    if (req.query.status !== undefined) {
      if (typeof req.query.status !== "string" || !VALID_COD_STATUS_FILTERS.includes(req.query.status as CodPaymentFilter)) {
        return res.status(400).json({
          success: false,
          message: `status must be one of: ${VALID_COD_STATUS_FILTERS.join(", ")}`,
        });
      }
      status = req.query.status as CodPaymentFilter;
    }

    const result = await listOrderCod(
      { id: req.user.id, roles: req.user.roles },
      vendorId,
      status,
      page,
      pageSize,
    );
    return res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load order COD payments",
    });
  }
}

function parseDateParam(raw: unknown, label: string): { error?: string; date?: Date } {
  if (raw === undefined) return {};
  if (typeof raw !== "string") {
    return { error: `${label} must be a date string` };
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return { error: `${label} must be a valid date` };
  }
  return { date };
}

const VALID_PAYEE_TYPES = ["rider", "vendor"];
const VALID_SETTLEMENT_STATUSES = ["pending", "settled", "cancelled"];

export async function listSettlementsController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const payeeType = req.query.payeeType;
    if (typeof payeeType !== "string" || !VALID_PAYEE_TYPES.includes(payeeType)) {
      return res.status(400).json({
        success: false,
        message: `payeeType must be one of: ${VALID_PAYEE_TYPES.join(", ")}`,
      });
    }

    const targetId = req.query.targetId;
    if (targetId !== undefined && (typeof targetId !== "string" || !UUID_REGEX.test(targetId))) {
      return res.status(400).json({ success: false, message: "targetId must be a valid UUID" });
    }

    const { error: pageError, page, pageSize } = parsePagination(req);
    if (pageError) {
      return res.status(400).json({ success: false, message: pageError });
    }

    const { error: fromError, date: fromDate } = parseDateParam(req.query.fromDate, "fromDate");
    if (fromError) {
      return res.status(400).json({ success: false, message: fromError });
    }
    const { error: toError, date: toDate } = parseDateParam(req.query.toDate, "toDate");
    if (toError) {
      return res.status(400).json({ success: false, message: toError });
    }
    if (fromDate && toDate && fromDate > toDate) {
      return res.status(400).json({ success: false, message: "fromDate must be before toDate" });
    }

    const status = req.query.status;
    if (status !== undefined && (typeof status !== "string" || !VALID_SETTLEMENT_STATUSES.includes(status))) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${VALID_SETTLEMENT_STATUSES.join(", ")}`,
      });
    }

    const search = req.query.search;
    if (search !== undefined && typeof search !== "string") {
      return res.status(400).json({ success: false, message: "search must be a string" });
    }
    const trimmedSearch = search?.trim();

    const result = await listSettlements(
      { id: req.user.id, roles: req.user.roles },
      payeeType as "rider" | "vendor",
      targetId as string | undefined,
      page,
      pageSize,
      fromDate,
      toDate,
      status as "pending" | "settled" | "cancelled" | undefined,
      trimmedSearch || undefined,
    );
    return res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load settlements",
    });
  }
}

export async function createSettlementController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const input = req.body as CreateSettlementInput;
    const settlement = await createSettlement({ id: req.user.id, roles: req.user.roles }, input);

    return res.status(201).json({ success: true, message: "Settlement created", data: settlement });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create settlement",
    });
  }
}

export async function payForSettlementController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid settlement id" });
    }

    // Encrypt/verify before reading filename: secureUploadedFiles rewrites it
    // when a large image is recompressed to JPEG, and the stored path must
    // match the file that actually ends up on disk.
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const uploads = flattenMulterFiles(files);
    if (uploads.length > 0) await secureUploadedFiles(uploads);

    const input: PaySettlementInput = {
      ...(req.body as PaySettlementInput),
      paymentReceiptPaths: toUploadPaths(files?.paymentReceipt),
      taxInvoicePaths: toUploadPaths(files?.taxInvoice),
    };
    const settlement = await payForSettlement({ id: req.user.id, roles: req.user.roles }, id, input);

    return res.status(200).json({
      success: true,
      message: settlement.status === "settled" ? "Payment recorded" : "Part payment recorded",
      data: settlement,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to record payment",
    });
  }
}

// PATCH /api/finance/settlements/:id/documents — attach payment proof to a
// statement with a payment recorded, as a follow-up step after
// payForSettlementController. Every file becomes another document; pass
// `replaceDocumentId` to swap one out instead, and `paymentId` to say which
// instalment the proof belongs to.
export async function attachSettlementDocumentsController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid settlement id" });
    }

    // Multipart, so these arrive as form fields alongside the files rather
    // than in a JSON body a validator could reach.
    const { paymentId, replaceDocumentId } = req.body as {
      paymentId?: string;
      replaceDocumentId?: string;
    };
    if (paymentId !== undefined && (typeof paymentId !== "string" || !UUID_REGEX.test(paymentId))) {
      return res.status(400).json({ success: false, message: "Invalid payment id" });
    }
    if (
      replaceDocumentId !== undefined &&
      (typeof replaceDocumentId !== "string" || !UUID_REGEX.test(replaceDocumentId))
    ) {
      return res.status(400).json({ success: false, message: "Invalid document id" });
    }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const uploads = flattenMulterFiles(files);
    if (uploads.length === 0) {
      return res.status(400).json({ success: false, message: "At least one document is required" });
    }
    await secureUploadedFiles(uploads);

    const settlement = await attachSettlementDocuments({ id: req.user.id, roles: req.user.roles }, id, {
      paymentReceiptPaths: toUploadPaths(files?.paymentReceipt),
      taxInvoicePaths: toUploadPaths(files?.taxInvoice),
      ...(paymentId ? { paymentId } : {}),
      ...(replaceDocumentId ? { replaceDocumentId } : {}),
    });

    return res.status(200).json({ success: true, message: "Documents attached", data: settlement });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to attach documents",
    });
  }
}

// DELETE /api/finance/settlements/:id/documents/:documentId — remove one proof
// from a statement that holds several.
export async function deleteSettlementDocumentController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id, documentId } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid settlement id" });
    }
    if (typeof documentId !== "string" || !UUID_REGEX.test(documentId)) {
      return res.status(400).json({ success: false, message: "Invalid document id" });
    }

    const result = await deleteSettlementDocument({ id: req.user.id, roles: req.user.roles }, id, documentId);

    return res.status(200).json({ success: true, message: "Document removed", data: result });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to remove document",
    });
  }
}

// GET /api/finance/settlements/:id/documents/:doc — streams one payment proof
// to anyone entitled to the statement itself. The /uploads mount is admin-only,
// so this is how a vendor (or their sales rep) reaches their own paperwork
// without widening access to every uploaded file.
//
// `:doc` is a document id, since a statement can now hold several receipts;
// "receipt" / "tax-invoice" still resolve to the newest of that kind so links
// written before that keep working.
export async function getSettlementDocumentController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id, doc } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid settlement id" });
    }
    if (typeof doc !== "string" || (doc !== "receipt" && doc !== "tax-invoice" && !UUID_REGEX.test(doc))) {
      return res.status(400).json({ success: false, message: "Unknown document" });
    }

    const storedPath = await getSettlementDocumentPath(
      { id: req.user.id, roles: req.user.roles },
      id,
      doc,
    );

    // Mirrors the audit entry the /uploads mount writes for staff views.
    prisma.audit_logs
      .create({
        data: {
          actor_id: req.user.id,
          entity_type: "document",
          entity_id: id,
          action: "VIEW_DOCUMENT",
          new_data: { settlementId: id, document: doc },
          ip_address: req.ip || null,
          user_agent: req.get("user-agent") || null,
        },
      })
      .catch((err) => console.error("[audit] Failed to log document view:", err));

    return await sendEncryptedFile(res, storedPath);
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load document",
    });
  }
}

export async function updateSettlementController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid settlement id" });
    }

    const input = req.body as UpdateSettlementInput;
    const settlement = await updateSettlement({ id: req.user.id, roles: req.user.roles }, id, input.codCollectionIds);

    return res.status(200).json({ success: true, message: "Settlement updated", data: settlement });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update settlement",
    });
  }
}

export async function revertSettlementController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid settlement id" });
    }

    const input = req.body as RevertSettlementInput;
    const settlement = await revertSettlement({ id: req.user.id, roles: req.user.roles }, id, input.remark);

    return res.status(200).json({ success: true, message: "Settlement reverted", data: settlement });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to revert settlement",
    });
  }
}

export async function cancelSettlementController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid settlement id" });
    }

    const input = req.body as CancelSettlementInput;
    const settlement = await cancelSettlement({ id: req.user.id, roles: req.user.roles }, id, input.remark);

    return res.status(200).json({ success: true, message: "Settlement cancelled", data: settlement });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to cancel settlement",
    });
  }
}

const VALID_SETTLEMENT_TYPES = ["rider", "vendor"];

export async function getUnsettledOrdersController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const type = req.query.type;
    if (typeof type !== "string" || !VALID_SETTLEMENT_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `type must be one of: ${VALID_SETTLEMENT_TYPES.join(", ")}`,
      });
    }

    const targetId = req.query.targetId;
    if (targetId !== undefined && (typeof targetId !== "string" || !UUID_REGEX.test(targetId))) {
      return res.status(400).json({ success: false, message: "targetId must be a valid UUID" });
    }

    const result = await getUnsettledOrders(
      { id: req.user.id, roles: req.user.roles },
      type as "rider" | "vendor",
      targetId as string | undefined,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load unsettled orders",
    });
  }
}

export async function getSettlementDetailController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid settlement id" });
    }

    const detail = await getSettlementDetail({ id: req.user.id, roles: req.user.roles }, id);
    return res.status(200).json({ success: true, data: detail });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load settlement detail",
    });
  }
}
