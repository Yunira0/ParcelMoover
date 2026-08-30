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

// The account and party settlement ledgers allow a bigger page than other
// lists: a printable ledger sheet asks for everything in its (usually short,
// deliberately chosen) date range in one request rather than paging through a
// document meant to be printed whole. 2000 matches the row cap the endpoint
// used to hard-code before it had real pagination.
const ledgerPageSizeSchema = z.coerce.number().int().positive().max(2000).optional();

export const accountLedgerQuerySchema = rangeQuerySchema.extend({
  page: pageSchema,
  pageSize: ledgerPageSizeSchema,
});

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

// ── Masters ─────────────────────────────────────────────────────────────────

const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
const NORMAL_SIDES = ["debit", "credit"] as const;
const PARTY_TYPES = ["vendor", "rider", "payment_method", "location", "user"] as const;
// What an account is - the only classification a caller picks. `type` and
// `normalSide` are derived from it by masters.service, which is also where a
// contradicting `type` is rejected: that check needs both values and an error
// message worth reading.
const ACCOUNT_CLASSES = [
  "fixed_asset",
  "intangible_asset",
  "current_asset",
  "long_term_liability",
  "current_liability",
  "capital",
  "reserves",
  "direct_income",
  "indirect_income",
  "direct_expense",
  "indirect_expense",
] as const;

export const createAccountSchema = z.object({
  // Digits only: the chart sorts by code everywhere, and a code that is not a
  // number sorts somewhere nobody expects.
  code: z.string().trim().regex(/^\d{3,6}$/, "An account code is 3 to 6 digits, e.g. 1200"),
  name: z.string().trim().min(2, "Give the account a name").max(120),
  subType: z.enum(ACCOUNT_CLASSES),
  // Both derived from `subType`. Still accepted so an existing caller keeps
  // working, and checked against the class rather than silently dropped.
  type: z.enum(ACCOUNT_TYPES).optional(),
  normalSide: z.enum(NORMAL_SIDES).optional(),
  parentCode: z.string().trim().regex(/^\d{3,6}$/).nullish(),
  description: z.string().trim().max(500).nullish(),
  isControl: z.boolean().optional(),
  subledgerType: z.enum(PARTY_TYPES).nullish(),
});

export const updateAccountSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).nullish(),
    parentCode: z.string().trim().regex(/^\d{3,6}$/).nullish(),
    isActive: z.boolean().optional(),
    // Accepted, but the service refuses them once anything has been posted -
    // changing either reinterprets every existing line. See masters.service.ts.
    type: z.enum(ACCOUNT_TYPES).optional(),
    normalSide: z.enum(NORMAL_SIDES).optional(),
    subType: z.enum(ACCOUNT_CLASSES).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to change" });

/**
 * An opening balance. `amount` is signed from the account's own side, so a rider
 * already holding cash is positive and a vendor already owed is negative.
 *
 * `reference` doubles as the identity: posting the same reference to the same
 * account twice is one opening balance, not two.
 */
export const openingBalanceSchema = z.object({
  accountCode: z.string().trim().regex(/^\d{3,6}$/, "An account code is 3 to 6 digits"),
  amount: z.coerce.number().refine((value) => value !== 0, "An opening balance of zero is nothing to record"),
  asOf: z.coerce.date(),
  partyType: z.enum(["vendor", "rider"]).nullish(),
  partyId: z.string().uuid().nullish(),
  reference: z.string().trim().min(2, "Say what this opening balance stands for").max(120),
}).refine((body) => Boolean(body.partyType) === Boolean(body.partyId), {
  message: "Name both the party type and the party, or neither",
  path: ["partyId"],
});
