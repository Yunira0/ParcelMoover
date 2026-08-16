import { Request, Response } from "express";
import {
  getPendingCodBill,
  listOrderCod,
  listSettlements,
  getUnsettledOrders,
  getSettlementDetail,
  getSettlementDocumentPath,
} from "../../services/finance.service";
import { PublicOrderCodQuery, PublicSettlementsQuery } from "../../validators/publicApi.schema";
import { sendEncryptedFile } from "../../lib/serveEncryptedDocument";
import prisma from "../../lib/prisma";
import { actorFrom, sendError, UUID_REGEX } from "./shared";

// Read-only mirrors of the vendor-facing dashboard finance views. payeeType/
// targetId are never accepted as public params — the API key's own vendor is
// always the scope, same as every other Partner API endpoint.

export async function publicGetPendingCodController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const bill = await getPendingCodBill(actorFrom(req));
    return res.status(200).json({ success: true, data: bill });
  } catch (error: any) {
    return sendError(res, error, "Failed to load pending COD");
  }
}

export async function publicListOrderCodController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const query = req.query as unknown as PublicOrderCodQuery;
    const result = await listOrderCod(actorFrom(req), undefined, query.status, query.page, query.pageSize);
    return res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    return sendError(res, error, "Failed to load order COD payments");
  }
}

export async function publicListSettlementsController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const query = req.query as unknown as PublicSettlementsQuery;
    const fromDate = query.fromDate ? new Date(query.fromDate) : undefined;
    const toDate = query.toDate ? new Date(query.toDate) : undefined;
    const result = await listSettlements(
      actorFrom(req),
      "vendor",
      undefined,
      query.page,
      query.pageSize,
      fromDate,
      toDate,
    );
    return res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    return sendError(res, error, "Failed to load settlements");
  }
}

export async function publicGetSettlementController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const { id } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid settlement id" });
    }
    const detail = await getSettlementDetail(actorFrom(req), id);
    return res.status(200).json({ success: true, data: detail });
  } catch (error: any) {
    return sendError(res, error, "Failed to load settlement");
  }
}

// The settlement detail above hands back paymentReceiptPath/taxInvoicePath, and
// the /uploads mount is admin-only — so without this a key holder is told their
// own paperwork exists but has no way to fetch it. Streams raw bytes rather than
// the usual { success, data } envelope; the same is true of GET /billing/qr.
export async function publicGetSettlementDocumentController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id, kind } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid settlement id" });
    }
    if (kind !== "receipt" && kind !== "tax-invoice") {
      return res.status(400).json({ success: false, message: "Unknown document" });
    }

    const storedPath = await getSettlementDocumentPath(actorFrom(req), id, kind);

    // Mirrors the audit entry both the /uploads mount and the dashboard's own
    // document route write, so an API-key view is as traceable as a staff one.
    prisma.audit_logs
      .create({
        data: {
          actor_id: req.apiKey.userId,
          entity_type: "document",
          entity_id: id,
          action: "VIEW_DOCUMENT",
          new_data: { settlementId: id, kind, via: "partner_api", apiKeyId: req.apiKey.id },
          ip_address: req.ip || null,
          user_agent: req.get("user-agent") || null,
        },
      })
      .catch((err) => console.error("[audit] Failed to log document view:", err));

    return await sendEncryptedFile(res, storedPath);
  } catch (error: any) {
    return sendError(res, error, "Failed to load document");
  }
}

export async function publicGetUnsettledOrdersController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const result = await getUnsettledOrders(actorFrom(req), "vendor");
    return res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    return sendError(res, error, "Failed to load unsettled orders");
  }
}
