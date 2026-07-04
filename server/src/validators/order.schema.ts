import { z } from "zod";
import {
  nameSchema,
  phoneSchema,
  emailSchema,
  uuidSchema,
  optionalUuidSchema,
  paginationQuerySchema,
} from "./common";

// ── Enums (must stay in sync with order.type.ts) ──────────────────────────────

const ORDER_TYPES = ["delivery", "exchange", "return"] as const;
const SERVICE_TYPES = ["dtd", "btd", "btb", "dtb"] as const;

export const PARCEL_STATUSES = [
  "pickup_ordered",
  "rider_assigned",
  "picked_up",
  "arrived",
  "ready_to_deliver",
  "sent_for_delivery",
  "oov",
  "dispatched",
  "arrived_at_branch",
  "hold",
  "loss_and_damage",
  "delivered",
  "failed_pickup",
  "failed_delivery",
  "cancelled",
] as const;

// ── Sub-schemas ───────────────────────────────────────────────────────────────

const optionalPhoneSchema = z
  .string()
  .optional()
  .transform((val): string | undefined => {
    const t = val?.trim();
    return t || undefined;
  })
  .pipe(
    z.string().regex(/^\+?[0-9]{10,15}$/, "Alternate phone must be 10–15 digits").optional(),
  );

const optionalStringSchema = z
  .string()
  .optional()
  .transform((val): string | undefined => {
    const t = val?.trim();
    return t || undefined;
  })
  .pipe(z.string().max(255).optional());

const orderPartySchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  alternatePhone: optionalPhoneSchema,
  email: emailSchema,
  address: optionalStringSchema,
  locationId: optionalUuidSchema,
});

// ── Create order ──────────────────────────────────────────────────────────────

export const createOrderSchema = z.object({
  vendorId: optionalUuidSchema,
  sender: orderPartySchema,
  receiver: orderPartySchema,
  originLocationId: optionalUuidSchema,
  destinationLocationId: optionalUuidSchema,
  orderType: z.enum(ORDER_TYPES).optional(),
  serviceType: z.enum(SERVICE_TYPES).optional(),
  pieces: z.number().int("pieces must be an integer").min(1, "pieces must be at least 1").optional(),
  weightKg: z.number().positive("weightKg must be a positive number").optional(),
  codAmount: z.number().min(0, "codAmount cannot be negative").optional(),
  deliveryCharge: z.number().min(0, "deliveryCharge cannot be negative").optional(),
  packageType: z.string().max(50).optional(),
  deliveryInstruction: z.string().max(500).optional(),
  pickupAddress: z.string().max(255).optional(),
  scheduledPickupAt: z.string().datetime({ offset: true }).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// ── Update single order status ────────────────────────────────────────────────

export const updateOrderStatusSchema = z.object({
  status: z.enum(PARCEL_STATUSES, {
    error: "Status is required or invalid",
  }),
  locationId: optionalUuidSchema,
  remarks: z.string().max(500).optional(),
  riderId: optionalUuidSchema,
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

// ── Bulk status update ────────────────────────────────────────────────────────

export const bulkUpdateOrderStatusSchema = z.object({
  ids: z
    .array(uuidSchema, { error: "ids is required" })
    .min(1, "ids must be a non-empty array")
    .max(200, "Cannot update more than 200 orders at once"),
  status: z.enum(PARCEL_STATUSES, {
    error: "Status is required",
  }),
  remarks: z.string().max(500).optional(),
  toLocationId: optionalUuidSchema,
  riderId: optionalUuidSchema,
});

export type BulkUpdateOrderStatusInput = z.infer<typeof bulkUpdateOrderStatusSchema>;

// ── List orders (query params) ────────────────────────────────────────────────

export const listOrdersQuerySchema = paginationQuerySchema.extend({
  status: z
    .preprocess((val) => {
      if (!val) return undefined;
      const raw = Array.isArray(val) ? val : String(val).split(",");
      return raw.map((s) => String(s).trim()).filter(Boolean);
    }, z.array(z.enum(PARCEL_STATUSES)).optional())
    .optional(),
  orderType: z.enum(ORDER_TYPES).optional(),
  search: z.string().max(100).optional(),
});

export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

// ── Rider run sheet (query params) ───────────────────────────────────────────

export const runSheetQuerySchema = z.object({
  // Optional: narrow the list to a single rider.
  riderId: optionalUuidSchema,
  // Optional: which Nepal-local day to list sheets for (defaults to today).
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be in YYYY-MM-DD format")
    .optional(),
});

export type RunSheetQuery = z.infer<typeof runSheetQuerySchema>;

// ── Add remark to an order ────────────────────────────────────────────────────

export const addOrderRemarkSchema = z.object({
  remark: z
    .string()
    .trim()
    .min(1, "Remark cannot be empty")
    .max(1000, "Remark must not exceed 1000 characters"),
  parentRemarkId: optionalUuidSchema,
});

export type AddOrderRemarkInput = z.infer<typeof addOrderRemarkSchema>;
