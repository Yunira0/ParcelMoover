import { Request, Response } from "express";
import { createOrder, getDashboardSummary, listOrders, updateParcelStatus } from "../services/order.service";
import { withIdempotency } from "../services/idempotency.service";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function createOrderController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
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
        message: "Idempotency_key must be a valid UUID",
      });
    }

    const result = await withIdempotency(idempotencyKey, req.body, async () => {
      const order = await createOrder(
        {
          id: req.user!.id,
          roles: req.user!.roles,
        },
        req.body,
      );

      return {
        result: order,
        response: {
          statusCode: 201,
          body: {
            success: true,
            message: "Order created successfully",
            data: {
              id: order.id,
              trackingId: order.tracking_id,
              status: order.status,
              createdAt: order.created_at,
            },
          },
          resourceID: order.id,
        },
      };
    });

    return res.status(201).json({
      success: true,
      message: "Order created successfully",
      data: result,
    });
  } catch (error: any) {
    // Handle idempotency-specific responses
    if (error.statusCode === 200 && error.meta?._cachedResponse) {
      // This is a RETRY that already succeeded before
      return res.status(200).json(error.meta._cachedResponse);
    }
    if (error.statusCode === 409) {
      return res.status(409).json({
        success: false,
        message: error.message,
      });
    }
    if (error.statusCode === 422) {
      return res.status(422).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create order",
    });
  }
}

export async function listOrdersController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const orders = await listOrders({
      id: req.user.id,
      roles: req.user.roles,
    });

    return res.status(200).json({
      success: true,
      data: orders,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load orders",
    });
  }
}

export async function dashboardSummaryController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const summary = await getDashboardSummary({
      id: req.user.id,
      roles: req.user.roles,
    });

    return res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load dashboard summary",
    });
  }
}

export async function updateOrderStatusController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }
    const { id } = req.params;
    const { status, locationId, remarks } = req.body;
    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const rawId = req.params.id;

    if (typeof rawId !== "string" || !rawId) {
      return res.status(400).json({
        success: false,
        message: "Invalid order id",
      });
    }

    const parcel = await updateParcelStatus(
      { id: req.user.id, roles: req.user.roles },
      rawId,
      { status, locationId, remarks },
    );
    return res.status(200).json({
      success: true,
      message: `Order status updated to '${status}'`,
      data: {
        id: parcel.id,
        trackingId: parcel.tracking_id,
        status: parcel.status,
        currentLocationId: parcel.current_location_id,
        deliveredAt: parcel.delivered_at,
        updatedAt: parcel.updated_at,
      },
    });
  } catch (error: any) {
    if (error.statusCode === 409 || error.statusCode === 422) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update order status",
    });
  }
}
