import { Prisma } from "../generated/prisma/client";

// ── Money rules, stated once ─────────────────────────────────────────────────
//
// Every rule about what a vendor owes has to be asked in two languages: as SQL,
// when a balance is derived by aggregating over rows, and as a TypeScript
// predicate, when the ledger decides whether one parcel earns an entry. Written
// twice, they drift - and they did. `EARNED_CHARGE_SQL` in billing.service.ts
// was repriced to bill plain RTO parcels while its self-described "TypeScript
// mirror" in accounting/events.ts was not, so every such parcel billed the
// vendor in the derived balance and booked no revenue in the books.
//
// So the rules live here, and the SQL is *generated* from the same constant the
// predicate reads. There is no second copy left to forget.
//
// This module is deliberately pure: it imports the Prisma namespace for its
// query builder, never the client. Both billing.service.ts and
// accounting/events.ts depend on it downward, which is what keeps them from
// having to depend on each other.

/**
 * The statuses at which the office has earned its delivery charge.
 *
 * `delivered` / `partially_delivered` are the plain case: the service was
 * performed, so the charge is earned.
 *
 * `returned_to_vendor` earns it too, in both of its forms - a genuine return
 * leg (order_type "return", priced at the vendor's return percent by
 * getReturnDeliveryQuote) and a plain RTO, a delivery that failed and went
 * follow_up -> ready_to_return -> sent_to_vendor -> returned_to_vendor. The
 * outbound leg was still run either way, so the vendor is billed. Plain RTO
 * parcels are repriced to the return percent when they turn around, so the
 * charge on the row is the return charge, not the full outbound one.
 */
export const EARNED_CHARGE_STATUSES = ["delivered", "partially_delivered", "returned_to_vendor"] as const;

export type EarnedChargeStatus = (typeof EARNED_CHARGE_STATUSES)[number];

/** True when this parcel's status means its delivery charge is the vendor's to pay. */
export function earnsDeliveryCharge(parcel: { status: string }): boolean {
  return (EARNED_CHARGE_STATUSES as readonly string[]).includes(parcel.status);
}

/**
 * The same rule as a SQL fragment, for the aggregate paths that cannot call the
 * predicate row by row. Built from the constant above, so the two cannot
 * disagree - which is the whole point of this module.
 *
 * Assumes the parcels table is aliased `p`, as it is at every call site.
 */
export function earnedChargeSql(): Prisma.Sql {
  return Prisma.sql`
  p.status::text IN (${Prisma.join(EARNED_CHARGE_STATUSES.map((s) => Prisma.sql`${s}`))})
`;
}

/**
 * Whether this parcel's charge is return revenue rather than delivery revenue.
 *
 * Both forms of `returned_to_vendor` carry a return-percent charge, so both
 * book to 4020. Routing only on order_type would push a plain RTO's return
 * charge into 4000 and leave return revenue understated.
 */
export function isReturnLeg(parcel: { status: string; order_type: string }): boolean {
  return parcel.order_type === "return" || parcel.status === "returned_to_vendor";
}

/**
 * Statuses whose entry *or exit* changes what a vendor owes, used to decide
 * when a status change is worth re-evaluating the balance for. Exit matters
 * too: partially_delivered can transition back to ready_to_deliver, un-earning
 * the charge. Same set as EARNED_CHARGE_STATUSES, named for its own use.
 */
export const BALANCE_AFFECTING_STATUSES = EARNED_CHARGE_STATUSES;

export function statusAffectsBalance(status: string | null | undefined): boolean {
  return Boolean(status) && (EARNED_CHARGE_STATUSES as readonly string[]).includes(status as string);
}
