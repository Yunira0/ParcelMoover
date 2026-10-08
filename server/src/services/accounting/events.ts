// Where operational events become journal entries.
//
// One function per money event, each taking the rows it needs rather than
// re-querying, so the same mapping serves both the live posting path (called
// inside the event's own transaction) and the historical backfill.
//
// The five events below are the whole of the current money flow:
//
//   1. A rider remits to the office  COD comes in and is owed on to vendors
//   2. A vendor settlement           COD goes out, the office keeps its cut
//   3. A vendor payment is verified  cash moves from the vendor to the office
//   4. An expense is recorded        cash leaves the office
//   5. A branch settlement           a branch sends its COD on to head office
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
  /** Prepaid charges handed back on this statement, already inside payable_amount. */
  vendor_credit_applied?: Prisma.Decimal | number | string | null;
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
  /**
   * A rider statement's COD per vendor, so 2005 is credited to each vendor it
   * is owed to. Advisory like return_charges: clamped to the statement total,
   * and anything it doesn't cover stays tagged to the rider.
   */
  vendor_shares?: VendorShares;
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
  branchSettlement: (settlementId: string) => ({ sourceType: "branch_settlement", sourceId: settlementId }),
  carrierSettlement: (settlementId: string) => ({ sourceType: "carrier_settlement", sourceId: settlementId }),
} as const;

export const EVENT_KEY = {
  codCollected: "cod_collected",
  deliveryCharge: "delivery_charge_earned",
  riderRemittance: "rider_remittance",
  vendorSettlement: "vendor_settlement",
  vendorPayment: "payment_verified",
  expense: "expense_recorded",
  branchSettlement: "branch_settlement",
  carrierSettlement: "carrier_settlement",
  // A statement and each instalment against it post separately - see
  // "Statements and their instalments" below. The four keys above are the
  // older one-entry-per-statement postings, still live on statements posted
  // before the split.
  riderStatement: "rider_statement",
  vendorStatement: "vendor_statement",
  branchStatement: "branch_statement",
  carrierStatement: "carrier_statement",
} as const;

/** The event key of one instalment's posting, anchored on its statement. */
export const instalmentEventKey = (statementKey: string, instalmentId: string) =>
  `${statementKey}_payment:${instalmentId}`;

/** Every instalment key of a statement starts with this. */
export const instalmentKeyPrefix = (statementKey: string) => `${statementKey}_payment:`;

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
function paymentSplits(
  settlement: Pick<SettlementForPosting, "payments" | "payment_method">,
  total: Prisma.Decimal,
): PaymentSplit[] {
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

type VendorShares = Array<{ vendorId: string; amount: Prisma.Decimal | number | string }> | undefined;

/**
 * The 2005 credit when COD comes in, one line per vendor it is owed to, so each
 * vendor's 2005 nets against the debit their own statement posts. In vendor
 * order so the lines (and the restatement fingerprint) are stable. Clamped to
 * the total; whatever the shares don't account for goes to `rest`.
 */
function codHeldLines(
  total: Prisma.Decimal,
  shares: VendorShares,
  rest: JournalLineInput["party"],
  memo?: string,
): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  let unassigned = total;
  for (const share of [...(shares ?? [])].sort((a, b) => a.vendorId.localeCompare(b.vendorId))) {
    const credit = clampShare(decimal(share.amount), unassigned);
    if (credit.isZero()) continue;
    unassigned = unassigned.minus(credit);
    lines.push({ accountCode: ACCOUNT.COD_HELD, credit, party: { type: "vendor", id: share.vendorId }, memo });
  }
  if (!unassigned.isZero()) lines.push({ accountCode: ACCOUNT.COD_HELD, credit: unassigned, party: rest, memo });
  return lines;
}

// ── 3. Rider remits to the office ───────────────────────────────────────────

/**
 * The rider hands over the cash they were carrying.
 *
 *   Dr  1000/1100/... Cash, Bank or Wallet    the office now holds it   (rider)
 *   Cr  2005 COD to Pay to Vendor              one line per vendor        (vendor)
 *
 * This is where COD enters the books. Nothing is posted while a rider is out
 * collecting - the statement that brings the cash in is the event, not each
 * individual parcel. The credit sits in COD to Pay to Vendor until a vendor
 * statement hands it on, so 2005's balance is the float the office is sitting
 * on - and, split per vendor, what it is holding for each one. The vendor
 * statement's 2005 debit is tagged the same way, so the two net per vendor.
 *
 * The rider is tagged on the cash side, so their remittance history still
 * reads as theirs.
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
    lines.push(
      ...cashLines(paymentSplits(settlement, paid), "debit", "COD received", settlement.methodAccounts).map(
        (line) => ({ ...line, party: rider }),
      ),
    );
  }
  if (!stillWithRider.isZero()) {
    lines.push({ accountCode: ACCOUNT.CASH_WITH_RIDER, debit: stillWithRider, party: rider, memo: "Still with rider" });
  }

  lines.push(...codHeldLines(amount, settlement.vendor_shares, rider));

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
  // Prepaid charges handed back: the vendor's Billing payment sits as a credit
  // in 2000 (describeVendorPaymentVerified), and this statement uses it up.
  const credit = decimal(settlement.vendor_credit_applied ?? 0);
  // What the office kept: the delivery charges on this statement's parcels.
  // Taken from the statement's own totals rather than re-summed from the items,
  // so the entry can never disagree with the statement it is posting. The
  // credit is inside payable, so it is added back to recover the charges.
  const charges = gross.minus(payable).plus(credit);

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

  if (!credit.isZero()) {
    lines.push({ accountCode: ACCOUNT.VENDOR_CONTROL, debit: credit, party: vendor, memo: "Prepaid charges applied" });
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

// ── 5b. Branch settlement ───────────────────────────────────────────────────

export interface BranchSettlementForPosting {
  id: string;
  statement_no: string;
  from_branch_id: string;
  to_branch_id: string;
  gross_cod: Prisma.Decimal | number | string;
  commission_amount: Prisma.Decimal | number | string;
  net_payable: Prisma.Decimal | number | string;
  paid_amount: Prisma.Decimal | number | string;
  payment_method: string | null;
  payments: Prisma.JsonValue | null;
  settlement_date: Date;
  from_branch?: PartyName | null;
  methodAccounts?: MethodAccounts | undefined;
}

/**
 * A branch hands the COD it collected on to head office, keeping its commission.
 *
 *   Dr  5010 Branch Commission            the branch's cut
 *   Dr  cash / bank / wallet               what head office has received
 *   Dr  1015 COD with Branch (branch)      what the branch still owes
 *   Cr  1000 Cash in Hand (at the branch)  the COD leaving the branch's cash
 *
 * No 2005 line, deliberately: the COD already entered the books when the
 * branch's riders remitted it (describeRiderRemittance), and a vendor statement
 * at head office takes it off 2005 later. This entry only moves the cash from
 * the branch to head office, minus what the branch keeps.
 *
 * Posted when the statement is created and restated as instalments land, the
 * same way describeVendorSettlement walks its balance from 2000 into cash.
 */
export function describeBranchSettlement(settlement: BranchSettlementForPosting): Described {
  const commission = decimal(settlement.commission_amount);
  const net = decimal(settlement.net_payable);
  if (commission.isZero() && net.isZero()) {
    return { skip: "statement moves no money" };
  }

  const branch = { type: "location" as const, id: settlement.from_branch_id };
  const paid = clampShare(decimal(settlement.paid_amount), net);
  const owed = net.minus(paid);

  const lines: JournalLineInput[] = [];
  if (!commission.isZero()) {
    lines.push({
      accountCode: ACCOUNT.BRANCH_COMMISSION,
      debit: commission,
      party: branch,
      locationId: settlement.from_branch_id,
      memo: "Branch commission",
    });
  }
  if (!paid.isZero()) {
    lines.push(
      ...cashLines(paymentSplits(settlement, paid), "debit", "COD received from branch", settlement.methodAccounts).map(
        (line) => ({ ...line, party: branch, locationId: settlement.to_branch_id }),
      ),
    );
  }
  if (!owed.isZero()) {
    lines.push({ accountCode: ACCOUNT.COD_WITH_BRANCH, debit: owed, party: branch, memo: "Still with branch" });
  }
  // Commission plus net rather than gross_cod, so the entry balances by
  // construction even if the stored gross ever drifts from its parts.
  lines.push({
    accountCode: ACCOUNT.CASH_IN_HAND,
    credit: commission.plus(net),
    party: branch,
    locationId: settlement.from_branch_id,
    memo: "COD held at branch",
  });

  return {
    entryDate: settlement.settlement_date,
    memo: settlement.from_branch?.name
      ? `COD remitted by branch ${settlement.from_branch.name}, ${settlement.statement_no}`
      : `COD remitted by branch, ${settlement.statement_no}`,
    lines,
  };
}

// ── 5c. 3PL carrier settlement ──────────────────────────────────────────────

export interface CarrierSettlementForPosting {
  id: string;
  statement_no: string;
  carrier_code: string;
  gross_cod: Prisma.Decimal | number | string;
  carrier_charges: Prisma.Decimal | number | string;
  net_receivable: Prisma.Decimal | number | string;
  paid_amount: Prisma.Decimal | number | string;
  payment_method: string | null;
  payments: Prisma.JsonValue | null;
  settlement_date: Date;
  methodAccounts?: MethodAccounts | undefined;
  /** The statement's COD per vendor; see SettlementForPosting.vendor_shares. */
  vendor_shares?: VendorShares;
}

/**
 * A 3PL carrier hands over the COD it collected, keeping its delivery charge.
 *
 *   Dr  5020 3PL Delivery Charge    the carrier's cut
 *   Dr  cash / bank / wallet        what we have received
 *   Dr  1020 COD with 3PL           what the carrier still owes
 *   Cr  2005 COD to Pay to Vendor   the COD, one line per vendor it is owed to
 *
 * This is where carrier-collected COD enters the float, the way a rider
 * remittance brings in our own riders' cash. Posted when the statement is
 * created and restated as instalments land.
 */
export function describeCarrierSettlement(settlement: CarrierSettlementForPosting): Described {
  const gross = decimal(settlement.gross_cod);
  const charges = decimal(settlement.carrier_charges);
  const net = decimal(settlement.net_receivable);
  if (gross.isZero()) return { skip: "statement moves no money" };

  const paid = clampShare(decimal(settlement.paid_amount), net);
  const owed = net.minus(paid);
  const lines: JournalLineInput[] = [];
  if (!charges.isZero()) {
    lines.push({ accountCode: ACCOUNT.CARRIER_CHARGE, debit: charges, memo: `${settlement.carrier_code.toUpperCase()} delivery charge` });
  }
  if (!paid.isZero()) {
    lines.push(...cashLines(paymentSplits(settlement, paid), "debit", "COD received from 3PL", settlement.methodAccounts));
  }
  if (!owed.isZero()) {
    lines.push({ accountCode: ACCOUNT.COD_WITH_CARRIER, debit: owed, memo: "Still with 3PL" });
  }
  lines.push(...codHeldLines(gross, settlement.vendor_shares, undefined, "COD collected by 3PL"));

  return {
    entryDate: settlement.settlement_date,
    memo: `COD remitted by ${settlement.carrier_code.toUpperCase()}, ${settlement.statement_no}`,
    lines,
  };
}

export async function postBranchSettlement(
  db: Db,
  settlement: BranchSettlementForPosting,
  options: PostOptions = {},
): Promise<PostOutcome> {
  return write(db, describeBranchSettlement(settlement), SOURCE.branchSettlement(settlement.id), EVENT_KEY.branchSettlement, options);
}

// ── Statements and their instalments ────────────────────────────────────────
//
// A statement posts once, as a debt: what it says is owed and by whom, with no
// cash in it. Each instalment then posts on its own, for its own amount, on the
// day it was paid - moving that much off the debt and into cash or bank.
//
// The one-entry postings above carry both in a single entry, restated on every
// instalment, which left a reversal in the journal per payment. Here paying
// adds one entry and touches nothing already posted; a reversal only appears
// when something posted was actually wrong - an edited statement, a reverted
// payment, a cancellation.
//
// The split never moves a balance: a statement plus its instalments posts what
// the one-entry form posted at the same paid amount, line for line.

export interface InstalmentForPosting {
  id: string;
  amount: Prisma.Decimal | number | string;
  /** Summary of the instalment's methods; the fallback when `breakdown` doesn't add up. */
  method: string | null;
  /** The {method, amount} lines of this instalment. */
  breakdown: Prisma.JsonValue | null;
  paid_at: Date;
}

/** One instalment's share of its statement, ready to describe. */
export interface AllocatedInstalment {
  id: string;
  amount: Prisma.Decimal;
  method: string | null;
  breakdown: Prisma.JsonValue | null;
  paidAt: Date;
}

/** Id of the share of a statement's paid amount that no instalment row accounts for. */
export const UNRECORDED_INSTALMENT = "unrecorded";

/**
 * Shares out what a statement has been paid across its instalments, oldest first.
 *
 * The total is the header's paid amount clamped to what the statement can
 * absorb - the figure the one-entry postings used - so the split cannot move a
 * balance. An instalment past that cap posts only what fits. Paid money with no
 * instalment row behind it is kept as one `unrecorded` share at the header's
 * own methods rather than dropped.
 */
export function allocateInstalments(
  statement: { paid_amount?: Prisma.Decimal | number | string | null; payment_method: string | null; payments: Prisma.JsonValue | null },
  instalments: InstalmentForPosting[],
  cap: Prisma.Decimal,
  unrecordedDate: Date,
): AllocatedInstalment[] {
  let remaining = clampShare(decimal(statement.paid_amount), cap.isNegative() ? new Prisma.Decimal(0) : cap);
  const ordered = [...instalments].sort((a, b) => a.paid_at.getTime() - b.paid_at.getTime() || a.id.localeCompare(b.id));

  const shares: AllocatedInstalment[] = [];
  for (const instalment of ordered) {
    const amount = clampShare(decimal(instalment.amount), remaining);
    if (amount.isZero()) continue;
    remaining = remaining.minus(amount);
    shares.push({ id: instalment.id, amount, method: instalment.method, breakdown: instalment.breakdown, paidAt: instalment.paid_at });
  }
  if (!remaining.isZero()) {
    shares.push({
      id: UNRECORDED_INSTALMENT,
      amount: remaining,
      method: statement.payment_method,
      breakdown: statement.payments,
      paidAt: unrecordedDate,
    });
  }
  return shares;
}

const instalmentSplits = (share: AllocatedInstalment) =>
  paymentSplits({ payments: share.breakdown, payment_method: share.method }, share.amount);

/** A rider statement as a debt: Dr 1010 Cash with Rider / Cr 2005 per vendor. */
export function describeRiderStatement(settlement: SettlementForPosting): Described {
  const described = describeRiderRemittance({ ...settlement, paid_amount: 0 });
  if (isSkip(described)) return described;
  return {
    ...described,
    memo: settlement.riders?.name
      ? `COD due from rider ${settlement.riders.name}, ${settlement.statement_id}`
      : `COD due from rider, ${settlement.statement_id}`,
  };
}

/** Cash in from the rider: Dr cash / Cr 1010 Cash with Rider. */
export function describeRiderInstalment(settlement: SettlementForPosting, share: AllocatedInstalment): Described {
  if (settlement.payee_type !== "rider" || !settlement.rider_id) {
    throw new AppError(500, `Settlement ${settlement.statement_id} is not a rider statement`);
  }
  const rider = { type: "rider" as const, id: settlement.rider_id };
  return {
    entryDate: share.paidAt,
    memo: settlement.riders?.name
      ? `COD received from rider ${settlement.riders.name}, ${settlement.statement_id}`
      : `COD received from rider, ${settlement.statement_id}`,
    lines: [
      ...cashLines(instalmentSplits(share), "debit", "COD received", settlement.methodAccounts).map((line) => ({
        ...line,
        party: rider,
      })),
      { accountCode: ACCOUNT.CASH_WITH_RIDER, credit: share.amount, party: rider, memo: "Paid by rider" },
    ],
  };
}

/** A vendor statement as a debt: COD released, the cut earned, the payable left on 2000 Vendor. */
export function describeVendorStatement(settlement: SettlementForPosting): Described {
  const described = describeVendorSettlement({ ...settlement, paid_amount: 0 });
  if (isSkip(described)) return described;
  const payable = decimal(settlement.payable_amount ?? settlement.amount);
  const what = payable.isNegative() ? "COD shortfall due from vendor" : "COD payable to vendor";
  const vendor = vendorLabel(settlement.vendors);
  return {
    ...described,
    memo: vendor ? `${what} ${vendor}, ${settlement.statement_id}` : `${what}, ${settlement.statement_id}`,
  };
}

/**
 * One instalment between the office and a vendor, in whichever direction the
 * payable points: paying out clears 2000 against cash, a shortfall coming in
 * clears it the other way.
 */
export function describeVendorInstalment(settlement: SettlementForPosting, share: AllocatedInstalment): Described {
  if (settlement.payee_type !== "vendor" || !settlement.vendor_id) {
    throw new AppError(500, `Settlement ${settlement.statement_id} is not a vendor statement`);
  }
  const payable = decimal(settlement.payable_amount ?? settlement.amount);
  if (payable.isZero()) return { skip: "nothing payable" };

  const vendor = { type: "vendor" as const, id: settlement.vendor_id };
  const officePays = payable.isPositive();
  const cash = cashLines(
    instalmentSplits(share),
    officePays ? "credit" : "debit",
    officePays ? "COD paid" : "COD received",
    settlement.methodAccounts,
  );
  const control: JournalLineInput = {
    accountCode: ACCOUNT.VENDOR_CONTROL,
    ...(officePays ? { debit: share.amount } : { credit: share.amount }),
    party: vendor,
    memo: officePays ? "Paid to vendor" : "Received from vendor",
  };

  const what = officePays ? "COD paid to vendor" : "COD recovered from vendor";
  const name = vendorLabel(settlement.vendors);
  return {
    entryDate: share.paidAt,
    memo: name ? `${what} ${name}, ${settlement.statement_id}` : `${what}, ${settlement.statement_id}`,
    lines: officePays ? [control, ...cash] : [...cash, control],
  };
}

/** A branch statement as a debt: commission kept, the net left on 1015 COD with Branch. */
export function describeBranchStatement(settlement: BranchSettlementForPosting): Described {
  const described = describeBranchSettlement({ ...settlement, paid_amount: 0 });
  if (isSkip(described)) return described;
  return {
    ...described,
    memo: settlement.from_branch?.name
      ? `COD due from branch ${settlement.from_branch.name}, ${settlement.statement_no}`
      : `COD due from branch, ${settlement.statement_no}`,
  };
}

/** Cash in from a branch: Dr cash (at head office) / Cr 1015 COD with Branch. */
export function describeBranchInstalment(settlement: BranchSettlementForPosting, share: AllocatedInstalment): Described {
  const branch = { type: "location" as const, id: settlement.from_branch_id };
  return {
    entryDate: share.paidAt,
    memo: settlement.from_branch?.name
      ? `COD received from branch ${settlement.from_branch.name}, ${settlement.statement_no}`
      : `COD received from branch, ${settlement.statement_no}`,
    lines: [
      ...cashLines(instalmentSplits(share), "debit", "COD received from branch", settlement.methodAccounts).map(
        (line) => ({ ...line, party: branch, locationId: settlement.to_branch_id }),
      ),
      { accountCode: ACCOUNT.COD_WITH_BRANCH, credit: share.amount, party: branch, memo: "Paid by branch" },
    ],
  };
}

/** A 3PL statement as a debt: the carrier's charge, the net left on 1020 COD with 3PL. */
export function describeCarrierStatement(settlement: CarrierSettlementForPosting): Described {
  const described = describeCarrierSettlement({ ...settlement, paid_amount: 0 });
  if (isSkip(described)) return described;
  return { ...described, memo: `COD due from ${settlement.carrier_code.toUpperCase()}, ${settlement.statement_no}` };
}

/** Cash in from a 3PL: Dr cash / Cr 1020 COD with 3PL. */
export function describeCarrierInstalment(settlement: CarrierSettlementForPosting, share: AllocatedInstalment): Described {
  return {
    entryDate: share.paidAt,
    memo: `COD received from ${settlement.carrier_code.toUpperCase()}, ${settlement.statement_no}`,
    lines: [
      ...cashLines(instalmentSplits(share), "debit", "COD received from 3PL", settlement.methodAccounts),
      { accountCode: ACCOUNT.COD_WITH_CARRIER, credit: share.amount, memo: "Paid by 3PL" },
    ],
  };
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
