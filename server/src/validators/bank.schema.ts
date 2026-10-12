import { z } from "zod";

const code = z
  .string()
  .trim()
  .min(1, "Bank code is required")
  .max(10)
  .regex(/^[A-Za-z0-9]+$/, "Bank code may only contain letters and digits");

export const createBankSchema = z.object({
  name: z.string().trim().min(1, "Bank name is required").max(100),
  code,
});

export const updateBankSchema = z
  .object({ code: code.optional(), isActive: z.boolean().optional() })
  .refine((body) => body.code !== undefined || body.isActive !== undefined, {
    message: "Nothing to update",
  });
