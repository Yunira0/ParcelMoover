import { Request, Response } from "express";
import {
  createCodSettlementRequest,
  getCodSettlementRequestById,
  getRegisteredBankDetails,
  listCodSettlementRequests,
} from "../../services/codSettlementRequest.service";
import { withIdempotency } from "../../services/idempotency.service";
import { ListCodSettlementRequestsParams } from "../../types/codSettlementRequest.type";
import { actorFrom, sendError, UUID_REGEX } from "./shared";

export async function publicListCodSettlementRequestsController(req: Request, res: Response) {
  try {
    if (!req.apiKey) return res.status(401).json({ success: false, message: "Unauthorized" });
    const query = req.query as unknown as ListCodSettlementRequestsParams;
    const { data, meta } = await listCodSettlementRequests(actorFrom(req), query);
    return res.status(200).json({ success: true, data, meta });
  } catch (error: any) {
    return sendError(res, error, "Failed to load COD settlement requests");
  }
}

export async function publicGetRegisteredBankDetailsController(req: Request, res: Response) {
  try {
    if (!req.apiKey) return res.status(401).json({ success: false, message: "Unauthorized" });
    const data = await getRegisteredBankDetails(actorFrom(req));
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return sendError(res, error, "Failed to load registered bank details");
  }
}

export async function publicGetCodSettlementRequestController(req: Request, res: Response) {
  try {
    if (!req.apiKey) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { id } = req.params;
    if (typeof id !== "string" || !UUID_REGEX.test(id)) {
      return res.status(400).json({ success: false, message: "Invalid request id", error: { code: "VALIDATION_ERROR" } });
    }
    const data = await getCodSettlementRequestById(actorFrom(req), id);
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return sendError(res, error, "Failed to load COD settlement request");
  }
}

export async function publicCreateCodSettlementRequestController(req: Request, res: Response) {
  try {
    if (!req.apiKey) return res.status(401).json({ success: false, message: "Unauthorized" });
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !UUID_REGEX.test(key)) {
      return res.status(400).json({
        success: false,
        message: "Idempotency-Key must be a valid UUID",
        error: { code: "VALIDATION_ERROR" },
      });
    }

    // A replay may arrive after another vendor uses the same client-generated
    // UUID. Keep each vendor's response and request namespace separate.
    const body = await withIdempotency(
      `cod-settlement-request:${req.apiKey.vendorId}:${key}`,
      req.body,
      async () => {
        const data = await createCodSettlementRequest(actorFrom(req), req.body);
        const result = { success: true, message: "COD settlement request raised", data };
        return { result, response: { statusCode: 201, body: result, resourceID: data.id } };
      },
    );
    return res.status(201).json(body);
  } catch (error: any) {
    return sendError(res, error, "Failed to raise COD settlement request");
  }
}
