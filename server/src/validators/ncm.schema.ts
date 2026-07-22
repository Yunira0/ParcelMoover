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
