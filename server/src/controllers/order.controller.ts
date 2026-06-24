import { Request, Response } from "express";
import {
  bulkUpdateParcelStatus,
  createOrder,
  getDashboardSummary,
  listOrders,
  updateParcelStatus,
} from "../services/order.service";
import { withIdempotency } from "../services/idempotency.service";
import { ParcelStatus, STATUS_TRANSITIONS } from "../types/order.type";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_STATUSES = new Set(Object.keys(STATUS_TRANSITIONS));
const MAX_BULK_IDS = 200;

function parseStatusQuery(raw: unknown): ParcelStatus[] | undefined {
  if (!raw) return undefined;
  const values = Array.isArray(raw) ? raw : String(raw).split(",");
  const statuses = values.map((v) => String(v).trim()).filter(Boolean);
  if (statuses.length === 0) return undefined;
  if (!statuses.every((s) => VALID_STATUSES.has(s))) {
    throw new Error(`Invalid status filter. Allowed: [${Array.from(VALID_STATUSES).join(", ")}]`);
  }
  return statuses as ParcelStatus[];
}

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

    let status: ParcelStatus[] | undefined;
    try {
      status = parseStatusQuery(req.query.status);
    } catch (e: any) {
      return res.status(400).json({ success: false, message: e.message });
    }

    const search = typeof req.query.search === "string" ? req.query.search : undefined;

    let page: number | undefined;
    let pageSize: number | undefined;
    if (req.query.page !== undefined) {
      page = Number(req.query.page);
      if (!Number.isInteger(page) || page < 1) {
        return res.status(400).json({ success: false, message: "page must be a positive integer" });
      }
    }
    if (req.query.pageSize !== undefined) {
      pageSize = Number(req.query.pageSize);
      if (!Number.isInteger(pageSize) || pageSize < 1) {
        return res.status(400).json({ success: false, message: "pageSize must be a positive integer" });
      }
    }

    const result = await listOrders(
      { id: req.user.id, roles: req.user.roles },
      {
        ...(status ? { status } : {}),
        ...(search ? { search } : {}),
        ...(page !== undefined ? { page } : {}),
        ...(pageSize !== undefined ? { pageSize } : {}),
      },
    );

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

export async function bulkUpdateOrderStatusController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { ids, status, remarks, toLocationId, riderId } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: "ids must be a non-empty array",
      });
    }
    if (ids.length > MAX_BULK_IDS) {
      return res.status(400).json({
        success: false,
        message: `Cannot update more than ${MAX_BULK_IDS} orders at once`,
      });
    }
    if (!ids.every((id) => typeof id === "string" && UUID_REGEX.test(id))) {
      return res.status(400).json({
        success: false,
        message: "ids must contain valid UUIDs",
      });
    }
    if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
      return res.status(400).json({
        success: false,
        message: "A valid status is required",
      });
    }

    const result = await bulkUpdateParcelStatus(
      { id: req.user.id, roles: req.user.roles },
      { ids, status: status as ParcelStatus, remarks, toLocationId, riderId },
    );

    return res.status(200).json({
      success: true,
      message: `${result.updatedCount} order(s) updated to '${result.status}'`,
      data: result,
    });
  } catch (error: any) {
    if ([400, 403, 404, 409, 422].includes(error.statusCode)) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update order statuses",
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
    const { status, locationId, remarks, riderId } = req.body;
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
      { status, locationId, remarks, riderId },
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
