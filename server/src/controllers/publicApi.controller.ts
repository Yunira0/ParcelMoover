import { Request, Response } from "express";
import {
  createOrder,
  getOrderByTrackingId,
  getSenderProfile,
  listOrders,
} from "../services/order.service";
import { withIdempotency } from "../services/idempotency.service";
import { isValidTrackingId } from "../utils/trackingId";
import { PublicListOrdersQuery } from "../validators/publicApi.schema";

// Public partner API controllers. Every handler synthesizes a vendor OrderActor
// from the authenticated API key, so the existing vendor-scoped order services
// enforce ownership exactly as they do for dashboard logins.

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actorFrom(req: Request) {
  return { id: req.apiKey!.userId, roles: ["vendor"] };
}

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
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create order",
    });
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
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load order",
    });
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
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load orders",
    });
  }
}
