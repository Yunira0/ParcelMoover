import { Request, Response } from "express";
import { getAuditLogFilterOptions, listAuditLogs } from "../services/auditLog.service";
import { ListAuditLogsParams } from "../types/auditLog.type";

export async function listAuditLogsController(req: Request, res: Response) {
  try {
    const { search, entityType, action, fromDate, toDate, cursor, pageSize } = req.query;

    const params: ListAuditLogsParams = {};
    if (typeof search === "string") params.search = search;
    if (typeof entityType === "string") params.entityType = entityType;
    if (typeof action === "string") params.action = action;
    if (typeof fromDate === "string") params.fromDate = fromDate;
    if (typeof toDate === "string") params.toDate = toDate;
    if (typeof cursor === "string") params.cursor = cursor;
    if (typeof pageSize === "string" && Number.isFinite(Number(pageSize))) params.pageSize = Number(pageSize);

    const { data, meta } = await listAuditLogs(params);

    return res.status(200).json({ success: true, data, meta });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load audit logs",
    });
  }
}

export async function getAuditLogFilterOptionsController(_req: Request, res: Response) {
  try {
    const options = await getAuditLogFilterOptions();
    return res.status(200).json({ success: true, data: options });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load audit log filter options",
    });
  }
}
