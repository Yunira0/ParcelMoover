import { z } from "zod";

// ── Primitives ────────────────────────────────────────────────────────────────

export const nameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(100, "Name must not exceed 100 characters");

// Enforces a Nepali mobile number: 10 digits starting 97/98, optional +977
// country code. Only surrounding whitespace is trimmed - internal spaces,
// dashes or any other character are rejected, not silently stripped.
export const phoneSchema = z
  .string()
  .transform((val) => val.trim())
  .pipe(
    z
      .string()
      .regex(/^(?:\+?977)?9[78]\d{8}$/, "Enter a valid Nepali mobile number (e.g. 98XXXXXXXX)"),
  );

// Optional email: empty string or undefined → undefined; otherwise validate
export const emailSchema = z
  .string()
  .optional()
  .transform((val): string | undefined => {
    const t = val?.trim().toLowerCase();
    return t || undefined;
  })
  .pipe(z.string().email("Invalid email address").optional());

export const requiredEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters");

// Accepts any 8-4-4-4-12 hex UUID format (including manually-seeded IDs
// that don't comply with RFC 4122 version/variant bits).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Required UUID: plain string regex – no union, no transforms.
export const uuidSchema = z.string().superRefine((val, ctx) => {
  if (!UUID_RE.test(val)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Must be a valid UUID" });
  }
});

// Optional UUID: empty string or undefined → undefined; non-empty string must be a UUID.
export const optionalUuidSchema = z
  .string()
  .optional()
  .transform((val): string | undefined => val === "" ? undefined : val)
  .pipe(z.string().superRefine((val, ctx) => {
    if (!UUID_RE.test(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Must be a valid UUID" });
    }
  }).optional());

// ── Shared query-param building blocks ───────────────────────────────────────

export const paginationQuerySchema = z.object({
  page: z.coerce
    .number()
    .int("page must be an integer")
    .min(1, "page must be at least 1")
    .optional(),
  pageSize: z.coerce
    .number()
    .int("pageSize must be an integer")
    .min(1, "pageSize must be at least 1")
    .max(200, "pageSize cannot exceed 200")
    .optional(),
});

export const isoDateStringSchema = z
  .string()
  .datetime({ message: "Must be a valid ISO-8601 datetime string", offset: true })
  .optional();

export const uuidParamSchema = z.object({
  id: uuidSchema,
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
