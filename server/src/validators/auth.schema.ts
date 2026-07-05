import { z } from "zod";
import {
  nameSchema,
  phoneSchema,
  emailSchema,
  requiredEmailSchema,
  passwordSchema,
  optionalUuidSchema,
} from "./common";

// ── Login ─────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: requiredEmailSchema,
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ── Register managed user (admin / vendor / rider) ───────────────────────────

const MANAGED_USER_TYPES = ["admin", "vendor", "rider"] as const;

// Optional string: empty/whitespace → undefined; otherwise trim and enforce max length.
const optionalAuthString = (maxLen: number, customMsg?: string) =>
  z
    .string()
    .optional()
    .transform((val): string | undefined => {
      const t = val?.trim();
      return t || undefined;
    })
    .pipe(z.string().max(maxLen, customMsg).optional());

// Optional string with a minimum length (e.g. clientName must be ≥ 2 chars).
const optionalMinMaxString = (minLen: number, maxLen: number) =>
  z
    .string()
    .optional()
    .transform((val): string | undefined => {
      const t = val?.trim();
      return t || undefined;
    })
    .pipe(z.string().min(minLen).max(maxLen).optional());

export const registerUserSchema = z
  .object({
    type: z.enum(MANAGED_USER_TYPES, {
      error: `type must be one of: ${MANAGED_USER_TYPES.join(", ")}`,
    }),
    fullName: nameSchema,
    email: requiredEmailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    locationId: optionalUuidSchema,
    joinedAt: z
      .union([
        z.literal("").transform(() => undefined),
        z.string().transform((val) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return `${val}T00:00:00Z`;
          return val;
        }).pipe(z.string().datetime({ offset: true })),
        z.undefined(),
      ])
      .optional(),
    // admin-only
    position: optionalAuthString(100, "Position must not exceed 100 characters"),
    // vendor-only
    clientName: optionalMinMaxString(2, 100),
    address: optionalAuthString(255),
    businessName: optionalAuthString(100),
  })
  .superRefine((data, ctx) => {
    if (data.type === "vendor" && !data.clientName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clientName"],
        message: "clientName is required for vendor registration",
      });
    }
  });

export type RegisterUserInput = z.infer<typeof registerUserSchema>;

// ── Update managed user profile ───────────────────────────────────────────────

const optionalAlternatePhone = z
  .string()
  .optional()
  .transform((val): string | undefined => {
    const t = val?.trim();
    return t || undefined;
  })
  .pipe(
    z.string().regex(/^\+?[0-9]{10,15}$/, "Alternate phone must be 10–15 digits").optional(),
  );

export const updateManagedUserSchema = z.object({
  fullName: nameSchema.optional(),
  email: emailSchema,
  phone: phoneSchema.optional(),
  locationId: optionalUuidSchema,
  joinedAt: z
    .union([
      z.literal("").transform(() => undefined),
      z.string().transform((val) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return `${val}T00:00:00Z`;
        return val;
      }).pipe(z.string().datetime({ offset: true })),
      z.undefined(),
    ])
    .optional(),
  // Must match the DB user_status enum (active | inactive) - Prisma rejects other values.
  status: z.enum(["active", "inactive"]).optional(),
  // admin-only
  position: optionalAuthString(100),
  // vendor-only
  clientName: optionalMinMaxString(2, 100),
  address: optionalAuthString(255),
  businessName: optionalAuthString(100),
  alternatePhone: optionalAlternatePhone,
});

export type UpdateManagedUserInput = z.infer<typeof updateManagedUserSchema>;

// ── Update password ───────────────────────────────────────────────────────────

export const updatePasswordSchema = z.object({
  password: passwordSchema,
});

export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
