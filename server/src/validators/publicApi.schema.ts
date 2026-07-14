import { z } from "zod";
import { createOrderSchema, PARCEL_STATUSES } from "./order.schema";
import { paginationQuerySchema } from "./common";

// Public partner API (/api/v1) request shapes. Kept separate from the internal
// order schemas so the public contract can stay stable even if internal
// endpoints evolve.

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
