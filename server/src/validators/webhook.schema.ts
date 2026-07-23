import { z } from "zod";
import { uuidSchema } from "./common";

// Event types vendors can currently subscribe to. Kept as a whitelist so a
// typo in eventTypes fails loudly instead of silently matching nothing.
export const WEBHOOK_EVENT_TYPES = ["order.status_changed"] as const;

const eventTypesField = z
  .array(z.enum(WEBHOOK_EVENT_TYPES))
  .max(WEBHOOK_EVENT_TYPES.length)
  .optional();

export const createWebhookEndpointSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must not exceed 100 characters"),
  url: z
    .string()
    .trim()
    .min(1, "URL is required")
    .max(2048, "URL must not exceed 2048 characters"),
  eventTypes: eventTypesField,
});

export const updateWebhookEndpointSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  url: z.string().trim().min(1).max(2048).optional(),
  eventTypes: eventTypesField,
  enabled: z.boolean().optional(),
});

export const listDeliveriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const deliveryParamSchema = z.object({
  id: uuidSchema,
  deliveryId: uuidSchema,
});

export type CreateWebhookEndpointInput = z.infer<typeof createWebhookEndpointSchema>;
export type UpdateWebhookEndpointInput = z.infer<typeof updateWebhookEndpointSchema>;
