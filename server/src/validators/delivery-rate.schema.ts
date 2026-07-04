import { z } from "zod";
import { uuidSchema } from "./common";

// ── Upsert delivery rate ──────────────────────────────────────────────────────

export const upsertDeliveryRateSchema = z.object({
  originLocationId: uuidSchema,
  destinationLocationId: uuidSchema,
  baseCharge: z.coerce
    .number()
    .min(0, "baseCharge cannot be negative"),
  extraWeightPercent: z.coerce
    .number()
    .min(0)
    .max(100, "extraWeightPercent must be between 0 and 100")
    .optional(),
  freeWeightKg: z.coerce.number().min(0, "freeWeightKg cannot be negative").optional(),
});

export type UpsertDeliveryRateInput = z.infer<typeof upsertDeliveryRateSchema>;

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
