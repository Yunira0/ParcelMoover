import { z } from "zod";
import {
  publicAddRemarkSchema,
  publicBulkStatusSchema,
  publicCancelOrderSchema,
  publicCreateOrderSchema,
  publicCreateTicketSchema,
  publicListOrdersQuerySchema,
  publicOrderCodQuerySchema,
  publicQuoteQuerySchema,
  publicReturnRequestSchema,
  publicSettlementsQuerySchema,
  publicTicketReplySchema,
  publicUpdateOrderSchema,
} from "../validators/publicApi.schema";
import { listTicketsQuerySchema } from "../validators/ticket.schema";

// Hand-assembled OpenAPI 3.1 document for the vendor Partner API. Request
// schemas are generated from the same Zod schemas the routes validate
// against (via Zod v4's native z.toJSONSchema) - so the spec can't drift
// from what the API actually accepts the way a hand-maintained doc would.

type JsonSchema = Record<string, unknown>;

function toSchema(zodSchema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(zodSchema) as JsonSchema;
  delete json.$schema;
  return json;
}

// Query-param schemas need to become individual OpenAPI `parameters` entries,
// not a single JSON-schema request body - lift each top-level property out.
function queryParams(zodSchema: z.ZodType): unknown[] {
  const json = toSchema(zodSchema) as { properties?: Record<string, JsonSchema>; required?: string[] };
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([name, schema]) => ({
    name,
    in: "query",
    required: required.has(name),
    schema,
  }));
}

const trackingIdParam = {
  name: "trackingId",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "The order's tracking ID, e.g. PM-260722-ABCDE12345XYZ-S",
};

const ticketIdParam = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

const idempotencyKeyHeader = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  schema: { type: "string", format: "uuid" },
  description: "Client-generated UUID. Replaying the same key with the same body returns the original response instead of repeating the action.",
};

const errorResponse = { "$ref": "#/components/schemas/ErrorResponse" };

function errorResponses(...statusCodes: number[]) {
  const descriptions: Record<number, string> = {
    400: "Validation failed",
    401: "Missing or invalid API key",
    403: "Not allowed for this vendor",
    404: "Not found or not owned by this vendor",
    409: "Conflicting state (e.g. idempotency key reused, or already in a terminal status)",
    422: "Invalid status transition",
    429: "Rate limited",
  };
  const out: Record<string, unknown> = {};
  for (const code of statusCodes) {
    out[code] = { description: descriptions[code] ?? "Error", content: { "application/json": { schema: errorResponse } } };
  }
  return out;
}

function jsonRequestBody(schemaName: string) {
  return {
    required: true,
    content: { "application/json": { schema: { "$ref": `#/components/schemas/${schemaName}` } } },
  };
}

export function buildOpenApiDocument(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "ParcelMoover Partner API",
      version: "1.1.0",
      description:
        "Vendor-facing API for placing and tracking orders, quoting delivery rates, and raising support tickets. " +
        "Every request authenticates with a vendor API key (Settings → Developer → API Keys). " +
        "Mutating endpoints require a client-generated `Idempotency-Key` header (a UUID) so retries never double-execute. " +
        "Orders can be created with `orderType: \"exchange\"`; once ops confirms delivery, a linked return parcel is " +
        "auto-created and surfaced back on the original order as `sourceOrderId` on the new one. Orders can also set " +
        "`allowPartialDelivery: true` to flag that a partial delivery is acceptable - the outcome (`partialDeliveryRemarks`, " +
        "`partialCodCollected`) is still reported by ops/rider, readable via the order endpoints. Returns raised via " +
        "`POST /orders/{trackingId}/return-request` open a pending request for staff review rather than moving the " +
        "order through the return-to-vendor workflow directly.",
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ ApiKeyAuth: [] }],
    paths: {
      "/orders": {
        post: {
          summary: "Create an order",
          operationId: "createOrder",
          parameters: [idempotencyKeyHeader],
          requestBody: jsonRequestBody("CreateOrderRequest"),
          responses: {
            201: { description: "Order created", content: { "application/json": { schema: { "$ref": "#/components/schemas/CreateOrderResponse" } } } },
            ...errorResponses(400, 401, 409, 429),
          },
        },
        get: {
          summary: "List your own orders",
          operationId: "listOrders",
          parameters: queryParams(publicListOrdersQuerySchema),
          responses: {
            200: { description: "Paginated order list", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 429),
          },
        },
      },
      "/orders/{trackingId}": {
        get: {
          summary: "Track one order",
          operationId: "getOrder",
          parameters: [trackingIdParam],
          responses: {
            200: { description: "Order detail", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 404, 429),
          },
        },
        patch: {
          summary: "Edit an order (pre-dispatch only)",
          description: "Update receiver/address, route, service type, pieces/weight, COD, or package details. Only allowed while the order is still pickup_ordered, rider_assigned, or failed_pickup - once it's in the delivery network, returns 409.",
          operationId: "updateOrder",
          parameters: [trackingIdParam, idempotencyKeyHeader],
          requestBody: jsonRequestBody("UpdateOrderRequest"),
          responses: {
            200: { description: "Order updated", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 404, 409, 429),
          },
        },
      },
      "/orders/{trackingId}/return-request": {
        post: {
          summary: "Request a return (pending staff review)",
          description: "Opens a pending return request for ops staff to review - it does not itself move the order through the return-to-vendor workflow, which stays staff-managed. Track its resolution via GET /tickets/{id}.",
          operationId: "createReturnRequest",
          parameters: [trackingIdParam, idempotencyKeyHeader],
          requestBody: jsonRequestBody("ReturnRequestRequest"),
          responses: {
            201: { description: "Return request submitted", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 404, 409, 429),
          },
        },
      },
      "/orders/{trackingId}/cancel": {
        post: {
          summary: "Cancel your order",
          description: "Only allowed while the order is still pre-pickup (pickup_ordered, rider_assigned, or failed_pickup); otherwise returns 409/422.",
          operationId: "cancelOrder",
          parameters: [trackingIdParam, idempotencyKeyHeader],
          requestBody: jsonRequestBody("CancelOrderRequest"),
          responses: {
            200: { description: "Order cancelled", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 404, 409, 422, 429),
          },
        },
      },
      "/orders/statuses": {
        post: {
          summary: "Bulk status lookup",
          description: "Look up up to 100 orders by tracking ID in one call, for reconciliation without exhausting the per-order read rate limit. Unresolved IDs are returned in `notFound`.",
          operationId: "bulkOrderStatuses",
          requestBody: jsonRequestBody("BulkStatusRequest"),
          responses: {
            200: { description: "Statuses for the requested tracking ids", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 429),
          },
        },
      },
      "/rates": {
        get: {
          summary: "Your full rate card",
          operationId: "getRates",
          responses: {
            200: { description: "Rate card across all destinations", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(401, 404, 429),
          },
        },
      },
      "/rates/quote": {
        get: {
          summary: "Quote a single destination",
          operationId: "getRateQuote",
          parameters: queryParams(publicQuoteQuerySchema),
          responses: {
            200: { description: "Computed quote", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 404, 429),
          },
        },
      },
      "/orders/{trackingId}/remarks": {
        get: {
          summary: "Read the comment thread on an order",
          operationId: "listRemarks",
          parameters: [trackingIdParam],
          responses: {
            200: { description: "Remarks thread", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 404, 429),
          },
        },
        post: {
          summary: "Add a comment to an order",
          operationId: "addRemark",
          parameters: [trackingIdParam, idempotencyKeyHeader],
          requestBody: jsonRequestBody("AddRemarkRequest"),
          responses: {
            201: { description: "Remark added", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 404, 429),
          },
        },
      },
      "/tickets": {
        post: {
          summary: "Open a support ticket",
          operationId: "createTicket",
          parameters: [idempotencyKeyHeader],
          requestBody: jsonRequestBody("CreateTicketRequest"),
          responses: {
            201: { description: "Ticket created", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 409, 429),
          },
        },
        get: {
          summary: "List your own tickets",
          operationId: "listTickets",
          parameters: queryParams(listTicketsQuerySchema),
          responses: {
            200: { description: "Paginated ticket list", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 429),
          },
        },
      },
      "/tickets/{id}": {
        get: {
          summary: "Ticket detail and reply thread",
          operationId: "getTicket",
          parameters: [ticketIdParam],
          responses: {
            200: { description: "Ticket detail", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 403, 404, 429),
          },
        },
      },
      "/tickets/{id}/replies": {
        post: {
          summary: "Reply on your ticket",
          operationId: "replyToTicket",
          parameters: [ticketIdParam, idempotencyKeyHeader],
          requestBody: jsonRequestBody("TicketReplyRequest"),
          responses: {
            201: { description: "Reply posted", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 403, 404, 429),
          },
        },
      },
      "/finance/pending-cod": {
        get: {
          summary: "Your current pending COD statement",
          operationId: "getPendingCod",
          responses: {
            200: { description: "Pending COD bill", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(401, 403, 429),
          },
        },
      },
      "/finance/order-cod": {
        get: {
          summary: "Per-order COD payment status",
          operationId: "listOrderCod",
          parameters: queryParams(publicOrderCodQuerySchema),
          responses: {
            200: { description: "Paginated order COD list", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 403, 429),
          },
        },
      },
      "/finance/settlements": {
        get: {
          summary: "Your settlement statements",
          operationId: "listSettlements",
          parameters: queryParams(publicSettlementsQuerySchema),
          responses: {
            200: { description: "Paginated settlement list", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(400, 401, 403, 429),
          },
        },
      },
      "/finance/settlements/{id}": {
        get: {
          summary: "Settlement statement detail",
          operationId: "getSettlement",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            200: { description: "Line-item settlement detail", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(401, 403, 404, 429),
          },
        },
      },
      "/finance/unsettled-orders": {
        get: {
          summary: "Orders with COD collected but not yet settled",
          operationId: "getUnsettledOrders",
          responses: {
            200: { description: "Unsettled order list", content: { "application/json": { schema: { type: "object" } } } },
            ...errorResponses(401, 403, 429),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "pm_live_<40 hex chars>",
          description: "Vendor API key from Settings → Developer → API Keys. Also accepted via an `X-Api-Key` header instead of `Authorization: Bearer`.",
        },
      },
      schemas: {
        CreateOrderRequest: toSchema(publicCreateOrderSchema),
        CreateOrderResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
            data: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                trackingId: { type: "string" },
                status: { type: "string" },
                createdAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
        CancelOrderRequest: toSchema(publicCancelOrderSchema),
        UpdateOrderRequest: toSchema(publicUpdateOrderSchema),
        ReturnRequestRequest: toSchema(publicReturnRequestSchema),
        BulkStatusRequest: toSchema(publicBulkStatusSchema),
        AddRemarkRequest: toSchema(publicAddRemarkSchema),
        CreateTicketRequest: toSchema(publicCreateTicketSchema),
        TicketReplyRequest: toSchema(publicTicketReplySchema),
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", enum: [false] },
            message: { type: "string" },
            error: {
              type: "object",
              properties: {
                code: { type: "string" },
                fields: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { field: { type: "string" }, message: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}
