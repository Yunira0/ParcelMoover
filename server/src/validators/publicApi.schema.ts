import { z } from "zod";
import { createOrderSchema, PARCEL_STATUSES } from "./order.schema";
import { createTicketSchema } from "./ticket.schema";
import { optionalUuidSchema, paginationQuerySchema } from "./common";

// Public partner API (/api/v1) request shapes. Kept separate from the internal
// order schemas so the public contract can stay stable even if internal
// endpoints evolve.

// Accepts either a real location UUID or a hub name/code (e.g. "POKHARA" -
// the same names GET /api/v1/rates lists and the same ones the Excel bulk
// rate import matches against). Kept permissive at the schema layer since
// only the database knows which names are real; resolveDestinationRef in
// delivery-rate.service.ts does the actual strict lookup before the value
// ever reaches the internal (UUID-only) order-creation service.
const hubReferenceSchema = z
  .string()
  .trim()
  .min(1, "must not be empty")
  .max(100, "must not exceed 100 characters");

// vendorId and deliveryCharge are staff-side fields: the vendor is derived
// from the API key, and vendor delivery charges are always server-quoted.
// sender is optional here (unlike the internal schema): when omitted, the
// controller fills it from the key owner's vendor profile via getSenderProfile.
export const publicCreateOrderSchema = createOrderSchema
  .omit({
    vendorId: true,
    deliveryCharge: true,
  })
  .extend({
    sender: createOrderSchema.shape.sender.optional(),
    receiver: createOrderSchema.shape.receiver.extend({
      locationId: hubReferenceSchema.optional(),
    }),
    destinationLocationId: hubReferenceSchema.optional(),
  });

export type PublicCreateOrderInput = z.infer<typeof publicCreateOrderSchema>;

export const publicListOrdersQuerySchema = paginationQuerySchema.extend({
  pageSize: z.coerce
    .number()
    .int("pageSize must be an integer")
    .min(1, "pageSize must be at least 1")
    .max(100, "pageSize cannot exceed 100")
    .optional(),
  status: z
    .preprocess((val) => {
      if (!val) return undefined;
      const raw = Array.isArray(val) ? val : String(val).split(",");
      return raw.map((s) => String(s).trim()).filter(Boolean);
    }, z.array(z.enum(PARCEL_STATUSES)).optional())
    .optional(),
});

export type PublicListOrdersQuery = z.infer<typeof publicListOrdersQuerySchema>;

// ── Rate quote ────────────────────────────────────────────────────────────────

export const publicQuoteQuerySchema = z.object({
  destinationLocationId: hubReferenceSchema,
  weightKg: z.coerce.number().positive("weightKg must be greater than 0").optional(),
  serviceType: z.enum(["home_delivery", "branch_delivery"]).optional(),
});

export type PublicQuoteQuery = z.infer<typeof publicQuoteQuerySchema>;

// ── Cancel order ──────────────────────────────────────────────────────────────

export const publicCancelOrderSchema = z.object({
  reason: z.string().trim().max(500, "reason must not exceed 500 characters").optional(),
});

export type PublicCancelOrderInput = z.infer<typeof publicCancelOrderSchema>;

// ── Bulk status lookup ────────────────────────────────────────────────────────

export const publicBulkStatusSchema = z.object({
  trackingIds: z
    .array(z.string())
    .min(1, "trackingIds must include at least one tracking id")
    .max(100, "trackingIds cannot exceed 100 per request"),
});

export type PublicBulkStatusInput = z.infer<typeof publicBulkStatusSchema>;

// ── Order remarks (comments) ──────────────────────────────────────────────────

export const publicAddRemarkSchema = z.object({
  remark: z.string().trim().min(1, "remark is required").max(2000, "remark must not exceed 2000 characters"),
  parentRemarkId: optionalUuidSchema,
});

export type PublicAddRemarkInput = z.infer<typeof publicAddRemarkSchema>;

// ── Tickets ───────────────────────────────────────────────────────────────────

// assignedTo/status are staff-side ticket-routing fields; parcelId isn't
// exposed publicly today because the internal ticket read shape doesn't
// surface it back anywhere either (dashboard or API) - wiring only the
// write side would be a half-finished link.
export const publicCreateTicketSchema = createTicketSchema.omit({
  assignedTo: true,
  status: true,
  parcelId: true,
});

export type PublicCreateTicketInput = z.infer<typeof publicCreateTicketSchema>;

export const publicTicketReplySchema = z.object({
  message: z.string().trim().min(1, "message is required").max(2000, "message must not exceed 2000 characters"),
});

export type PublicTicketReplyInput = z.infer<typeof publicTicketReplySchema>;
