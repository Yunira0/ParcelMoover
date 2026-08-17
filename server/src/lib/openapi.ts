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
  publicVendorPaymentsQuerySchema,
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
      version: "1.2.0",
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
      "/ping": {
        get: {
          summary: "Test connectivity and API key validity",
          description:
            "The first call any new integration should make: confirms your key is valid and which vendor account it resolves to. Has no side effects beyond the same last_used_at touch every authenticated call makes.",
          operationId: "ping",
          responses: {
            200: {
              description: "pong",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string", example: "pong" },
                      data: {
                        type: "object",
                        properties: { vendorId: { type: "string", format: "uuid" } },
                      },
                    },
                  },
                },
              },
            },
            ...errorResponses(401, 429),
          },
        },
      },
      "/orders": {
        post: {
          summary: "Create an order",
          // Two rules can't be expressed in the generated JSON schema: the
          // either/or destination, and the address requirement that depends on
          // serviceType. Both are enforced and both 400 - so spell them out
          // here, or a dev generating a client from this spec won't see them.
          description:
            "A destination is required: send `destinationLocationId` **or** `receiver.locationId` (a hub name like \"POKHARA\" or a UUID from GET /rates). " +
            "`receiver.address` is required unless `serviceType` is `branch_delivery`. " +
            "`codAmount` (0 for prepaid) and `weightKg` must both be sent explicitly. " +
            "Sender defaults to your registered pickup profile when omitted, and the delivery charge is always quoted server-side from your rate agreement. " +
            "Sender and receiver phone numbers must differ. A second order to the same receiver on the same day returns 409 DUPLICATE_ORDER unless you resend with `confirmDuplicate: true`.",
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
            200: { description: "Pending COD bill", content: { "application/json": { schema: { "$ref": "#/components/schemas/PendingCodResponse" } } } },
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
            200: { description: "Paginated order COD list", content: { "application/json": { schema: { "$ref": "#/components/schemas/OrderCodListResponse" } } } },
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
            200: { description: "Paginated settlement list", content: { "application/json": { schema: { "$ref": "#/components/schemas/SettlementListResponse" } } } },
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
            200: { description: "Line-item settlement detail", content: { "application/json": { schema: { "$ref": "#/components/schemas/SettlementDetailResponse" } } } },
            ...errorResponses(401, 403, 404, 429),
          },
        },
      },
      "/finance/settlements/{id}/documents/{kind}": {
        get: {
          summary: "Payment receipt or tax invoice for a statement",
          description:
            "Streams the document itself (image or PDF), not a JSON envelope - `Content-Type` reflects the stored file. " +
            "Only available once the statement has been paid with the document attached; returns 404 otherwise.",
          operationId: "getSettlementDocument",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } },
            {
              name: "kind",
              in: "path",
              required: true,
              schema: { type: "string", enum: ["receipt", "tax-invoice"] },
            },
          ],
          responses: {
            200: {
              description: "The document bytes",
              content: {
                "application/pdf": { schema: { type: "string", format: "binary" } },
                "image/*": { schema: { type: "string", format: "binary" } },
              },
            },
            ...errorResponses(400, 401, 403, 404, 429),
          },
        },
      },
      "/finance/unsettled-orders": {
        get: {
          summary: "Orders with COD collected but not yet settled",
          operationId: "getUnsettledOrders",
          responses: {
            200: { description: "Unsettled order list", content: { "application/json": { schema: { "$ref": "#/components/schemas/UnsettledOrdersResponse" } } } },
            ...errorResponses(401, 403, 429),
          },
        },
      },
      "/billing/status": {
        get: {
          summary: "Account balance, thresholds, and billing state",
          description:
            "`balance` is negative when you owe the office. `state` reflects whether ordering is unrestricted, " +
            "near the warn threshold, or blocked; `amountToClearBlock` is what would lift a block. " +
            "`pendingPaymentAmount` covers claims you have filed that an admin has not yet verified - it is not in `balance` yet.",
          operationId: "getBillingStatus",
          responses: {
            200: { description: "Billing status", content: { "application/json": { schema: { "$ref": "#/components/schemas/BillingStatusResponse" } } } },
            ...errorResponses(401, 403, 429),
          },
        },
      },
      "/billing/payments": {
        get: {
          summary: "Your payment-claim history",
          operationId: "listVendorPayments",
          parameters: queryParams(publicVendorPaymentsQuerySchema),
          responses: {
            200: { description: "Paginated payment claims", content: { "application/json": { schema: { "$ref": "#/components/schemas/VendorPaymentsResponse" } } } },
            ...errorResponses(400, 401, 403, 429),
          },
        },
        post: {
          summary: "File a payment claim",
          description:
            "Records that you have paid the office, optionally with a proof screenshot or PDF (max 5MB; JPG, PNG, WebP, PDF). " +
            "Filing a claim does not change your balance - an admin must verify it first.",
          operationId: "submitVendorPayment",
          parameters: [idempotencyKeyHeader],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["amount"],
                  properties: {
                    amount: { type: "number", exclusiveMinimum: 0, description: "Amount paid, in NPR." },
                    reference: { type: "string", description: "Bank/wallet transaction reference." },
                    note: { type: "string" },
                    method: { type: "string", default: "fonepay" },
                    proof: { type: "string", format: "binary", description: "Screenshot or PDF of the payment confirmation." },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: "Claim filed, pending verification", content: { "application/json": { schema: { "$ref": "#/components/schemas/VendorPaymentResponse" } } } },
            ...errorResponses(400, 401, 403, 422, 429),
          },
        },
      },
      "/billing/qr": {
        get: {
          summary: "The Fonepay QR to pay against",
          description: "Streams the QR image itself, not a JSON envelope. Returns 404 if no QR is configured.",
          operationId: "getPaymentQr",
          responses: {
            200: {
              description: "The QR image bytes",
              content: { "image/*": { schema: { type: "string", format: "binary" } } },
            },
            ...errorResponses(401, 403, 404, 429),
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

        // ── Finance / billing responses ────────────────────────────────────
        // Mirrors server/src/types/finance.type.ts and the VendorPaymentItem /
        // VendorBillingStatus interfaces, minus the internal upload paths the
        // public controllers strip.
        PaginationMeta: {
          type: "object",
          properties: {
            page: { type: "integer" },
            pageSize: { type: "integer" },
            total: { type: "integer" },
            totalPages: { type: "integer" },
          },
        },
        PendingCodResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                vendor: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    name: { type: "string" },
                    phone: { type: "string" },
                    email: { type: ["string", "null"] },
                    address: { type: ["string", "null"] },
                  },
                },
                statementDate: { type: "string", format: "date-time" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      orderNumber: { type: "integer" },
                      trackingId: { type: "string" },
                      receiverName: { type: "string" },
                      receiverPhone: { type: "string" },
                      destination: { type: "string" },
                      codAmount: { type: "number" },
                      deliveryCharge: { type: "number" },
                    },
                  },
                },
                totals: {
                  type: "object",
                  properties: {
                    totalCod: { type: "number" },
                    deliveryCharges: { type: "number" },
                    payableAmount: { type: "number" },
                  },
                },
              },
            },
          },
        },
        OrderCodListResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid", description: "The COD collection id." },
                  trackingId: { type: "string" },
                  receiverName: { type: "string" },
                  receiverPhone: { type: "string" },
                  createdAt: { type: "string", format: "date-time" },
                  deliveredAt: { type: ["string", "null"], format: "date-time" },
                  status: { type: "string", enum: ["settled", "not_settled"] },
                  netPayable: { type: "number", description: "Cash collected minus the delivery charge." },
                },
              },
            },
            settledCount: { type: "integer" },
            notSettledCount: { type: "integer" },
            meta: { "$ref": "#/components/schemas/PaginationMeta" },
          },
        },
        SettlementListResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  statementId: { type: "string" },
                  payeeType: { type: "string", enum: ["vendor"] },
                  payeeName: { type: "string" },
                  payeePhone: { type: "string" },
                  bankName: { type: ["string", "null"] },
                  bankAccountNo: { type: ["string", "null"] },
                  bankAccountHolder: { type: ["string", "null"] },
                  transferDate: { type: ["string", "null"], format: "date-time" },
                  createdAt: { type: "string", format: "date-time" },
                  orderCount: { type: "integer" },
                  amount: { type: "number" },
                  status: { type: "string", enum: ["pending", "settled", "cancelled"] },
                  remark: { type: ["string", "null"] },
                },
              },
            },
            meta: { "$ref": "#/components/schemas/PaginationMeta" },
          },
        },
        SettlementDetailResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                id: { type: "string", format: "uuid" },
                statementId: { type: "string" },
                payeeType: { type: "string", enum: ["vendor"] },
                payeeId: { type: "string", format: "uuid" },
                payeeName: { type: "string" },
                payeePhone: { type: "string" },
                payeeEmail: { type: ["string", "null"] },
                payeeAddress: { type: ["string", "null"] },
                payeePan: { type: ["string", "null"] },
                bankName: { type: ["string", "null"] },
                bankAccountNo: { type: ["string", "null"] },
                bankAccountHolder: { type: ["string", "null"] },
                transferDate: { type: ["string", "null"], format: "date-time" },
                createdAt: { type: "string", format: "date-time" },
                amount: { type: "number" },
                payableAmount: { type: "number" },
                status: { type: "string", enum: ["pending", "settled", "cancelled"] },
                paymentMethod: { type: ["string", "null"] },
                payments: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      method: { type: "string", enum: ["cash", "online"] },
                      amount: { type: "number" },
                    },
                  },
                },
                remark: { type: ["string", "null"] },
                paymentReceiptPath: {
                  type: ["string", "null"],
                  description: "Internal path; fetch the file via GET /finance/settlements/{id}/documents/receipt.",
                },
                taxInvoicePath: {
                  type: ["string", "null"],
                  description: "Internal path; fetch the file via GET /finance/settlements/{id}/documents/tax-invoice.",
                },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      codCollectionId: { type: "string", format: "uuid" },
                      orderNumber: { type: "integer" },
                      trackingId: { type: "string" },
                      reference: { type: ["string", "null"] },
                      receiverName: { type: "string" },
                      receiverPhone: { type: "string" },
                      receiverAddress: { type: ["string", "null"] },
                      orderType: { type: "string" },
                      isReturnToVendor: { type: "boolean" },
                      pieces: { type: "integer" },
                      weightKg: { type: ["number", "null"] },
                      codAmount: { type: "number" },
                      collectedAmount: { type: "number" },
                      deliveryCharge: { type: "number" },
                      settledAmount: { type: "number" },
                      deliveredAt: { type: ["string", "null"], format: "date-time" },
                    },
                  },
                },
              },
            },
          },
        },
        UnsettledOrdersResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      codCollectionId: { type: "string", format: "uuid" },
                      orderNumber: { type: "integer" },
                      trackingId: { type: "string" },
                      receiverName: { type: "string" },
                      receiverPhone: { type: "string" },
                      receiverAddress: { type: ["string", "null"] },
                      destination: { type: "string" },
                      orderType: { type: "string" },
                      isReturnToVendor: {
                        type: "boolean",
                        description: "True both for genuine return orders and for deliveries bounced back to you.",
                      },
                      codAmount: { type: "number", description: "Declared COD on the parcel - informational." },
                      collectedAmount: { type: "number", description: "Cash actually collected." },
                      deliveryCharge: { type: "number" },
                      netPayable: { type: "number" },
                    },
                  },
                },
                totalCod: { type: "number" },
                totalDeliveryCharge: { type: "number" },
                totalNetPayable: { type: "number" },
              },
            },
          },
        },
        BillingStatusResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: {
              type: "object",
              properties: {
                vendorId: { type: "string", format: "uuid" },
                state: { type: "string", description: "Whether ordering is unrestricted, near the warn threshold, or blocked." },
                codCollected: { type: "number", description: "Lifetime COD collected on your parcels." },
                deliveryCharges: { type: "number", description: "Lifetime delivery charges earned by the office." },
                payouts: { type: "number", description: "Lifetime net already paid out to you via settled statements." },
                paymentsReceived: { type: "number", description: "Lifetime verified payments you have made to the office." },
                balance: { type: "number", description: "Negative means you owe the office." },
                warnThreshold: { type: "number" },
                blockThreshold: { type: "number" },
                amountToClearBlock: { type: "number" },
                pendingPaymentAmount: { type: "number", description: "Filed claims not yet verified; not counted in balance." },
                paymentNote: { type: ["string", "null"] },
              },
            },
          },
        },
        VendorPayment: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            vendorId: { type: "string", format: "uuid" },
            vendorName: { type: "string" },
            amount: { type: "number" },
            method: { type: "string" },
            reference: { type: ["string", "null"] },
            hasProof: { type: "boolean", description: "Whether a proof file was attached to the claim." },
            status: { type: "string", enum: ["pending", "verified", "rejected"] },
            note: { type: ["string", "null"] },
            reviewRemark: { type: ["string", "null"] },
            reviewedAt: { type: ["string", "null"], format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        VendorPaymentsResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            data: { type: "array", items: { "$ref": "#/components/schemas/VendorPayment" } },
            meta: { "$ref": "#/components/schemas/PaginationMeta" },
          },
        },
        VendorPaymentResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            message: { type: "string" },
            data: { "$ref": "#/components/schemas/VendorPayment" },
          },
        },
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
