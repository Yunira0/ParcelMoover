import { z } from "zod";
import { paginationQuerySchema, optionalUuidSchema, isoDateStringSchema } from "./common";

// ── Shared finance query base ─────────────────────────────────────────────────

const financeBaseQuerySchema = paginationQuerySchema.extend({
  vendorId: optionalUuidSchema,
});

// ── Pending COD query ─────────────────────────────────────────────────────────

export const pendingCodQuerySchema = financeBaseQuerySchema;

export type PendingCodQuery = z.infer<typeof pendingCodQuerySchema>;

// ── Order COD list query ──────────────────────────────────────────────────────

const COD_PAYMENT_FILTERS = ["settled", "not_settled"] as const;

export const orderCodQuerySchema = financeBaseQuerySchema.extend({
  status: z.enum(COD_PAYMENT_FILTERS).optional(),
});

export type OrderCodQuery = z.infer<typeof orderCodQuerySchema>;

// ── Settlements list query ────────────────────────────────────────────────────

export const settlementsQuerySchema = financeBaseQuerySchema.extend({
  fromDate: isoDateStringSchema,
  toDate: isoDateStringSchema,
});

export type SettlementsQuery = z.infer<typeof settlementsQuerySchema>;

// ── Notification list query ───────────────────────────────────────────────────

export const notificationQuerySchema = paginationQuerySchema;

export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
