import { z } from "zod";

// ── Primitives ────────────────────────────────────────────────────────────────

export const nameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(100, "Name must not exceed 100 characters");

// A person's name: must start with a letter, then only letters, combining marks
// (Devanagari matras), spaces, and . ' ’ - . Rejects digit-only or symbol junk
// like "123" that a plain length check let through, while accepting Nepali
// script and names like "St. Xavier's" / "O’Brien". Used for user account names
// (fullName); order sender/receiver names keep the looser nameSchema since a
// receiver can be a business like "Store 24".
export const NAME_RE = /^\p{L}[\p{L}\p{M}\s.'’-]*$/u;

export const personNameSchema = nameSchema.regex(
  NAME_RE,
  "Name can only contain letters, spaces, and . ' -",
);

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
  // 500 matches the largest page the lists offer (see the per-service
  // MAX_PAGE_SIZE constants, which clamp anything above their own ceiling).
  // This is only the outer bound on what the API will parse — an endpoint whose
  // service caps lower still returns its own maximum.
  pageSize: z.coerce
    .number()
    .int("pageSize must be an integer")
    .min(1, "pageSize must be at least 1")
    .max(500, "pageSize cannot exceed 500")
    .optional(),
});

export const isoDateStringSchema = z
  .string()
  .datetime({ message: "Must be a valid ISO-8601 datetime string", offset: true })
  .optional();

// Accepts either a bare "YYYY-MM-DD" (what date-only pickers like
// NepaliDatePicker emit) or a full ISO-8601 datetime. Use this instead of
// isoDateStringSchema for any fromDate/toDate pair fed by a date-only picker -
// the stricter schema silently 400s those requests since it requires a time
// component, exactly like the server's own `new Date(raw)` parsing already
// tolerates either form.
export const flexibleDateStringSchema = z
  .string()
  .refine((val) => !Number.isNaN(Date.parse(val)), { message: "Must be a valid date" })
  .optional();

// A bare calendar day, the only form the date pickers emit. Kept strict (no
// datetime) because the values are bucketed against Nepal-local days, and a
// caller passing an instant would silently mean a different window.
export const dayStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Must be a YYYY-MM-DD date" })
  .optional();

export const uuidParamSchema = z.object({
  id: uuidSchema,
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
