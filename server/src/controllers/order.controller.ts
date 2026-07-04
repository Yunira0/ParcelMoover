import { Request, Response } from "express";
import {
  addOrderRemark,
  bulkCreateOrders,
  bulkUpdateParcelStatus,
  createOrder,
  getDashboardSummary,
  getOrderByTrackingId,
  listOrders,
  updateParcelStatus,
} from "../services/order.service";
import { withIdempotency } from "../services/idempotency.service";
import { ORDER_SORT_FIELDS, OrderSortField, OrderType, ParcelStatus, STATUS_TRANSITIONS } from "../types/order.type";

// General UUID shape (8-4-4-4-12 hex). Intentionally not strict about the
// RFC-4122 version/variant nibbles, since seeded/demo records use deterministic
// ids like 77777777-0000-0000-0000-000000000004. Real existence is validated
// against the database downstream — this is only a cheap format guard.
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_STATUSES = new Set(Object.keys(STATUS_TRANSITIONS));
const VALID_ORDER_TYPES: OrderType[] = ["delivery", "exchange", "return"];
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

    // result and response.body must be the same object so a replayed retry
    // (which returns response.body) gets back exactly what the original
    // caller received, instead of a differently-shaped payload.
    const responseBody = await withIdempotency(idempotencyKey, req.body, async () => {
      const order = await createOrder(
        {
          id: req.user!.id,
          roles: req.user!.roles,
        },
        req.body,
      );

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

export async function bulkCreateOrdersController(req: Request, res: Response) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const idempotencyKey = req.headers["idempotency-key"] as string | undefined;
    if (!idempotencyKey || !UUID_REGEX.test(idempotencyKey)) {
      return res.status(400).json({ success: false, message: "Valid Idempotency-Key header is required" });
    }

    const responseBody = await withIdempotency(idempotencyKey, req.body, async () => {
      const data = await bulkCreateOrders({ id: req.user!.id, roles: req.user!.roles }, req.body);
      const body = {
        success: true,
        message: `${data.created} order(s) created, ${data.failed} failed`,
        data,
      };
      return {
        result: body,
        response: {
          statusCode: 207,
          body,
          resourceID: `bulk-${idempotencyKey}`,
        },
      };
    });

    return res.status(207).json(responseBody);
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Bulk order creation failed",
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

    let orderType: OrderType | undefined;
    if (req.query.orderType !== undefined) {
      if (typeof req.query.orderType !== "string" || !VALID_ORDER_TYPES.includes(req.query.orderType as OrderType)) {
        return res.status(400).json({
          success: false,
          message: `orderType must be one of: ${VALID_ORDER_TYPES.join(", ")}`,
        });
      }
      orderType = req.query.orderType as OrderType;
    }

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

    let sortBy: OrderSortField | undefined;
    if (req.query.sortBy !== undefined) {
      if (typeof req.query.sortBy !== "string" || !ORDER_SORT_FIELDS.includes(req.query.sortBy as OrderSortField)) {
        return res.status(400).json({
          success: false,
          message: `sortBy must be one of: ${ORDER_SORT_FIELDS.join(", ")}`,
        });
      }
      sortBy = req.query.sortBy as OrderSortField;
    }

    let sortDir: "asc" | "desc" | undefined;
    if (req.query.sortDir !== undefined) {
      if (req.query.sortDir !== "asc" && req.query.sortDir !== "desc") {
        return res.status(400).json({ success: false, message: "sortDir must be 'asc' or 'desc'" });
      }
      sortDir = req.query.sortDir;
    }

    const result = await listOrders(
      { id: req.user.id, roles: req.user.roles },
      {
        ...(status ? { status } : {}),
        ...(orderType ? { orderType } : {}),
        ...(search ? { search } : {}),
        ...(page !== undefined ? { page } : {}),
        ...(pageSize !== undefined ? { pageSize } : {}),
        ...(sortBy ? { sortBy } : {}),
        ...(sortDir ? { sortDir } : {}),
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

export async function getOrderByTrackingIdController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { trackingId } = req.params;
    if (typeof trackingId !== "string" || !trackingId) {
      return res.status(400).json({ success: false, message: "Invalid tracking id" });
    }

    const order = await getOrderByTrackingId(
      { id: req.user.id, roles: req.user.roles },
      trackingId,
    );

    return res.status(200).json({ success: true, data: order });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to load order",
    });
  }
}

export async function addOrderRemarkController(req: Request, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { id } = req.params;
    if (typeof id !== "string" || !id) {
      return res.status(400).json({ success: false, message: "Invalid order id" });
    }
    const { remark, parentRemarkId } = req.body;
    if (typeof remark !== "string" || !remark.trim()) {
      return res.status(400).json({ success: false, message: "Remark text is required" });
    }

    const created = await addOrderRemark(
      { id: req.user.id, roles: req.user.roles },
      id,
      remark,
      typeof parentRemarkId === "string" ? parentRemarkId : null,
    );

    return res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to add remark",
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

    // Namespaced so a client reusing the same key across different endpoints
    // (e.g. create-order vs bulk-status) can't collide on the shared idempotency store.
    const body = await withIdempotency(
      `order-bulk-status:${idempotencyKey}`,
      req.body,
      async () => {
        const result = await bulkUpdateParcelStatus(
          { id: req.user!.id, roles: req.user!.roles },
          { ids, status: status as ParcelStatus, remarks, toLocationId, riderId },
        );

        const responseBody = {
          success: true,
          message: `${result.updatedCount} order(s) updated to '${result.status}'`,
          data: result,
        };

        return {
          result: responseBody,
          response: {
            statusCode: 200,
            body: responseBody,
            resourceID: ids.join(","),
          },
        };
      },
    );

    return res.status(200).json(body);
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

    // Namespaced per order id + endpoint so the same key can't be replayed
    // against a different order or collide with other idempotent endpoints.
    const body = await withIdempotency(
      `order-status:${rawId}:${idempotencyKey}`,
      req.body,
      async () => {
        const parcel = await updateParcelStatus(
          { id: req.user!.id, roles: req.user!.roles },
          rawId,
          { status, locationId, remarks, riderId },
        );

        const responseBody = {
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
        };

        return {
          result: responseBody,
          response: {
            statusCode: 200,
            body: responseBody,
            resourceID: parcel.id,
          },
        };
      },
    );

    return res.status(200).json(body);
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
