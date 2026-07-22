import { Request, Response } from "express";
import {
  createOrder,
  getOrderByTrackingId,
  getOrderStatusesByTrackingIds,
  getSenderProfile,
  listOrders,
  updateParcelStatus,
} from "../../services/order.service";
import { resolveDestinationRef } from "../../services/delivery-rate.service";
import { withIdempotency } from "../../services/idempotency.service";
import { isValidTrackingId } from "../../utils/trackingId";
import {
  PublicBulkStatusInput,
  PublicCancelOrderInput,
  PublicListOrdersQuery,
} from "../../validators/publicApi.schema";
import { actorFrom, sendError, UUID_REGEX } from "./shared";

export async function publicCreateOrderController(req: Request, res: Response) {
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

    // Sender defaults to the key owner's registered pickup profile. Filled
    // before withIdempotency so the replay-detection hash sees the same
    // effective payload the order was created with.
    if (!req.body.sender) {
      const profile = await getSenderProfile(actorFrom(req));
      req.body.sender = {
        name: profile.name,
        phone: profile.phone,
        ...(profile.address ? { address: profile.address } : {}),
        ...(profile.locationId ? { locationId: profile.locationId } : {}),
      };
    }

    // destinationLocationId/receiver.locationId accept a hub name ("POKHARA")
    // as well as a UUID - resolve to a real id here (also before
    // withIdempotency, same reasoning as sender above) so the internal
    // (UUID-only) order-creation service never has to know the difference.
    if (req.body.destinationLocationId) {
      req.body.destinationLocationId = await resolveDestinationRef(req.body.destinationLocationId);
    }
    if (req.body.receiver?.locationId) {
      req.body.receiver.locationId = await resolveDestinationRef(req.body.receiver.locationId);
    }

    const responseBody = await withIdempotency(idempotencyKey, req.body, async () => {
      const order = await createOrder(actorFrom(req), req.body);

      const body = {
        success: true,
        message: "Order created successfully",
        data: {
          id: order.id,
          trackingId: order.tracking_id,
          status: order.status,
          createdAt: order.created_at,
        },
      };

      return {
        result: body,
        response: {
          statusCode: 201,
          body,
          resourceID: order.id,
        },
      };
    });

    return res.status(201).json(responseBody);
  } catch (error: any) {
    return sendError(res, error, "Failed to create order");
  }
}

export async function publicGetOrderController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { trackingId } = req.params;
    if (typeof trackingId !== "string" || !isValidTrackingId(trackingId)) {
      return res.status(400).json({ success: false, message: "Invalid tracking id" });
    }

    const order = await getOrderByTrackingId(actorFrom(req), trackingId);

    return res.status(200).json({ success: true, data: order });
  } catch (error: any) {
    return sendError(res, error, "Failed to load order");
  }
}

export async function publicListOrdersController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const query = req.query as unknown as PublicListOrdersQuery;

    // Always pass a page so listOrders takes the paginated (uncached) path —
    // the shared unfiltered-list cache is keyed for dashboard sessions.
    const result = await listOrders(actorFrom(req), {
      ...(query.status?.length ? { status: query.status } : {}),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      ...(result.meta ? { meta: result.meta } : {}),
    });
  } catch (error: any) {
    return sendError(res, error, "Failed to load orders");
  }
}

export async function publicCancelOrderController(req: Request, res: Response) {
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
    const { reason } = req.body as PublicCancelOrderInput;

    const responseBody = await withIdempotency(idempotencyKey, req.body, async () => {
      const order = await getOrderByTrackingId(actor, trackingId);
      const updated = await updateParcelStatus(actor, order.id, {
        status: "cancelled",
        ...(reason ? { remarks: reason } : {}),
      });

      const body = {
        success: true,
        message: "Order cancelled",
        data: { trackingId, status: updated.status },
      };

      return {
        result: body,
        response: { statusCode: 200, body, resourceID: order.id },
      };
    });

    return res.status(200).json(responseBody);
  } catch (error: any) {
    return sendError(res, error, "Failed to cancel order");
  }
}

export async function publicBulkOrderStatusController(req: Request, res: Response) {
  try {
    if (!req.apiKey) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { trackingIds } = req.body as PublicBulkStatusInput;
    const result = await getOrderStatusesByTrackingIds(actorFrom(req), trackingIds);

    return res.status(200).json({
      success: true,
      data: result.data,
      notFound: result.notFound,
    });
  } catch (error: any) {
    return sendError(res, error, "Failed to load order statuses");
  }
}
