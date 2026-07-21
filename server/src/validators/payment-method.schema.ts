import { z } from "zod";

export const createPaymentMethodSchema = z.object({
  name: z.string().trim().min(1, "Payment method name is required").max(40),
});

export const updatePaymentMethodSchema = z.object({
  isActive: z.boolean(),
});

export type CreatePaymentMethodBody = z.infer<typeof createPaymentMethodSchema>;
export type UpdatePaymentMethodBody = z.infer<typeof updatePaymentMethodSchema>;
