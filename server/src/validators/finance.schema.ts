import { z } from "zod";
import { paginationQuerySchema, optionalUuidSchema, isoDateStringSchema, uuidSchema } from "./common";

const PAYEE_TYPES = ["rider", "vendor"] as const;

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

export const settlementsQuerySchema = paginationQuerySchema.extend({
  payeeType: z.enum(PAYEE_TYPES),
  targetId: optionalUuidSchema,
  fromDate: isoDateStringSchema,
  toDate: isoDateStringSchema,
});

export type SettlementsQuery = z.infer<typeof settlementsQuerySchema>;

// ── Create settlement (body) ──────────────────────────────────────────────────

export const createSettlementSchema = z.object({
  payeeType: z.enum(PAYEE_TYPES),
  targetId: uuidSchema,
  codCollectionIds: z.array(uuidSchema).min(1, "At least one order must be selected"),
  settlementDate: z.string().min(1, "settlementDate is required"),
});

export const paySettlementSchema = z.object({
  payments: z
    .array(
      z.object({
        // Method names are configurable (Cash, Online, eSewa, Bank, ...); the
        // service validates the value against the currently-active methods.
        method: z.string().trim().min(1, "Payment method is required").max(40),
        amount: z.number().positive("Payment amount must be greater than 0"),
      }),
    )
    .min(1, "At least one payment is required"),
  remark: z.string().trim().min(1, "Remark is required").max(500),
});

export type CreateSettlementBody = z.infer<typeof createSettlementSchema>;

// ── Edit settlement (body) — only while the statement is still unsettled ─────

export const updateSettlementSchema = z.object({
  codCollectionIds: z.array(uuidSchema).min(1, "At least one order must be selected"),
});

// ── Notification list query ───────────────────────────────────────────────────

export const notificationQuerySchema = paginationQuerySchema;

export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
