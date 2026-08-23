// The chart of accounts, and how the rest of the system names accounts.
//
// Codes follow the conventional blocks - 1xxx asset, 2xxx liability, 3xxx
// equity, 4xxx revenue, 5xxx expense - so a reader who has seen any other set
// of books can find their way around this one.
//
// Two of these are *control* accounts: their balance is only meaningful broken
// down per party. 1010 answers "how much of our cash is in which rider's
// pocket right now", and 2000 answers "what is our position with each vendor".
// Everything else is a plain account.
import { ledger_account_type, ledger_normal_side, ledger_party_type } from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";

type Db = Prisma.TransactionClient | typeof prisma;

export const ACCOUNT = {
  CASH_IN_HAND: "1000",
  CASH_WITH_RIDER: "1010",
  COD_HELD: "2005",
  VENDOR_CONTROL: "2000",
  OPENING_BALANCE_EQUITY: "3000",
  RETAINED_EARNINGS: "3900",
  DELIVERY_REVENUE: "4000",
  REDIRECT_REVENUE: "4010",
  RETURN_REVENUE: "4020",
  RIDER_COMMISSION: "5000",
  FUEL_AND_VEHICLE: "5100",
  VEHICLE_MAINTENANCE: "5110",
  OFFICE_RENT: "5200",
  OFFICE_EXPENSES: "5210",
  SALARIES: "5300",
  COD_WRITE_OFF: "5900",
} as const;

export type AccountCode = (typeof ACCOUNT)[keyof typeof ACCOUNT];

export interface AccountDefinition {
  code: string;
  name: string;
  type: ledger_account_type;
  normalSide: ledger_normal_side;
  isControl?: boolean;
  subledgerType?: ledger_party_type;
  description: string;
}

export const CHART_OF_ACCOUNTS: AccountDefinition[] = [
  // ── Assets ────────────────────────────────────────────────────────────────
  {
    code: ACCOUNT.CASH_IN_HAND,
    name: "Cash in Hand",
    type: "asset",
    normalSide: "debit",
    description: "Physical cash held at an office or branch, after riders remit it.",
  },
  {
    code: ACCOUNT.CASH_WITH_RIDER,
    name: "Cash with Rider",
    type: "asset",
    normalSide: "debit",
    isControl: true,
    subledgerType: "rider",
    description:
      "COD a rider has collected but not yet remitted. Still ours, just not in our hands - the per-rider balance is the cash that rider owes the office right now.",
  },
  // Every other place money sits - Prabhu Bank, Kumari Bank, a wallet - is an
  // account created with its payment method, not one listed here. There are no
  // "Bank" or "Digital Wallet" family accounts to fall into: a method either has
  // its own account or its payments do not post at all.

  // ── Liabilities ───────────────────────────────────────────────────────────
  {
    code: ACCOUNT.COD_HELD,
    name: "COD Held for Vendors",
    type: "liability",
    normalSide: "credit",
    description:
      "COD taken in from riders but not yet passed on to vendors. Credited when a rider settles their collections to the office, debited when a vendor statement hands that money on. The balance is the float the office is sitting on: cash in our hands that is not ours. Deliberately not a control account - a rider remits one pooled sum that no single vendor can be named against.",
  },
  {
    code: ACCOUNT.VENDOR_CONTROL,
    name: "Vendor",
    type: "liability",
    normalSide: "credit",
    isControl: true,
    subledgerType: "vendor",
    description:
      "Direct position with each vendor, outside the COD cycle: credited with payments they send the office. A credit balance is money we owe them; a debit balance is money they owe us. Note that day-to-day COD and delivery charges do not pass through here - they are recognised on the statement that settles them, against COD Held for Vendors.",
  },

  // ── Equity ────────────────────────────────────────────────────────────────
  {
    code: ACCOUNT.OPENING_BALANCE_EQUITY,
    name: "Opening Balance Equity",
    type: "equity",
    normalSide: "credit",
    description:
      "Counterweight for balances that predate the ledger and cannot be reconstructed from source rows. Should be closed to retained earnings once the opening position is agreed.",
  },
  {
    code: ACCOUNT.RETAINED_EARNINGS,
    name: "Retained Earnings",
    type: "equity",
    normalSide: "credit",
    description: "Accumulated profit carried forward from closed fiscal years.",
  },

  // ── Revenue ───────────────────────────────────────────────────────────────
  {
    code: ACCOUNT.DELIVERY_REVENUE,
    name: "Delivery Charge Revenue",
    type: "revenue",
    normalSide: "credit",
    description: "Delivery charges earned on delivered and partially delivered parcels.",
  },
  {
    code: ACCOUNT.REDIRECT_REVENUE,
    name: "Redirect Charge Revenue",
    type: "revenue",
    normalSide: "credit",
    description:
      "Charges for redirecting a parcel after booking. Not yet posted to: parcel_redirects folds its charge into parcels.delivery_charge, so the two are indistinguishable in the data until order.service separates them.",
  },
  {
    code: ACCOUNT.RETURN_REVENUE,
    name: "Return Charge Revenue",
    type: "revenue",
    normalSide: "credit",
    description: "Charges earned on return orders, priced at the vendor's return percentage.",
  },

  // ── Expenses ──────────────────────────────────────────────────────────────
  {
    code: ACCOUNT.RIDER_COMMISSION,
    name: "Rider Commission & Incentives",
    type: "expense",
    normalSide: "debit",
    description: "Per-delivery commission and incentives paid to riders.",
  },
  {
    code: ACCOUNT.FUEL_AND_VEHICLE,
    name: "Fuel & Vehicle",
    type: "expense",
    normalSide: "debit",
    description: "Fuel, servicing and vehicle running costs.",
  },
  {
    code: ACCOUNT.VEHICLE_MAINTENANCE,
    name: "Vehicle Maintenance & Repairs",
    type: "expense",
    normalSide: "debit",
    description:
      "Servicing, repairs, tyres and parts. Kept apart from fuel because one is a running cost that tracks distance and the other is lumpy and per-bike - averaging them together hides which bike is expensive.",
  },
  {
    code: ACCOUNT.OFFICE_RENT,
    name: "Office & Branch Rent",
    type: "expense",
    normalSide: "debit",
    description: "Rent for offices, hubs and branches.",
  },
  {
    code: ACCOUNT.OFFICE_EXPENSES,
    name: "Office Expenses & Utilities",
    type: "expense",
    normalSide: "debit",
    description: "Electricity, internet, stationery, packaging, tea - the day-to-day cost of keeping an office open.",
  },
  {
    code: ACCOUNT.SALARIES,
    name: "Salaries & Wages",
    type: "expense",
    normalSide: "debit",
    description: "Staff payroll, excluding rider commission.",
  },
  {
    code: ACCOUNT.COD_WRITE_OFF,
    name: "COD Loss & Write-off",
    type: "expense",
    normalSide: "debit",
    description: "COD that will not be recovered - lost, damaged or written-off parcels.",
  },
];

// ── Payment method routing ──────────────────────────────────────────────────

/** Lowercased method name -> the account code its money lands in. */
export type MethodAccounts = ReadonlyMap<string, string>;

/**
 * Whether a method name means physical cash.
 *
 * The one name still matched by pattern rather than by row, because "Cash" is
 * the only method that maps to an account in the chart itself. Everything else
 * is a bank or a wallet and owns an account created alongside it.
 */
export function isCashMethod(method: string | null | undefined): boolean {
  return /\bcash\b|hand/.test((method ?? "").trim().toLowerCase());
}

/**
 * Which account a settlement or vendor payment lands in, or null if the method
 * has no account of its own.
 *
 * Every method an admin adds gets its own account, so "Prabhu Bank" and "Kumari
 * Bank" report separate balances that each reconcile against their own
 * statement. There is deliberately no family fallback: guessing that an
 * unrecognised name is "a bank" told us the money was somewhere without telling
 * us where, and a catch-all account collected exactly the payments nobody had
 * decided about.
 *
 * Null means the caller must refuse to post. The money is real and it went
 * somewhere; the books just cannot say where until the method exists.
 */
export function cashAccountForMethod(
  method: string | null | undefined,
  methodAccounts?: MethodAccounts | undefined,
): string | null {
  const normalized = (method ?? "").trim().toLowerCase();
  if (!normalized) return null;

  const owned = methodAccounts?.get(normalized);
  if (owned) return owned;

  // A method literally called "Cash" adopts 1000 whether or not the row has
  // caught up, which keeps a fresh install posting before any backfill runs.
  return isCashMethod(normalized) ? ACCOUNT.CASH_IN_HAND : null;
}

/**
 * The method-name -> account-code map, read fresh.
 *
 * Deliberately not cached. Unlike the chart of accounts, this changes whenever
 * an admin adds a payment method, and a stale map would route that method's
 * first payments into the wrong account - the one error this whole change
 * exists to remove. It is one indexed read per posting batch.
 */
export async function loadMethodAccounts(db: Db): Promise<MethodAccounts> {
  const rows = await db.payment_methods.findMany({
    where: { ledger_account_id: { not: null } },
    select: { name: true, ledger_account: { select: { code: true } } },
  });

  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.ledger_account) map.set(row.name.trim().toLowerCase(), row.ledger_account.code);
  }
  return map;
}

/**
 * Makes sure a payment method has an account, creating one if it does not.
 *
 * Idempotent, and safe to call on every read: a method that already has an
 * account short-circuits on the first check.
 *
 * "Cash" keeps the account its money is already in - 1000, not a fresh 1102 -
 * because splitting a live balance across two accounts to tidy up the numbering
 * would be a strictly worse set of books. Every other method gets a generated
 * account of its own.
 */
export async function ensureMethodAccount(
  db: Db,
  method: { id: string; name: string; ledger_account_id: string | null },
): Promise<string> {
  if (method.ledger_account_id) return method.ledger_account_id;

  // Cash is the one method named in the chart itself, so it adopts 1000 rather
  // than generating a duplicate of it.
  if (isCashMethod(method.name)) {
    const cash = await db.ledger_accounts.findUnique({ where: { code: ACCOUNT.CASH_IN_HAND } });
    if (cash) {
      const alreadyTaken = await db.payment_methods.findFirst({
        where: { ledger_account_id: cash.id, id: { not: method.id } },
        select: { id: true },
      });
      if (!alreadyTaken) {
        await db.payment_methods.update({ where: { id: method.id }, data: { ledger_account_id: cash.id } });
        return cash.id;
      }
    }
  }

  const numbered = await db.$queryRaw<Array<{ code: string }>>`
    SELECT nextval('payment_account_code_seq')::text AS code
  `;

  const created = await db.ledger_accounts.create({
    data: {
      code: numbered[0]!.code,
      name: method.name,
      type: "asset",
      normal_side: "debit",
      // Flat, not parented. The family accounts these used to roll up into are
      // gone; each method stands on its own next to Cash in Hand.
      parent_id: null,
      description: `Money received through ${method.name}. Created automatically with the payment method.`,
    },
  });

  await db.payment_methods.update({ where: { id: method.id }, data: { ledger_account_id: created.id } });
  clearAccountCache();
  return created.id;
}

// ── Lookup ──────────────────────────────────────────────────────────────────

export interface ResolvedAccount {
  id: string;
  code: string;
  isControl: boolean;
  subledgerType: ledger_party_type | null;
}

// Account rows are created once by the seed and then effectively frozen: a
// code's id never changes, because nothing in the system deletes and recreates
// an account (journal_lines reference it with ON DELETE NO ACTION). A plain
// process-local map is therefore enough - no TTL to tune, and no Redis round
// trip on the posting hot path.
const accountCache = new Map<string, ResolvedAccount>();

export function clearAccountCache(): void {
  accountCache.clear();
}

/**
 * Resolves account codes to rows, reading through the cache.
 *
 * Takes the caller's transaction client so a posting inside a transaction sees
 * accounts created earlier in that same transaction (which the seed and the
 * tests both rely on).
 */
export async function resolveAccounts(db: Db, codes: readonly string[]): Promise<Map<string, ResolvedAccount>> {
  const wanted = Array.from(new Set(codes));
  const resolved = new Map<string, ResolvedAccount>();
  const missing: string[] = [];

  for (const code of wanted) {
    const cached = accountCache.get(code);
    if (cached) resolved.set(code, cached);
    else missing.push(code);
  }

  if (missing.length > 0) {
    const rows = await db.ledger_accounts.findMany({
      where: { code: { in: missing } },
      select: { id: true, code: true, is_control: true, subledger_type: true, is_active: true },
    });

    for (const row of rows) {
      if (!row.is_active) {
        throw new AppError(400, `Ledger account ${row.code} is inactive and cannot be posted to`);
      }
      const account: ResolvedAccount = {
        id: row.id,
        code: row.code,
        isControl: row.is_control,
        subledgerType: row.subledger_type,
      };
      accountCache.set(row.code, account);
      resolved.set(row.code, account);
    }
  }

  const unknown = wanted.filter((code) => !resolved.has(code));
  if (unknown.length > 0) {
    throw new AppError(
      500,
      `Unknown ledger account code(s): ${unknown.join(", ")}. Run "npm run seed:accounting" to install the chart of accounts.`,
    );
  }

  return resolved;
}
