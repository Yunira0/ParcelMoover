import { z } from "zod";
import { uuidSchema } from "./common";

const NCM_DELIVERY_TYPES = ["Door2Door", "Branch2Door", "Branch2Branch", "Door2Branch"] as const;

export const ncmHandoffSchema = z.object({
  parcelIds: z.array(uuidSchema).min(1, "At least one parcel id is required").max(100),
  deliveryType: z.enum(NCM_DELIVERY_TYPES).optional(),
});

export const ncmWebhookRegisterSchema = z.object({
  publicBaseUrl: z.string().trim().url("publicBaseUrl must be an absolute URL"),
});

// NCM's own ticket message cap is 500 chars; matched here since the return
// comment is stored as an NCM comment the same way.
export const ncmReturnSchema = z.object({
  comment: z.string().trim().min(1, "A reason is required").max(500),
});
