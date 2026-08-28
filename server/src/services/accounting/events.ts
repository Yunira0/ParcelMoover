// Where operational events become journal entries.
//
// One function per money event, each taking the rows it needs rather than
// re-querying, so the same mapping serves both the live posting path (called
// inside the event's own transaction) and the historical backfill.
//
// The four events below are the whole of the current money flow:
//
//   1. A rider remits to the office  COD comes in and is owed on to vendors
//   2. A vendor settlement           COD goes out, the office keeps its cut
//   3. A vendor payment is verified  cash moves from the vendor to the office
//   4. An expense is recorded        cash leaves the office
//
// Note what is absent: individual parcels. Nothing is posted when a rider
// collects COD or when a parcel is delivered - only a statement moves the
// books. Delivering ten thousand parcels writes no journal entries; settling
// them writes one per statement. The operational tables (cod_collections,
// parcels.delivery_charge) remain the record of what is owed in the meantime,
// and billing.service derives every vendor balance from them.
//
// Read together the entries say: COD is never the office's money. It arrives
// as cash matched by an equal liability (2005 COD to Pay to Vendor), and the
// only part the office ever keeps - recognised on the statement that settles
// it - is the delivery charge.
import { Prisma } from "../../generated/prisma/client";
import type { ledger_party_type } from "../../generated/prisma/enums";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { ACCOUNT, cashAccountForMethod, type MethodAccounts } from "./accounts";
import { postJournal, type JournalLineInput, type PostOutcome } from "./posting.service";

export type { PostOutcome };

type Db = Prisma.TransactionClient | typeof prisma;

// ── Shared shapes ───────────────────────────────────────────────────────────
//
// Structural types, not Prisma model types: each function names exactly the
// columns it reads, so a caller can pass a narrow `select` and the compiler
// still checks it.

// Names are joined in purely so an entry's memo reads as a sentence. A journal
// whose description column says "COD collected on delivery" forty times over is
// a list of nothing - the useful fact is *whose* money moved, and the party id
// on the line is not something a person can read.
//
// Optional everywhere, with the memo falling back to the generic wording, so a
// caller that has not joined the name still posts a valid entry rather than
// failing over a label.
export interface PartyName {
  name: string;
}

export interface VendorName {
  client_name: string;
  business_name: string | null;
}

/** Vendors are known by their business name where they have one. */
export function vendorLabel(vendor: VendorName | null | undefined): string | null {
  if (!vendor) return null;
  return vendor.business_name || vendor.client_name || null;
}

export interface CodCollectionForPosting {
  id: string;
  parcel_id: string;
  vendor_id: string | null;
  rider_id: string | null;
  collected_amount: Prisma.Decimal | number | string;
  collected_at: Date | null;
  created_at: Date;
  riders?: PartyName | null;
}

export interface ParcelForPosting {
  id: string;
  vendor_id: string | null;
  tracking_id: string;
  delivery_charge: Prisma.Decimal | number | string;
  status: string;
  order_type: string;
  delivered_at: Date | null;
  updated_at: Date;
  destination_location_id?: string | null;
  vendors?: VendorName | null;
  /** The sender. On a parcel booked without a vendor, this is the customer. */
  parties_parcels_sender_idToparties?: PartyName | null;
}

export interface SettlementForPosting {
  id: string;
  statement_id: string;
  payee_type: string;
  rider_id: string | null;
  vendor_id: string | null;
  amount: Prisma.Decimal | number | string;
  payable_amount: Prisma.Decimal | number | string | null;
  /**
   * Cash actually recorded against the statement so far. Drives which side of
   * the payout is real money and which is still owed - see
   * describeVendorSettlement. Absent is read as nothing paid.
   */
  paid_amount?: Prisma.Decimal | number | string | null;
  payment_method: string | null;
  payments: Prisma.JsonValue | null;
  settlement_date: Date | null;
  updated_at: Date;
  riders?: PartyName | null;
  vendors?: VendorName | null;
  /** Method name -> account code, so each method books to its own account. */
  methodAccounts?: MethodAccounts | undefined;
  /**
   * How much of this statement's withheld charges came from return legs, so the
   * office's cut can be split between delivery and return revenue. Advisory:
   * sync derives it from the statement's parcels, and describeVendorSettlement
   * clamps it to the authoritative total. Absent means "all delivery revenue".
   */
  return_charges?: Prisma.Decimal | number | string | null;
}

export interface VendorPaymentForPosting {
  id: string;
  vendor_id: string;
  amount: Prisma.Decimal | number | string;
  method: string | null;
  reference: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  vendors?: VendorName | null;
  methodAccounts?: MethodAccounts | undefined;
}

interface PostOptions {
  actorId?: string | null;
}

const decimal = (value: Prisma.Decimal | number | string | null | undefined) =>
  new Prisma.Decimal(value ?? 0);

// Stand-in source_id for entries that have no source row (opening balances).
// See postOpeningBalance for why a NULL will not do. Manual entries keep a NULL
// source_id deliberately - they are *meant* to be repeatable.
export const SYNTHETIC_SOURCE_ID = "00000000-0000-0000-0000-000000000000";

// ── Describe, then post ─────────────────────────────────────────────────────
//
// Each mapping is split in two. `describeX` is a pure function of the source
// row: it says what the ledger *should* contain for that row right now, or why
// it should contain nothing. `postX` is the thin wrapper that writes it.
//
// The split exists because there are two callers with different needs. The
// backfill and the live event hooks want "write this"; sync.ts wants "what
// should be true?", so it can compare against what is already posted and
// reverse or restate as needed. Both must agree on the answer, so there is only
// one place that decides it.

export interface PostingDescriptor {
  entryDate: Date;
  memo: string;
  lines: JournalLineInput[];
}

/** Returned instead of a descriptor when this row should post nothing. */
export interface PostingSkip {
  skip: string;
}

export type Described = PostingDescriptor | PostingSkip;

export function isSkip(described: Described): described is PostingSkip {
  return "skip" in described;
}

/** Where each posting is anchored for idempotency. */
export const SOURCE = {
  codCollected: (collectionId: string) => ({ sourceType: "cod_collection", sourceId: collectionId }),
  deliveryCharge: (parcelId: string) => ({ sourceType: "parcel", sourceId: parcelId }),
  settlement: (settlementId: string) => ({ sourceType: "settlement", sourceId: settlementId }),
  vendorPayment: (paymentId: string) => ({ sourceType: "vendor_payment", sourceId: paymentId }),
  expense: (expenseId: string) => ({ sourceType: "expense", sourceId: expenseId }),
} as const;

export const EVENT_KEY = {
  codCollected: "cod_collected",
  deliveryCharge: "delivery_charge_earned",
  riderRemittance: "rider_remittance",
  vendorSettlement: "vendor_settlement",
  vendorPayment: "payment_verified",
  expense: "expense_recorded",
} as const;

async function write(
  db: Db,
  described: Described,
  anchor: { sourceType: string; sourceId: string },
  eventKey: string,
  options: PostOptions,
): Promise<PostOutcome> {
  if (isSkip(described)) return { skipped: true, reason: described.skip };
  return postJournal(db, {
    ...anchor,
    eventKey,
    entryDate: described.entryDate,
    memo: described.memo,
    lines: described.lines,
    postedBy: options.actorId ?? null,
  });
}

// ── Payment splits ──────────────────────────────────────────────────────────

interface PaymentSplit {
  method: string | null;
  amount: Prisma.Decimal;
}

/**
 * How a settlement's money actually moved, per method.
 *
 * `settlements.payments` is free-form JSON written by payForSettlement. It is
 * validated there to total the payable, but this code also runs over historical
 * rows written before that validation existed, so it falls back to a single
 * split at the header's payment_method rather than trusting the JSON to be
 * present and well-formed.
 */
function paymentSplits(settlement: SettlementForPosting, total: Prisma.Decimal): PaymentSplit[] {
  const raw = settlement.payments;
  if (Array.isArray(raw)) {
    const splits = raw
      .filter((entry): entry is Prisma.JsonObject => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => ({
        method: typeof entry.method === "string" ? entry.method : null,
        amount: new Prisma.Decimal(
          typeof entry.amount === "number" || typeof entry.amount === "string" ? entry.amount : 0,
        ).toDecimalPlaces(2),
      }))
      .filter((split) => !split.amount.isZero());

    const splitTotal = splits.reduce((sum, split) => sum.plus(split.amount), new Prisma.Decimal(0));
    // Only trust the breakdown if it accounts for the whole amount. A partial
    // or corrupted array would otherwise post an unbalanced entry, which the
    // database would reject at COMMIT with a far less useful message.
    if (splits.length > 0 && splitTotal.equals(total)) return splits;
  }

  return [{ method: settlement.payment_method, amount: total }];
}

function cashLines(
  splits: PaymentSplit[],
  side: "debit" | "credit",
  memo: string,
  methodAccounts: MethodAccounts | undefined,
): JournalLineInput[] {
  return splits.map((split) => {
    const accountCode = cashAccountForMethod(split.method, methodAccounts);
    // No family fallback any more: a method with no account of its own has no
    // honest home for the money. Refusing leaves the ledger untouched and says
    // which method needs adding, which beats parking it in a catch-all nobody
    // ever went back to.
    if (!accountCode) {
      throw new AppError(
        500,
        `Payment method "${split.method ?? "(none)"}" has no ledger account, so this payment cannot be posted`,
      );
    }
    return {
      accountCode,
      ...(side === "debit" ? { debit: split.amount } : { credit: split.amount }),
      memo: split.method ? `${memo} (${split.method})` : memo,
    };
  });
}

// ── 3. Rider remits to the office ───────────────────────────────────────────

/**
 * The rider hands over the cash they were carrying.
 *
 *   Dr  1000/1100/... Cash, Bank or Wallet    the office now holds it
 *   Cr  2005 COD to Pay to Vendor              and owes it on to the vendors
 *
 * This is where COD enters the books. Nothing is posted while a rider is out
 * collecting - the statement that brings the cash in is the event, not each
 * individual parcel. The credit sits in COD to Pay to Vendor until a vendor statement
 * hands it on, so 2005's balance is the float the office is sitting on.
 *
 * The rider is tagged on the liability line so their remittance history still
 * reads as theirs, even though 2005 is a pooled account rather than a per-rider
 * control: a rider hands over one sum, not one sum per vendor.
 */
export function describeRiderRemittance(settlement: SettlementForPosting): Described {
  if (settlement.payee_type !== "rider" || !settlement.rider_id) {
    throw new AppError(500, `Settlement ${settlement.statement_id} is not a rider statement`);
  }

  const amount = decimal(settlement.payable_amount ?? settlement.amount);
  if (amount.isZero()) {
    return { skip: "nothing remitted" };
  }
  if (amount.isNegative()) {
    // The rider leg is always the full cash collected; a negative would mean
    // the office owes the rider COD, which the settlement flow cannot produce.
    throw new AppError(500, `Rider statement ${settlement.statement_id} has a negative amount`);
  }

  const rider = { type: "rider" as const, id: settlement.rider_id };

  // As on the vendor side, split by cash actually handed over. What the
  // statement says the rider owes but has not yet paid stays in 1010 Cash with
  // Rider - which is precisely what that account is for: the office's money,
  // still in the rider's pocket.
  const paid = clampShare(decimal(settlement.paid_amount ?? 0), amount);
  const stillWithRider = amount.minus(paid);

  const lines: JournalLineInput[] = [];
  if (!paid.isZero()) {
    lines.push(...cashLines(paymentSplits(settlement, paid), "debit", "COD received", settlement.methodAccounts));
  }
  if (!stillWithRider.isZero()) {
    lines.push({ accountCode: ACCOUNT.CASH_WITH_RIDER, debit: stillWithRider, party: rider, memo: "Still with rider" });
  }
  lines.push({ accountCode: ACCOUNT.COD_HELD, credit: amount, party: rider });

  return {
    entryDate: settlement.settlement_date ?? settlement.updated_at,
    memo: settlement.riders?.name
      ? `COD collected from rider ${settlement.riders.name}`
      : `COD collected from rider, ${settlement.statement_id}`,
    lines,
  };
}

export async function postRiderRemittance(
  db: Db,
  settlement: SettlementForPosting,
  options: PostOptions = {},
): Promise<PostOutcome> {
  return write(db, describeRiderRemittance(settlement), SOURCE.settlement(settlement.id), EVENT_KEY.riderRemittance, options);
}

// ── 4. Vendor settlement paid ───────────────────────────────────────────────

/**
 * The office and the vendor square up.
 *
 * Which way the money goes depends on the sign of the payable - COD collected
 * minus delivery charges:
 *
 *   payable > 0   the office owes the vendor
 *       Dr 2000 Vendor (vendor)  /  Cr cash
 *
 *   payable < 0   delivery charges exceeded the COD, so the vendor pays us
 *       Dr cash  /  Cr 2005 COD to Pay to Vendor (the shortfall comes back to us)
 *
 * payForSettlement already models both directions; this mirrors it rather than
 * inventing a rule of its own.
 */
export function describeVendorSettlement(settlement: SettlementForPosting): Described {
  if (settlement.payee_type !== "vendor" || !settlement.vendor_id) {
    throw new AppError(500, `Settlement ${settlement.statement_id} is not a vendor statement`);
  }

  const gross = decimal(settlement.amount);
  const payable = decimal(settlement.payable_amount ?? settlement.amount);
  // What the office kept: the delivery charges on this statement's parcels.
  // Taken as gross minus payable rather than re-summed from the items, so the
  // entry can never disagree with the statement it is posting.
  const charges = gross.minus(payable);

  if (gross.isZero() && charges.isZero()) {
    // Nothing was collected and nothing was charged. An entry of zero lines
    // would be a lie about an event that had no monetary effect.
    return { skip: "statement moves no money" };
  }

  const vendor = { type: "vendor" as const, id: settlement.vendor_id };

  // The whole cycle in one entry, which is the point: COD comes off the float
  // the rider remittance built up, the office's cut becomes revenue, and the
  // remainder goes out to the vendor.
  const lines: JournalLineInput[] = [];

  if (!gross.isZero()) {
    lines.push({
      accountCode: ACCOUNT.COD_HELD,
      debit: gross,
      party: vendor,
      memo: "COD collected",
    });
  }

  // Split the office's cut between delivery and return revenue. The split is
  // advisory (sync supplies it from the statement's parcels); the total is
  // not, so any remainder lands in delivery revenue and the entry stays
  // balanced whatever the item data says.
  if (!charges.isZero()) {
    const returnShare = clampShare(decimal(settlement.return_charges ?? 0), charges);
    const deliveryShare = charges.minus(returnShare);
    if (!deliveryShare.isZero()) {
      lines.push({ accountCode: ACCOUNT.DELIVERY_REVENUE, credit: deliveryShare, memo: "Delivery charge" });
    }
    if (!returnShare.isZero()) {
      lines.push({ accountCode: ACCOUNT.RETURN_REVENUE, credit: returnShare, memo: "Return charge" });
    }
  }

  // payable > 0: the office pays the vendor out. payable < 0: charges exceeded
  // the COD, so the vendor pays the shortfall in.
  //
  // Split by what has actually been paid. A statement is posted the moment it
  // is created, and at that point no cash has moved - it has no payment method
  // yet, so there is not even an account to credit. The unpaid part is a debt,
  // not a payment, and 2000 Vendor is exactly the account for a debt. As
  // instalments land, syncPosting restates the entry and the balance walks
  // across from 2000 into the real cash accounts.
  //
  // This is also why a part-paid statement can no longer hide: the books move
  // when the money does, not when the status changes.
  if (!payable.isZero()) {
    const magnitude = payable.abs();
    const paid = clampShare(decimal(settlement.paid_amount ?? 0), magnitude);
    const owed = magnitude.minus(paid);
    const side = payable.isPositive() ? "credit" : "debit";

    // Money moves opposite ways depending on which side of the payable this
    // is: the office paying the vendor out, or the vendor paying a shortfall
    // in.
    if (!paid.isZero()) {
      lines.push(
        ...cashLines(
          paymentSplits(settlement, paid),
          side,
          side === "credit" ? "COD paid" : "COD received",
          settlement.methodAccounts,
        ),
      );
    }
    if (!owed.isZero()) {
      lines.push({
        accountCode: ACCOUNT.VENDOR_CONTROL,
        ...(side === "credit" ? { credit: owed } : { debit: owed }),
        party: vendor,
        memo: "Still payable",
      });
    }
  }

  const officePaysVendor = payable.isPositive();
  return {
    entryDate: settlement.settlement_date ?? settlement.updated_at,
    memo: vendorLabel(settlement.vendors)
      ? `${officePaysVendor ? "COD paid to vendor" : "COD recovered from vendor"} ${vendorLabel(settlement.vendors)}`
      : `${officePaysVendor ? "COD paid to vendor" : "COD recovered from vendor"}, ${settlement.statement_id}`,
    lines,
  };
}

/** A share of a total, never negative and never more than the total itself. */
function clampShare(share: Prisma.Decimal, total: Prisma.Decimal): Prisma.Decimal {
  if (share.isNegative()) return new Prisma.Decimal(0);
  return share.greaterThan(total) ? total : share;
}

export async function postVendorSettlement(
  db: Db,
  settlement: SettlementForPosting,
  options: PostOptions = {},
): Promise<PostOutcome> {
  return write(db, describeVendorSettlement(settlement), SOURCE.settlement(settlement.id), EVENT_KEY.vendorSettlement, options);
}

// ── 5. Vendor payment verified ──────────────────────────────────────────────

/**
 * A vendor sends money to the office to clear what they owe.
 *
 *   Dr  cash / bank / wallet
 *   Cr  2000 Vendor  (vendor)
 *
 * Posted on verification, never on submission. An unverified claim must not
 * move the books, for the same reason it must not move the credit-control
 * balance: a blocked vendor could otherwise unblock themselves by claiming a
 * payment they never made.
 */
export function describeVendorPaymentVerified(payment: VendorPaymentForPosting): Described {
  const amount = decimal(payment.amount);
  if (amount.isZero()) {
    return { skip: "zero payment" };
  }

  // As in cashLines: an unknown method has no honest account to receive this.
  const accountCode = cashAccountForMethod(payment.method, payment.methodAccounts);
  if (!accountCode) {
    throw new AppError(
      500,
      `Vendor payment ${payment.id} cannot be posted: payment method "${payment.method ?? "(none)"}" has no ledger account`,
    );
  }

  const reference = payment.reference ? ` ref ${payment.reference}` : "";
  return {
    entryDate: payment.reviewed_at ?? payment.created_at,
    memo: vendorLabel(payment.vendors)
      ? `Payment received from ${vendorLabel(payment.vendors)}${reference}`
      : `Vendor payment received${reference}`,
    lines: [
      {
        accountCode,
        debit: amount,
        memo: payment.method,
      },
      {
        accountCode: ACCOUNT.VENDOR_CONTROL,
        credit: amount,
        party: { type: "vendor", id: payment.vendor_id },
      },
    ],
  };
}

export async function postVendorPaymentVerified(
  db: Db,
  payment: VendorPaymentForPosting,
  options: PostOptions = {},
): Promise<PostOutcome> {
  return write(db, describeVendorPaymentVerified(payment), SOURCE.vendorPayment(payment.id), EVENT_KEY.vendorPayment, options);
}

// ── 6. Expense recorded ─────────────────────────────────────────────────────

export interface ExpenseForPosting {
  id: string;
  expense_no: string;
  expense_date: Date;
  amount: Prisma.Decimal | number | string;
  payee: string | null;
  note: string | null;
  location_id: string | null;
  party_type: ledger_party_type | null;
  party_id: string | null;
  status: string;
  account: { code: string };
  paid_from: { code: string };
}

/**
 * A cost the office paid out of one of its own accounts.
 *
 *   Dr  5xxx the expense category
 *   Cr  1000/1020/1030 whichever pocket it came from
 *
 * The only event in this file with no operational row behind it - rent and fuel
 * are not parcels. That is exactly why the expenses table exists: without it
 * the books could show revenue but never profit.
 */
export function describeExpense(expense: ExpenseForPosting): Described {
  if (expense.status !== "recorded") {
    return { skip: `expense is ${expense.status}` };
  }
  const amount = decimal(expense.amount);
  if (amount.isZero()) {
    return { skip: "zero expense" };
  }

  const payee = expense.payee ? ` - ${expense.payee}` : "";
  return {
    entryDate: expense.expense_date,
    memo: `${expense.expense_no}${payee}`,
    lines: [
      {
        accountCode: expense.account.code,
        debit: amount,
        locationId: expense.location_id,
        memo: expense.note,
        // The party goes on the cost side, not the cash side: the money left
        // the office's own account, but it was spent *on* this person. Tagging
        // it here is what lets one query return a rider's fuel, salary and
        // maintenance alongside the COD they are holding.
        ...(expense.party_type && expense.party_id
          ? { party: { type: expense.party_type, id: expense.party_id } }
          : {}),
      },
      {
        accountCode: expense.paid_from.code,
        credit: amount,
        locationId: expense.location_id,
      },
    ],
  };
}

export async function postExpense(
  db: Db,
  expense: ExpenseForPosting,
  options: PostOptions = {},
): Promise<PostOutcome> {
  return write(db, describeExpense(expense), SOURCE.expense(expense.id), EVENT_KEY.expense, options);
}

// ── Opening balances ────────────────────────────────────────────────────────

/**
 * Establishes a starting position that cannot be reconstructed from source
 * rows, with Opening Balance Equity as the counterweight.
 *
 * Used by the backfill for cash the office already held before the ledger
 * existed. Amounts are signed from the account's own point of view: positive
 * debits the account, negative credits it.
 */
export async function postOpeningBalance(
  db: Db,
  input: {
    accountCode: string;
    amount: Prisma.Decimal | number | string;
    asOf: Date;
    party?: { type: "vendor" | "rider"; id: string };
    reference: string;
    actorId?: string | null;
  },
): Promise<PostOutcome> {
  const amount = decimal(input.amount);
  if (amount.isZero()) {
    return { skipped: true, reason: "zero opening balance" };
  }

  const positive = amount.isPositive();
  const magnitude = amount.abs();

  return postJournal(db, {
    entryDate: input.asOf,
    memo: `Opening balance: ${input.reference}`,
    sourceType: "opening_balance",
    // The sentinel matters. The idempotency index is a plain unique index, and
    // Postgres treats NULLs there as distinct - a NULL source_id would make
    // every opening balance unique to itself and let a re-run of the backfill
    // double the opening position. A fixed non-null id restores the guard,
    // with the reference below carrying the actual identity.
    sourceId: SYNTHETIC_SOURCE_ID,
    eventKey: `opening:${input.accountCode}:${input.reference}`,
    postedBy: input.actorId ?? null,
    lines: [
      {
        accountCode: input.accountCode,
        ...(positive ? { debit: magnitude } : { credit: magnitude }),
        party: input.party,
      },
      {
        accountCode: ACCOUNT.OPENING_BALANCE_EQUITY,
        ...(positive ? { credit: magnitude } : { debit: magnitude }),
      },
    ],
  });
}
