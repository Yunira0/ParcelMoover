import type { Request, Response } from "express";
import { secureUploadedDocuments } from "../lib/documentUpload";
import { sendEncryptedFile } from "../lib/serveEncryptedDocument";
import {
  attachCarrierSettlementDocuments,
  cancelCarrierSettlement,
  deleteCarrierSettlementDocument,
  getCarrierSettlementDocumentPath,
  createCarrierSettlement,
  getCarrierSettlementDetail,
  getUnsettledCarrierOrders,
  listCarrierSettlements,
  payCarrierSettlement,
} from "../services/carrier-settlement.service";

const actor = (req: Request) => ({ id: req.user!.id, roles: req.user!.roles });
const fail = (res: Response, error: any, message: string) =>
  res.status(error.statusCode || 500).json({ success: false, message: error.message || message });

export async function unsettledCarrierOrdersController(req: Request, res: Response) {
  try { return res.json({ success: true, data: await getUnsettledCarrierOrders(actor(req), req.params.carrier) }); }
  catch (e) { return fail(res, e, "Failed to load 3PL orders"); }
}

export async function listCarrierSettlementsController(req: Request, res: Response) {
  try {
    const { carrier, status, settledFrom, settledTo, page, pageSize } = req.query;
    const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const result = await listCarrierSettlements(actor(req), {
      ...(typeof carrier === "string" && carrier ? { carrier } : {}),
      ...(typeof status === "string" && status ? { status } : {}),
      ...(isDay(settledFrom) ? { settledFrom } : {}),
      ...(isDay(settledTo) ? { settledTo } : {}),
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 20,
    });
    return res.json({ success: true, ...result });
  } catch (e) { return fail(res, e, "Failed to load 3PL statements"); }
}

export async function createCarrierSettlementController(req: Request, res: Response) {
  try { return res.status(201).json({ success: true, message: "3PL statement created", data: await createCarrierSettlement(actor(req), req.body) }); }
  catch (e) { return fail(res, e, "Failed to create 3PL statement"); }
}

export async function getCarrierSettlementController(req: Request, res: Response) {
  try { return res.json({ success: true, data: await getCarrierSettlementDetail(actor(req), String(req.params.id)) }); }
  catch (e) { return fail(res, e, "Failed to load 3PL statement"); }
}

export async function payCarrierSettlementController(req: Request, res: Response) {
  try {
    const data = await payCarrierSettlement(actor(req), String(req.params.id), {
      payments: req.body.payments,
      remark: req.body.remark,
    });
    return res.json({ success: true, message: data.status === "settled" ? "3PL statement settled" : "Part payment recorded", data });
  } catch (e) { return fail(res, e, "Failed to record 3PL payment"); }
}

export async function cancelCarrierSettlementController(req: Request, res: Response) {
  try { return res.json({ success: true, message: "3PL statement cancelled", data: await cancelCarrierSettlement(actor(req), String(req.params.id), req.body.remark) }); }
  catch (e) { return fail(res, e, "Failed to cancel 3PL statement"); }
}

export async function attachCarrierSettlementDocumentsController(req: Request, res: Response) {
  try {
    const files = (req.files as Record<string, Express.Multer.File[]> | undefined)?.settlementFile ?? [];
    // Check each file matches its extension, and encrypt it, before recording it.
    await secureUploadedDocuments(files);
    const data = await attachCarrierSettlementDocuments(
      actor(req),
      String(req.params.id),
      files.map((file) => ({ path: `uploads/settlements/${file.filename}`, name: file.originalname })),
    );
    return res.status(201).json({ success: true, message: "File attached", data });
  } catch (e) { return fail(res, e, "Failed to attach file"); }
}

export async function getCarrierSettlementDocumentController(req: Request, res: Response) {
  try { return await sendEncryptedFile(res, await getCarrierSettlementDocumentPath(actor(req), String(req.params.id), String(req.params.documentId))); }
  catch (e) { return fail(res, e, "Failed to load file"); }
}

export async function deleteCarrierSettlementDocumentController(req: Request, res: Response) {
  try {
    await deleteCarrierSettlementDocument(actor(req), String(req.params.id), String(req.params.documentId));
    return res.json({ success: true, message: "File removed" });
  } catch (e) { return fail(res, e, "Failed to remove file"); }
}
