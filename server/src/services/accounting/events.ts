// Where operational events become journal entries.
//
// One function per money event, each taking the rows it needs rather than
// re-querying, so the same mapping serves both the live posting path (called
// inside the event's own transaction) and the historical backfill.
//
// The five events below are the whole of the current money flow:
//
//   1. A rider collects COD          cash moves from the receiver to the rider
//   2. A parcel earns its charge     the office earns revenue from the vendor
//   3. A rider remits to the office  cash moves from the rider to the office
//   4. A vendor settlement is paid   cash moves between the office and vendor
//   5. A vendor payment is verified  cash moves from the vendor to the office
//
// Read together they say: COD is never the office's money. It arrives as an
// asset (cash held by a rider) matched by an equal liability (owed to the
// vendor), and the only part the office ever keeps is the delivery charge.
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
  payment_method: string | null;
  payments: Prisma.JsonValue | null;
  settlement_date: Date | null;
  updated_at: Date;
  riders?: PartyName | null;
  vendors?: VendorName | null;
  /** Method name -> account code, so each method books to its own account. */
  methodAccounts?: MethodAccounts | undefined;
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

// ── 1. COD collected ────────────────────────────────────────────────────────

/**
 * Cash the receiver handed to the rider.
 *
 *   Dr  1010 Cash with Rider   (rider)     the office's asset, in the rider's pocket
 *   Cr  2000 Vendor    (vendor)    and immediately owed to the vendor
 *
 * Deliberately not revenue: none of this money is the office's. The office's
 * share is taken out separately by postDeliveryChargeEarned.
 *
 * Soft deletion is the caller's problem, not this function's. billing.service
 * scopes a vendor's balance to `deleted_at IS NULL`, so soft-deleting a parcel
 * silently removes its COD and charge from that balance - which means the code
 * that soft-deletes a parcel must reverse this entry (and the charge entry) or
 * the ledger will drift from it. The backfill handles this by never posting
 * deleted parcels in the first place; the live path will need the reversal.
 */
export function describeCodCollected(collection: CodCollectionForPosting): Described {
  const amount = decimal(collection.collected_amount);
  if (amount.isZero()) {
    return { skip: "no cash collected" };
  }
  if (!collection.rider_id) {
    // Cash with Rider is a control account, so a missing rider would leave the
    // amount in the account total but in nobody's subledger - and "somebody is
    // holding this money, we just don't know who" is not something the books
    // can usefully say.
    throw new AppError(500, `COD collection ${collection.id} cannot be posted: it has no rider`);
  }

  // Same reasoning as the rider check above: 2000 is a control account, so the
  // credit side has to name the vendor it is owed to. A collection with no
  // vendor has nowhere to put the money that the books can make sense of.
  if (!collection.vendor_id) {
    throw new AppError(500, `COD collection ${collection.id} cannot be posted: it has no vendor`);
  }

  const owed = {
    accountCode: ACCOUNT.VENDOR_CONTROL,
    party: { type: "vendor" as const, id: collection.vendor_id },
  };

  return {
    entryDate: collection.collected_at ?? collection.created_at,
    memo: collection.riders?.name ? `COD collected from ${collection.riders.name}` : "COD collected on delivery",
    lines: [
      {
        accountCode: ACCOUNT.CASH_WITH_RIDER,
        debit: amount,
        party: { type: "rider", id: collection.rider_id },
        parcelId: collection.parcel_id,
      },
      { ...owed, credit: amount, parcelId: collection.parcel_id },
    ],
  };
}

export async function postCodCollected(
  db: Db,
  collection: CodCollectionForPosting,
  options: PostOptions = {},
): Promise<PostOutcome> {
  return write(db, describeCodCollected(collection), SOURCE.codCollected(collection.id), EVENT_KEY.codCollected, options);
}

// ── 2. Delivery charge earned ───────────────────────────────────────────────

// The TypeScript mirror of EARNED_CHARGE_SQL in billing.service.ts - the two
// must say the same thing, or the ledger and the vendor balance will disagree
// about which parcels have earned their charge. (BALANCE_AFFECTING_STATUSES in
// that file is the same mirroring pattern.)
//
// Note what is absent: a parcel that fails delivery and goes RTO keeps its
// original outbound charge on the row, so counting every returned_to_vendor
// parcel would bill the vendor a full delivery for a parcel never delivered.
// Only parcels whose order_type is already `return` carry a correctly priced
// return charge. Plain RTO handling is therefore free here, exactly as it is
// in the balance - changing that is a pricing decision, not a ledger one.
export function hasEarnedDeliveryCharge(parcel: { status: string; order_type: string }): boolean {
  if (parcel.status === "delivered" || parcel.status === "partially_delivered") return true;
  return parcel.order_type === "return" && parcel.status === "returned_to_vendor";
}

/**
 * The office's cut, earned the moment the service is performed.
 *
 *   Dr  2000 Vendor  (vendor)   reduces what we owe them
 *   Cr  4000 Delivery Revenue           and books it as income
 *
 * For a vendor shipping zero-COD parcels there is no COD credit to net against,
 * so this drives their control balance debit-side - which is the ledger saying
 * the vendor owes the office. That is the normal, expected direction, and it is
 * the same sign convention the credit-control thresholds already use.
 */
/**
 * Who the charge is billed to, named in the order we can name them.
 *
 * The tracking id stays on the line itself in every case, so leading with a
 * person or a business costs nothing and reads as what happened.
 */
function chargeMemo(parcel: ParcelForPosting): string {
  const vendor = vendorLabel(parcel.vendors);
  if (vendor) return `Delivery charge from ${vendor}`;

  // Every posted parcel has a vendor, so reaching here means the vendor row
  // simply was not loaded with the parcel. The sender is the next best name.
  const sender = parcel.parties_parcels_sender_idToparties?.name;
  if (sender) return `Delivery charge from ${sender}`;

  return `Delivery charge earned on ${parcel.tracking_id}`;
}

export function describeDeliveryChargeEarned(parcel: ParcelForPosting): Described {
  const amount = decimal(parcel.delivery_charge);
  if (amount.isZero()) {
    return { skip: "no delivery charge" };
  }
  if (!hasEarnedDeliveryCharge(parcel)) {
    return { skip: `status ${parcel.status} has not earned its charge` };
  }
  // As in describeCodCollected: no vendor means no account to charge it to.
  if (!parcel.vendor_id) {
    throw new AppError(500, `Parcel ${parcel.id} cannot be posted: it has no vendor`);
  }

  const charged = {
    accountCode: ACCOUNT.VENDOR_CONTROL,
    party: { type: "vendor" as const, id: parcel.vendor_id },
  };

  // Redirect charges are folded into parcels.delivery_charge by order.service
  // and are not separable here, so they land in delivery revenue rather than
  // in 4010. Splitting them is a change to the charge calculation, not
  // something this mapping can infer after the fact.
  const revenueAccount = parcel.order_type === "return" ? ACCOUNT.RETURN_REVENUE : ACCOUNT.DELIVERY_REVENUE;

  return {
    entryDate: parcel.delivered_at ?? parcel.updated_at,
    memo: chargeMemo(parcel),
    lines: [
      { ...charged, debit: amount, parcelId: parcel.id },
      {
        accountCode: revenueAccount,
        credit: amount,
        parcelId: parcel.id,
        locationId: parcel.destination_location_id ?? null,
      },
    ],
  };
}

export async function postDeliveryChargeEarned(
  db: Db,
  parcel: ParcelForPosting,
  options: PostOptions = {},
): Promise<PostOutcome> {
  return write(db, describeDeliveryChargeEarned(parcel), SOURCE.deliveryCharge(parcel.id), EVENT_KEY.deliveryCharge, options);
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
 *   Dr  1000/1020/1030 Cash, Bank or Wallet   the office now holds it
 *   Cr  1010 Cash with Rider   (rider)        the rider no longer does
 *
 * Both sides are assets - this moves money between the office's own pockets and
 * touches neither revenue nor the vendor's position. A rider's remaining 1010
 * balance is the cash still in their hands.
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

  return {
    entryDate: settlement.settlement_date ?? settlement.updated_at,
    memo: settlement.riders?.name
      ? `Rider remittance from ${settlement.riders.name}`
      : `Rider remittance ${settlement.statement_id}`,
    lines: [
      ...cashLines(paymentSplits(settlement, amount), "debit", `Remittance ${settlement.statement_id}`, settlement.methodAccounts),
      {
        accountCode: ACCOUNT.CASH_WITH_RIDER,
        credit: amount,
        party: { type: "rider", id: settlement.rider_id },
      },
    ],
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
 *       Dr cash  /  Cr 2000 Vendor (vendor)
 *
 * payForSettlement already models both directions; this mirrors it rather than
 * inventing a rule of its own.
 */
export function describeVendorSettlement(settlement: SettlementForPosting): Described {
  if (settlement.payee_type !== "vendor" || !settlement.vendor_id) {
    throw new AppError(500, `Settlement ${settlement.statement_id} is not a vendor statement`);
  }

  const payable = decimal(settlement.payable_amount ?? settlement.amount);
  if (payable.isZero()) {
    // A statement whose COD exactly covered its charges. Nothing moved, so
    // there is nothing to post - and an entry of two zero lines would be a
    // lie about an event that had no monetary effect.
    return { skip: "payable nets to zero" };
  }

  const magnitude = payable.abs();
  const officePaysVendor = payable.isPositive();
  const splits = paymentSplits(settlement, magnitude);
  const label = `Settlement ${settlement.statement_id}`;

  return {
    entryDate: settlement.settlement_date ?? settlement.updated_at,
    // The statement id stays on the cash lines (see cashLines), so leading
    // with the vendor costs nothing and reads as what happened.
    memo: vendorLabel(settlement.vendors)
      ? `${officePaysVendor ? "Vendor payout" : "Vendor recovery"} - ${vendorLabel(settlement.vendors)}`
      : `${officePaysVendor ? "Vendor payout" : "Vendor recovery"} ${settlement.statement_id}`,
    lines: officePaysVendor
      ? [
          {
            accountCode: ACCOUNT.VENDOR_CONTROL,
            debit: magnitude,
            party: { type: "vendor", id: settlement.vendor_id },
          },
          ...cashLines(splits, "credit", label, settlement.methodAccounts),
        ]
      : [
          ...cashLines(splits, "debit", label, settlement.methodAccounts),
          {
            accountCode: ACCOUNT.VENDOR_CONTROL,
            credit: magnitude,
            party: { type: "vendor", id: settlement.vendor_id },
          },
        ],
  };
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
