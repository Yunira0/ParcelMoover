import { z } from "zod";
import { uuidSchema } from "./common";

// ── Upsert delivery rate ──────────────────────────────────────────────────────

export const upsertDeliveryRateSchema = z.object({
  originLocationId: uuidSchema,
  destinationLocationId: uuidSchema,
  baseCharge: z.coerce
    .number()
    .min(0, "baseCharge cannot be negative"),
  branchBaseCharge: z.coerce.number().min(0, "branchBaseCharge cannot be negative").optional().nullable(),
  extraWeightPercent: z.coerce
    .number()
    .min(0)
    .max(100, "extraWeightPercent must be between 0 and 100")
    .optional(),
  freeWeightKg: z.coerce.number().min(0, "freeWeightKg cannot be negative").optional(),
});

export type UpsertDeliveryRateInput = z.infer<typeof upsertDeliveryRateSchema>;

// ── Bulk import delivery rates (from an Excel/CSV upload) ────────────────────
// Rows reference locations by NAME (what a spreadsheet naturally contains);
// the service resolves them to hub location ids case-insensitively.

export const bulkImportDeliveryRatesSchema = z.object({
  rows: z
    .array(
      z.object({
        origin: z.string().trim().min(1, "origin is required").max(100),
        destination: z.string().trim().min(1, "destination is required").max(100),
        baseCharge: z.coerce.number().min(0, "baseCharge cannot be negative"),
        extraWeightPercent: z.coerce
          .number()
          .min(0)
          .max(100, "extraWeightPercent must be between 0 and 100")
          .optional(),
        freeWeightKg: z.coerce.number().min(0, "freeWeightKg cannot be negative").optional(),
      }),
    )
    .min(1, "rows must be a non-empty array")
    .max(500, "Cannot import more than 500 rates at once"),
});

export type BulkImportDeliveryRatesInput = z.infer<typeof bulkImportDeliveryRatesSchema>;

// ── Get delivery quote (query params) ────────────────────────────────────────

export const deliveryQuoteQuerySchema = z.object({
  originLocationId: uuidSchema,
  destinationLocationId: uuidSchema,
  weightKg: z.coerce
    .number()
    .positive("weightKg must be a positive number")
    .optional(),
});

export type DeliveryQuoteQuery = z.infer<typeof deliveryQuoteQuerySchema>;

// ── Toggle rate active state ──────────────────────────────────────────────────

export const setDeliveryRateActiveSchema = z.object({
  isActive: z.boolean({ error: "isActive must be a boolean (true or false)" }),
});

export type SetDeliveryRateActiveInput = z.infer<typeof setDeliveryRateActiveSchema>;
