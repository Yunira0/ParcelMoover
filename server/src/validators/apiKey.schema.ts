import { z } from "zod";

export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must not exceed 100 characters"),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
