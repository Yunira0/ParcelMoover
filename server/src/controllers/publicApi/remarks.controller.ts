import { Request, Response } from "express";
import { addOrderRemark, getOrderByTrackingId } from "../../services/order.service";
import { withIdempotency } from "../../services/idempotency.service";
import { isValidTrackingId } from "../../utils/trackingId";
import { PublicAddRemarkInput } from "../../validators/publicApi.schema";
import { actorFrom, sendError, UUID_REGEX } from "./shared";

export async function publicListRemarksController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { trackingId } = req.params;
    if (typeof trackingId !== "string" || !isValidTrackingId(trackingId)) {
      return res.status(400).json({ success: false, message: "Invalid tracking id" });
    }

    const order = await getOrderByTrackingId(actorFrom(req), trackingId);

    return res.status(200).json({ success: true, data: order.remarks });
  } catch (error: any) {
    return sendError(res, error, "Failed to load remarks");
  }
}

export async function publicAddRemarkController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { trackingId } = req.params;
    if (typeof trackingId !== "string" || !isValidTrackingId(trackingId)) {
      return res.status(400).json({ success: false, message: "Invalid tracking id" });
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

    const actor = actorFrom(req);
    const { remark, parentRemarkId } = req.body as PublicAddRemarkInput;

    const responseBody = await withIdempotency(idempotencyKey, req.body, async () => {
      const order = await getOrderByTrackingId(actor, trackingId);
      const created = await addOrderRemark(actor, order.id, remark, parentRemarkId);

      const body = {
        success: true,
        message: "Remark added",
        data: created,
      };

      return {
        result: body,
        response: { statusCode: 201, body, resourceID: created.id },
      };
    });

    return res.status(201).json(responseBody);
  } catch (error: any) {
    return sendError(res, error, "Failed to add remark");
  }
}
