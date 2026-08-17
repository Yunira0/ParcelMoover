import { z } from "zod";
import { optionalUuidSchema } from "./common";

// A BS period key, `2083-04`. Validated here rather than in the service so a
// typo comes back as a 400 with a useful message instead of reaching the
// calendar conversion.
const periodKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must look like 2083-04")
  .optional();

const fiscalYearSchema = z
  .string()
  .regex(/^\d{4}(\/\d{2})?$/, "fiscalYear must look like 2083 or 2083/84")
  .optional();

const dateSchema = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "must be a valid date")
  .optional();

// The three ways of asking "when". They are mutually exclusive in effect (the
// service reads them in priority order), but accepting all three keeps every
// report endpoint on one query shape.
export const rangeQuerySchema = z.object({
  period: periodKeySchema,
  fiscalYear: fiscalYearSchema,
  from: dateSchema,
  to: dateSchema,
});

const pageSchema = z.coerce.number().int().positive().max(100000).optional();
const pageSizeSchema = z.coerce.number().int().positive().max(200).optional();

const accountCodeSchema = z
  .string()
  .regex(/^\d{3,6}$/, "accountCode must be a numeric account code")
  .optional();

export const journalQuerySchema = rangeQuerySchema.extend({
  page: pageSchema,
  pageSize: pageSizeSchema,
  accountCode: accountCodeSchema,
  sourceType: z.string().max(40).optional(),
  status: z.enum(["posted", "voided", "all"]).optional(),
  search: z.string().max(120).optional(),
});

// The four Transactions screens. `scope` picks the accounts, `direction` picks
// the side: `in` is the debit side of the account, `out` the credit side, which
// is what "receipt" and "payment" mean on a cash book.
export const transactionsQuerySchema = rangeQuerySchema.extend({
  scope: z.enum(["rider-cod", "vendor-cod", "cash", "bank"]),
  accountCode: accountCodeSchema,
  direction: z.enum(["in", "out", "all"]).optional(),
  partyId: optionalUuidSchema,
  page: pageSchema,
  pageSize: pageSizeSchema,
  search: z.string().max(120).optional(),
});

export const partyBalancesQuerySchema = z.object({
  search: z.string().max(120).optional(),
  nonZeroOnly: z.enum(["true", "false"]).optional(),
});

const partyTypeSchema = z.enum(["rider", "vendor", "user"]).optional();

export const expensesQuerySchema = rangeQuerySchema.extend({
  page: pageSchema,
  pageSize: pageSizeSchema,
  accountCode: accountCodeSchema,
  status: z.enum(["recorded", "voided", "all"]).optional(),
  partyType: partyTypeSchema,
  partyId: optionalUuidSchema,
});

export const partySearchQuerySchema = z.object({
  q: z.string().trim().min(2, "Type at least two characters").max(80),
});

export const createExpenseSchema = z.object({
  accountCode: z.string().regex(/^\d{3,6}$/, "Pick an expense category"),
  paidFromCode: z.string().regex(/^\d{3,6}$/, "Pick the account this was paid from"),
  // Two decimals, matching the column. Rejecting more precision here is kinder
  // than silently rounding it away.
  amount: z.number().positive("Amount must be greater than zero").max(99_999_999),
  expenseDate: z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), "Pick a valid date"),
  payee: z.string().max(160).optional(),
  reference: z.string().max(160).optional(),
  note: z.string().max(500).optional(),
  locationId: optionalUuidSchema,
  // Who it was spent on. Both halves or neither - a party id with no type
  // cannot be joined to anything.
  partyType: partyTypeSchema,
  partyId: optionalUuidSchema,
});

export const voidExpenseSchema = z.object({
  reason: z.string().trim().min(3, "Say why this is being voided").max(500),
});

export const setPeriodStatusSchema = z.object({
  status: z.enum(["open", "closed"]),
});

// One side per line, enforced here as well as in the posting engine so the
// error arrives attached to the field the user typed it in.
const manualLineSchema = z
  .object({
    accountCode: z.string().regex(/^\d{3,6}$/, "Pick an account"),
    debit: z.number().nonnegative().max(99_999_999).optional(),
    credit: z.number().nonnegative().max(99_999_999).optional(),
    partyType: z.enum(["vendor", "rider", "payment_method", "location", "user"]).optional(),
    partyId: optionalUuidSchema,
    memo: z.string().max(300).optional(),
  })
  .refine((line) => Boolean(line.debit) !== Boolean(line.credit), {
    message: "Each line takes either a debit or a credit, not both",
  });

export const createManualEntrySchema = z
  .object({
    entryDate: z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), "Pick a valid date"),
    memo: z.string().trim().min(3, "Describe what this entry is for").max(500),
    lines: z.array(manualLineSchema).min(2, "A journal entry needs at least two lines").max(50),
  })
  .refine(
    (entry) => {
      // Compared in paisa so the check is exact - summing floats and comparing
      // for equality is how a balanced entry ends up rejected.
      const debits = entry.lines.reduce((sum, line) => sum + Math.round((line.debit ?? 0) * 100), 0);
      const credits = entry.lines.reduce((sum, line) => sum + Math.round((line.credit ?? 0) * 100), 0);
      return debits === credits && debits > 0;
    },
    { message: "Debits and credits must add up to the same non-zero total", path: ["lines"] },
  );

export const reverseEntrySchema = z.object({
  reason: z.string().trim().min(3, "Say why this entry is being reversed").max(500),
});
