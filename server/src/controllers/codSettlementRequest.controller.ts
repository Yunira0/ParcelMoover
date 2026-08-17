import { Request, Response } from "express";
import {
  createCodSettlementRequest,
  getCodSettlementRequestById,
  listCodSettlementRequests,
  updateCodSettlementRequestStatus,
} from "../services/codSettlementRequest.service";
import {
  CodSettlementRequestStatus,
  ListCodSettlementRequestsParams,
} from "../types/codSettlementRequest.type";

export async function listCodSettlementRequestsController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { status, search, page, pageSize, sortDir } = req.query;

    const params: ListCodSettlementRequestsParams = {};
    if (typeof status === "string") params.status = status as CodSettlementRequestStatus;
    if (typeof search === "string") params.search = search;
    if (typeof page === "number") params.page = page;
    if (typeof pageSize === "number") params.pageSize = pageSize;
    if (sortDir === "asc" || sortDir === "desc") params.sortDir = sortDir;

    const { data, meta } = await listCodSettlementRequests(
      { id: req.user.id, roles: req.user.roles },
      params,
    );
    return res.status(200).json({ success: true, data, meta });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load COD settlement requests",
    });
  }
}

export async function getCodSettlementRequestController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await getCodSettlementRequestById(
      { id: req.user.id, roles: req.user.roles },
      req.params.id as string,
    );
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load the COD settlement request",
    });
  }
}

export async function createCodSettlementRequestController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await createCodSettlementRequest({ id: req.user.id, roles: req.user.roles }, req.body);
    return res.status(201).json({ success: true, message: "COD settlement request raised", data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to raise the COD settlement request",
    });
  }
}

export async function updateCodSettlementRequestStatusController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await updateCodSettlementRequestStatus(
      { id: req.user.id, roles: req.user.roles },
      req.params.id as string,
      req.body,
    );
    return res.status(200).json({ success: true, message: "COD settlement request updated", data });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update the COD settlement request",
    });
  }
}
