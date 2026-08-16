import { Request, Response } from "express";
import {
  getPendingCodBill,
  listOrderCod,
  listSettlements,
  getUnsettledOrders,
  getSettlementDetail,
} from "../../services/finance.service";
import { PublicOrderCodQuery, PublicSettlementsQuery } from "../../validators/publicApi.schema";
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
