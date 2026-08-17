import { z } from "zod";
import { uuidSchema } from "./common";

// The 5 service types are fixed reference data from Upaya's docs.
const UPAYA_SERVICE_TYPE_IDS = [3, 4, 5, 6, 7] as const;
const UPAYA_ORDER_TYPES = ["delivery", "return", "exchange"] as const;

export const upayaHandoffSchema = z.object({
  parcelIds: z.array(uuidSchema).min(1, "At least one parcel id is required").max(100),
  // Both auto-derived per parcel by default (area from its destination hub
  // via matchUpayaArea, service type from its own service_type via
  // defaultUpayaServiceTypeId) - same as NCM's handoff auto-matching a
  // branch. Overrides are optional escape hatches, not the normal path.
  serviceTypeId: z.coerce
    .number()
    .int()
    .refine((v) => (UPAYA_SERVICE_TYPE_IDS as readonly number[]).includes(v), {
      message: `serviceTypeId must be one of ${UPAYA_SERVICE_TYPE_IDS.join(", ")}`,
    })
    .optional(),
  orderType: z.enum(UPAYA_ORDER_TYPES).optional(),
});
