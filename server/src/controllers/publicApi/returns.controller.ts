import { Request, Response } from "express";
import { getOrderByTrackingId } from "../../services/order.service";
import { createTicket } from "../../services/ticket.service";
import { withIdempotency } from "../../services/idempotency.service";
import { isValidTrackingId } from "../../utils/trackingId";
import { PublicReturnRequestInput } from "../../validators/publicApi.schema";
import { AppError } from "../../utils/AppError";
import { actorFrom, sendError, UUID_REGEX } from "./shared";

// Orders already fully returned, or cancelled before ever reaching the
// customer, have nothing left for the RTO workflow to act on.
const NOT_RETURNABLE_STATUSES = new Set(["cancelled", "returned_to_vendor"]);

// POST /api/v1/orders/:trackingId/return-request — opens a pending request for
// ops staff to review (surfaces as a "Return Request" support ticket). This
// intentionally does NOT move the parcel through the RTO workflow
// (follow_up -> ready_to_return -> sent_to_vendor -> returned_to_vendor) -
// that stays staff-only, exactly as it is for dashboard-created orders.
export async function publicCreateReturnRequestController(req: Request, res: Response) {
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
    const { reason, notes } = req.body as PublicReturnRequestInput;

    const responseBody = await withIdempotency(idempotencyKey, req.body, async () => {
      const order = await getOrderByTrackingId(actor, trackingId);
      if (NOT_RETURNABLE_STATUSES.has(order.status)) {
        throw new AppError(409, `Order is already "${order.status}" and cannot be returned`);
      }

      const ticket = await createTicket(actor, {
        subject: `Return request — ${order.trackingId}`,
        category: "return_request",
        description: notes ? `${reason}\n\n${notes}` : reason,
        parcelId: order.id,
      });

      const body = {
        success: true,
        message: "Return request submitted",
        data: { id: ticket.id, ticketId: ticket.ticketId, status: ticket.status },
      };

      return {
        result: body,
        response: { statusCode: 201, body, resourceID: ticket.id },
      };
    });

    return res.status(201).json(responseBody);
  } catch (error: any) {
    return sendError(res, error, "Failed to submit return request");
  }
}
