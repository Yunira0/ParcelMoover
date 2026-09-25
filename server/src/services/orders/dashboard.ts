import { Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";
import { NEPAL_UTC_OFFSET_MS, formatNepalDate as formatDate } from "../../utils/nepalTime";
import {
  HANDOFF_REMARK_PREFIX as NCM_HANDOFF_REMARK_PREFIX,
  UPAYA_HANDOFF_REMARK_PREFIX,
} from "../../utils/carrierRemark";
import { getSlaSettings, SLA_GROUPS, BRANCH_COD_SLA_KEY } from "../sla.service";
import { unclosedRemarksWhere } from "../remark.service";
import {
  DASHBOARD_SUMMARY_TTL_SECONDS,
  dashboardSummaryCacheKey,
  salesDashboardSummaryCacheKey,
  dedupeInFlight,
} from "./cache";
import {
  getActorScope,
  branchHandlesFilter,
  branchHandlesSql,
  riderHandledFilter,
  riderHandledSql,
} from "./scope";
import {
  PICKUP_PENDING_STATUSES,
  IN_TRANSIT_STATUSES,
  RETURN_PENDING_STATUSES,
  DELIVERY_PENDING_STATUSES,
  AWAITING_PICKUP_STATUSES,
  IN_DELIVERY_STATUSES,
} from "./status-shared";
import type { OrderActor } from "./types";

const moneyToNumber = (value?: Prisma.Decimal | null) => value ? Number(value) : 0;

export async function getDashboardSummary(actor: OrderActor, trendDays: 7 | 30 = 7) {
  const { vendorId, vendorIds, riderId, branchLocationIds } = await getActorScope(actor);
  // A branch-scoped admin never uses the shared cache (there is no per-branch
  // key for it, same reasoning as the sales vendorIds case below) - it would
  // otherwise serve one branch-scoped admin's figures to another, or the
  // unscoped figures to either.
  const cacheKey =
    branchLocationIds !== undefined
      ? null
      : vendorIds === undefined
      ? dashboardSummaryCacheKey(vendorId, riderId, trendDays)
      : vendorIds.length > 0
      ? salesDashboardSummaryCacheKey(vendorIds, trendDays)
      : null;

  if (cacheKey) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error("[Redis] Failed to read dashboard summary cache:", error);
    }
  }

  return dedupeInFlight(cacheKey, () =>
    computeDashboardSummary(trendDays, vendorId, vendorIds, riderId, branchLocationIds, cacheKey),
  );
}

async function computeDashboardSummary(
  trendDays: 7 | 30,
  vendorId: string | undefined,
  vendorIds: string[] | undefined,
  riderId: string | undefined,
  branchLocationIds: string[] | undefined,
  cacheKey: string | null,
) {
  // Start of today in Nepal local time. setHours() would truncate to the *host*
  // timezone, and the production container runs UTC - so every day bucket below
  // (the trend graph included) started 5h45m late, filing anything that happened
  // between midnight and 05:45 NPT under the previous day.
  const todayStart = new Date(
    Date.parse(`${formatDate(new Date())}T00:00:00Z`) - NEPAL_UTC_OFFSET_MS,
  );

  // A branch-scoped admin (see getAdminBranchScope): same OR-of-three-columns
  // every other branch check in this file uses, reused below wherever a query
  // needs it expressed differently (a relation filter, a raw-SQL join).
  const branchOr: Prisma.parcelsWhereInput | undefined = branchLocationIds
    ? branchHandlesFilter(branchLocationIds)
    : undefined;

  const parcelWhere: Prisma.parcelsWhereInput = {
    deleted_at: null,
    ...(vendorId ? { vendor_id: vendorId } : {}),
    ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
    ...(riderId ? riderHandledFilter(riderId) : {}),
    ...(branchOr ?? {}),
  };

  const codWhere: Prisma.cod_collectionsWhereInput = {
    ...(vendorId ? { vendor_id: vendorId } : {}),
    ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
    ...(riderId ? { rider_id: riderId } : {}),
    // cod_collections carries no location itself - reach through to its parcel.
    ...(branchOr ? { parcels: branchOr } : {}),
  };

  // The COD Settlement card counts every delivered / partially-delivered
  // order, all-time - not a rolling window, since "pending" is money still
  // owed and must never silently drop off just because it's old. To keep the
  // math honest across partial deliveries - where the declared cod_amount
  // overstates what was actually collected - every figure is anchored on
  // collected_amount (the cash actually in hand), and the settled legs are
  // clamped with LEAST() so a settlement can never exceed what was collected.
  // Pending is then collected - settled, so Settled + Pending always equals
  // Total exactly.
  // The query this feeds always joins `p` (parcels) alongside `c`, so the
  // branch check reads off that join rather than a subquery.
  const codScopeSql: Prisma.Sql = vendorId
    ? Prisma.sql`AND c.vendor_id = ${vendorId}::uuid`
    : vendorIds
    ? Prisma.sql`AND c.vendor_id = ANY(${vendorIds}::uuid[])`
    : riderId
    ? Prisma.sql`AND c.rider_id = ${riderId}::uuid`
    : branchLocationIds
    ? branchHandlesSql(branchLocationIds, "p.")
    : Prisma.empty;

  const settlementWhere: Prisma.settlementsWhereInput = {
    status: "settled",
    ...(vendorId ? { vendor_id: vendorId } : {}),
    ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
    ...(riderId ? { rider_id: riderId } : {}),
    // settlements carries no location either - reach through settlement_items
    // → cod_collections → parcels. "some" is correct here (not "every"): a
    // settlement scoped to another branch that happens to also bundle one of
    // this branch's parcels should still surface as the branch's own pending
    // settlement, the same way listOrders would show that one parcel.
    ...(branchOr ? { settlement_items: { some: { cod_collections: { parcels: branchOr } } } } : {}),
  };

  const TREND_DAYS = trendDays;
  // The 7-day view is anchored to the current Nepal week (Sunday start) so the
  // graph always reads Sun -> Sat rather than a rolling window that begins
  // mid-week. It stays one contiguous week, so the line never wraps backwards.
  // getUTCDay() on the Nepal calendar date is 0 = Sunday regardless of the
  // host timezone. The 30-day view keeps its rolling window ending today.
  const nepalWeekday = new Date(`${formatDate(new Date())}T00:00:00Z`).getUTCDay();
  const trendDayRanges = Array.from({ length: TREND_DAYS }, (_, index) => {
    const dayDelta =
      TREND_DAYS === 7 ? index - nepalWeekday : -(TREND_DAYS - 1 - index);
    const start = new Date(todayStart);
    start.setDate(start.getDate() + dayDelta);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  });

  // "Delivered" on the rider dashboard is a claim about who handed the parcel
  // over, not merely who touched it - so for a rider it counts only their own
  // deliveries. Without this a 3PL delivery (delivery_rider_id NULL) was filed
  // under whichever rider had collected the parcel days earlier, and riders
  // reported NCM "delivering in their name". Empty for vendor/staff/sales
  // scopes, which are not making that claim.
  const riderDeliveredSql: Prisma.Sql = riderId
    ? Prisma.sql`AND delivery_rider_id = ${riderId}::uuid`
    : Prisma.empty;

  // Every card on the rider dashboard deep-links to the list of orders behind
  // it, so a card whose number is computed on different terms than its own
  // drill-down is simply wrong - a rider taps "Total Picked Up: 340" and lands
  // on three rows. The list is fixed at a status set (the rider APK is
  // sideloaded and can't be updated), so the number is what has to move.
  //
  // Picked Up -> ?view=picked_up, which lists status = picked_up. For that
  // status custody and handled scope agree, so no extra rider predicate is
  // needed. The card stops being a lifetime tally and becomes "collected, not
  // yet handed over at the hub" - which is the honest reading of a number you
  // can tap into, and matches the Pickup lane riders already work from.
  const pickedUpFilterSql: Prisma.Sql = riderId
    ? Prisma.sql`status::text = 'picked_up'`
    : Prisma.sql`status::text NOT IN ('pickup_ordered','rider_assigned','failed_pickup','cancelled')`;

  // Total RTV -> ?view=return, which lists sent_to_vendor/returned_to_vendor.
  // order_type = 'return' is a different question entirely (it counts return
  // orders at any status, including ones this rider never carried back), so
  // for a rider it's replaced by the statuses the list actually shows, scoped
  // the same way custody scopes them: the rider who carried the return.
  const returnsFilterSql: Prisma.Sql = riderId
    ? Prisma.sql`status::text = ANY(ARRAY['sent_to_vendor','returned_to_vendor']) AND delivery_rider_id = ${riderId}::uuid`
    : Prisma.sql`order_type::text = 'return'`;

  // Same scope (vendor/rider/none) as parcelWhere above, expressed as raw SQL so
  // it can be reused across both consolidated queries below. Casting the enum
  // columns to text and comparing against plain string arrays sidesteps
  // Postgres enum-array parameter binding, which $queryRaw doesn't infer well.
  const parcelScopeSql: Prisma.Sql = vendorId
    ? Prisma.sql`AND vendor_id = ${vendorId}::uuid`
    : vendorIds
    ? Prisma.sql`AND vendor_id = ANY(${vendorIds}::uuid[])`
    : riderId
    ? riderHandledSql(riderId)
    : branchLocationIds
    ? branchHandlesSql(branchLocationIds)
    : Prisma.empty;

  // The 11 overview/today metrics below all count the same `parcels` table
  // under the same scope, differing only in which status/date predicate
  // applies - conditional aggregation collapses them into one round trip
  // instead of 11. (Previously the single biggest contributor to this
  // endpoint's ~17-query fan-out under load - see server/loadtest/README.md.)
  const [overviewRow] = await prisma.$queryRaw<
    Array<{
      total_orders: bigint;
      pending_pickups: bigint;
      pending_returns: bigint;
      in_transit: bigint;
      pending_deliveries: bigint;
      awaiting_pickup: bigint;
      in_delivery: bigint;
      total_delivered: bigint;
      total_picked_up: bigint;
      total_returns: bigint;
      total_returned_to_vendor: bigint;
      todays_orders: bigint;
      todays_delivered: bigint;
      todays_returns: bigint;
      total_order_amount: string;
      pending_pickups_amount: string;
      pending_returns_amount: string;
      in_transit_amount: string;
      pending_deliveries_amount: string;
      awaiting_pickup_amount: string;
      in_delivery_amount: string;
      todays_delivered_amount: string;
      total_delivered_amount: string;
      total_returns_amount: string;
      total_returned_to_vendor_amount: string;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*) AS total_orders,
      COUNT(*) FILTER (WHERE status::text = ANY(${PICKUP_PENDING_STATUSES})) AS pending_pickups,
      COUNT(*) FILTER (WHERE status::text = ANY(${RETURN_PENDING_STATUSES})) AS pending_returns,
      COUNT(*) FILTER (WHERE status::text = ANY(${IN_TRANSIT_STATUSES})) AS in_transit,
      COUNT(*) FILTER (WHERE status::text = ANY(${DELIVERY_PENDING_STATUSES})) AS pending_deliveries,
      COUNT(*) FILTER (WHERE status::text = ANY(${AWAITING_PICKUP_STATUSES})) AS awaiting_pickup,
      COUNT(*) FILTER (WHERE status::text = ANY(${IN_DELIVERY_STATUSES})) AS in_delivery,
      COUNT(*) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered']) ${riderDeliveredSql}) AS total_delivered,
      COUNT(*) FILTER (WHERE ${pickedUpFilterSql}) AS total_picked_up,
      COUNT(*) FILTER (WHERE ${returnsFilterSql}) AS total_returns,
      COUNT(*) FILTER (WHERE status::text = 'returned_to_vendor') AS total_returned_to_vendor,
      COUNT(*) FILTER (WHERE created_at >= ${todayStart}) AS todays_orders,
      COUNT(*) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered']) AND delivered_at >= ${todayStart} ${riderDeliveredSql}) AS todays_delivered,
      COUNT(*) FILTER (WHERE order_type::text = 'return' AND created_at >= ${todayStart}) AS todays_returns,
      COALESCE(SUM(cod_amount), 0) AS total_order_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${PICKUP_PENDING_STATUSES})), 0) AS pending_pickups_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${RETURN_PENDING_STATUSES})), 0) AS pending_returns_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${IN_TRANSIT_STATUSES})), 0) AS in_transit_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${DELIVERY_PENDING_STATUSES})), 0) AS pending_deliveries_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${AWAITING_PICKUP_STATUSES})), 0) AS awaiting_pickup_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(${IN_DELIVERY_STATUSES})), 0) AS in_delivery_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered']) AND delivered_at >= ${todayStart} ${riderDeliveredSql}), 0) AS todays_delivered_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered']) ${riderDeliveredSql}), 0) AS total_delivered_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE ${returnsFilterSql}), 0) AS total_returns_amount,
      COALESCE(SUM(cod_amount) FILTER (WHERE status::text = 'returned_to_vendor'), 0) AS total_returned_to_vendor_amount
    FROM parcels
    WHERE deleted_at IS NULL ${parcelScopeSql}
  `);

  const totalOrders = Number(overviewRow!.total_orders);
  const pendingPickups = Number(overviewRow!.pending_pickups);
  const pendingReturns = Number(overviewRow!.pending_returns);
  const inTransit = Number(overviewRow!.in_transit);
  const pendingDeliveries = Number(overviewRow!.pending_deliveries);
  const awaitingPickup = Number(overviewRow!.awaiting_pickup);
  const inDelivery = Number(overviewRow!.in_delivery);
  const totalDelivered = Number(overviewRow!.total_delivered);
  const totalPickedUp = Number(overviewRow!.total_picked_up);
  const totalReturns = Number(overviewRow!.total_returns);
  const totalReturnedToVendor = Number(overviewRow!.total_returned_to_vendor);
  const todaysOrders = Number(overviewRow!.todays_orders);
  const todaysDelivered = Number(overviewRow!.todays_delivered);
  const todaysReturns = Number(overviewRow!.todays_returns);
  const totalOrderAmount = Number(overviewRow!.total_order_amount);
  const pendingPickupsAmount = Number(overviewRow!.pending_pickups_amount);
  const pendingReturnsAmount = Number(overviewRow!.pending_returns_amount);
  const inTransitAmount = Number(overviewRow!.in_transit_amount);
  const pendingDeliveriesAmount = Number(overviewRow!.pending_deliveries_amount);
  const awaitingPickupAmount = Number(overviewRow!.awaiting_pickup_amount);
  const inDeliveryAmount = Number(overviewRow!.in_delivery_amount);
  const todaysDeliveredAmount = Number(overviewRow!.todays_delivered_amount);
  const totalDeliveredAmount = Number(overviewRow!.total_delivered_amount);
  const totalReturnsAmount = Number(overviewRow!.total_returns_amount);
  const totalReturnedToVendorAmount = Number(overviewRow!.total_returned_to_vendor_amount);

  // Same consolidation for the weekly/monthly trend: previously 4 queries per
  // day (up to 120 for the 30-day view), now one query with 3 conditional
  // aggregates per day. Column aliases are loop-index-derived, never
  // user-supplied, so Prisma.raw here isn't an injection risk.
  //
  // Every series here is an event-of-the-day count keyed off the timestamp of
  // the milestone itself - creation for Total, picked_up_at for Picked Up,
  // delivered_at for Delivered. "Returned" follows the same rule but its event
  // lives in parcel_status_history (parcels has no returned_at column), so it's
  // counted in a separate query below - see trendReturnedRow. Counting
  // order_type = 'return' orders by created_at here instead measured a
  // different thing entirely (return orders raised, not parcels sent back) and
  // never matched the "Returned" figure on Today's activity.
  const trendSelects = trendDayRanges.map(({ start, end }, i) => Prisma.sql`
    COUNT(*) FILTER (WHERE created_at >= ${start} AND created_at < ${end}) AS ${Prisma.raw(`d${i}_total`)},
    COUNT(*) FILTER (WHERE picked_up_at >= ${start} AND picked_up_at < ${end}) AS ${Prisma.raw(`d${i}_picked_up`)},
    COUNT(*) FILTER (WHERE status::text = ANY(ARRAY['delivered','partially_delivered']) AND delivered_at >= ${start} AND delivered_at < ${end}) AS ${Prisma.raw(`d${i}_delivered`)}
  `);
  const [trendRow] = await prisma.$queryRaw<Array<Record<string, bigint>>>(Prisma.sql`
    SELECT ${Prisma.join(trendSelects, ",")} FROM parcels WHERE deleted_at IS NULL ${parcelScopeSql}
  `);
  const trendCounts = trendDayRanges.map((_, i) => [
    Number(trendRow![`d${i}_total`]),
    Number(trendRow![`d${i}_picked_up`]),
    Number(trendRow![`d${i}_delivered`]),
  ]);

  // Same scope as parcelScopeSql but qualified for the `p` alias, so it can be
  // reused in joins against parcel_status_history below.
  const pAliasScopeSql: Prisma.Sql = vendorId
    ? Prisma.sql`AND p.vendor_id = ${vendorId}::uuid`
    : vendorIds
    ? Prisma.sql`AND p.vendor_id = ANY(${vendorIds}::uuid[])`
    : riderId
    ? riderHandledSql(riderId, "p.")
    : branchLocationIds
    ? branchHandlesSql(branchLocationIds, "p.")
    : Prisma.empty;

  // Per-day "Returned" for the trend graph: parcels whose status *became*
  // returned_to_vendor within each day's window, keyed off the status-history
  // timestamp - the same event and scope as returnedTodayRows below, just
  // bucketed across the whole range so the graph's last point equals the
  // "Returned" figure on Today's activity. Aliases are loop-index-derived.
  const trendReturnedSelects = trendDayRanges.map(({ start, end }, i) => Prisma.sql`
    COUNT(DISTINCT h.parcel_id) FILTER (WHERE h.created_at >= ${start} AND h.created_at < ${end}) AS ${Prisma.raw(`d${i}_returned`)}
  `);

  const [todaysRemarks, unclosedComments, codRows, pendingCodCount, lastSettlement, returnedTodayRows, trendReturnedRows] = await Promise.all([
    prisma.parcel_remarks.count({
      where: { created_at: { gte: todayStart }, parcels: parcelWhere },
    }),
    // Same set as the nav's "Unclosed cmt" badge - this row links to the vendor
    // queue, so it counts what that page lists. Rider-raised remarks are the
    // separate "Rider cmt" queue.
    prisma.parcel_remarks.count({
      where: { ...unclosedRemarksWhere("vendor"), parcels: parcelWhere },
    }),
    prisma.$queryRaw<
      Array<{
        total_collected: string;
        settled_to_vendor: string;
        settled_to_rider: string;
        cod_from_pm_rider: string;
        cod_from_ncm: string;
        cod_from_upaya: string;
        pending_delivery_charge: string;
        total_delivery_charge: string;
      }>
    >(Prisma.sql`
      SELECT
        COALESCE(SUM(c.collected_amount), 0) AS total_collected,
        COALESCE(SUM(LEAST(c.remitted_amount, c.collected_amount)), 0) AS settled_to_vendor,
        COALESCE(SUM(LEAST(c.rider_remitted_amount, c.collected_amount)), 0) AS settled_to_rider,
        -- Cash a ParcelMoover rider physically holds, not yet remitted to the
        -- office: c.rider_id is only ever set from parcels.delivery_rider_id,
        -- which stays NULL for NCM-delivered parcels (see
        -- applyExternalCarrierStatus) - so rider_id IS NOT NULL is exactly
        -- "our own rider delivered this," never an NCM handoff. r.carrier_code
        -- IS NULL excludes placeholder rider rows that stand in for a carrier
        -- (e.g. "PM Rider U"/"PM Rider N") rather than a real employee.
        COALESCE(SUM(c.collected_amount - LEAST(c.rider_remitted_amount, c.collected_amount))
          FILTER (WHERE c.rider_id IS NOT NULL AND r.carrier_code IS NULL), 0) AS cod_from_pm_rider,
        -- Cash NCM collected on our behalf and hasn't remitted to the office
        -- yet. Two signals feed this: the durable API handoff remark
        -- ncm.service.ts writes (see findNcmOrderIdForParcel), and parcels
        -- routed to NCM manually via the "PM Rider N" placeholder rider
        -- (r.carrier_code = 'ncm') for cases the API flow doesn't cover. No
        -- pm-rider ever touches this cash, so rider_remitted_amount is never
        -- populated for these rows - the full collected amount counts as
        -- outstanding until NCM's remittance clears it (via the vendor leg,
        -- remitted_amount).
        COALESCE(SUM(c.collected_amount - LEAST(c.remitted_amount, c.collected_amount))
          FILTER (WHERE (c.rider_id IS NULL AND EXISTS (
            SELECT 1 FROM parcel_remarks pr
            WHERE pr.parcel_id = p.id AND pr.remark LIKE ${NCM_HANDOFF_REMARK_PREFIX + '%'}
          )) OR r.carrier_code = 'ncm'), 0) AS cod_from_ncm,
        -- Cash Upaya collected on our behalf. Two signals, same shape as NCM
        -- above: the durable API handoff remark upaya.service.ts writes for
        -- real API-driven handoffs, and the "PM Rider U" placeholder rider
        -- (r.carrier_code = 'upaya') for parcels routed to Upaya manually,
        -- from before the API integration existed. Same "clears via the
        -- vendor leg" reasoning as NCM above.
        COALESCE(SUM(c.collected_amount - LEAST(c.remitted_amount, c.collected_amount))
          FILTER (WHERE (c.rider_id IS NULL AND EXISTS (
            SELECT 1 FROM parcel_remarks pr
            WHERE pr.parcel_id = p.id AND pr.remark LIKE ${UPAYA_HANDOFF_REMARK_PREFIX + '%'}
          )) OR r.carrier_code = 'upaya'), 0) AS cod_from_upaya,
        COALESCE(SUM(p.delivery_charge) FILTER (WHERE c.payment_status::text = 'pending'), 0) AS pending_delivery_charge,
        COALESCE(SUM(p.delivery_charge), 0) AS total_delivery_charge
      FROM cod_collections c
      JOIN parcels p ON p.id = c.parcel_id
      LEFT JOIN riders r ON r.id = c.rider_id
      WHERE p.deleted_at IS NULL
        -- returned_to_vendor is in scope alongside the delivery statuses: an
        -- RTV/RTO parcel collected no COD (contributes 0 to the cash figures)
        -- but still owes its return delivery charge, so its charge belongs in
        -- pending_delivery_charge / total_delivery_charge. collected_at (stamped
        -- by the delivery / partial-delivery / RTV transition) is the "reached
        -- the vendor" gate - the same basis getPendingCodBill and
        -- getUnsettledOrders bill on.
        AND c.collected_at IS NOT NULL
        AND p.status::text IN ('delivered', 'partially_delivered', 'returned_to_vendor')
        ${codScopeSql}
    `),
    prisma.cod_collections.count({
      where: riderId
        ? { ...codWhere, rider_payment_status: "pending", collected_amount: { gt: 0 } }
        : { ...codWhere, payment_status: "pending" },
    }),
    prisma.settlements.findFirst({
      where: settlementWhere,
      orderBy: [{ settlement_date: "desc" }, { created_at: "desc" }],
      select: { amount: true, payable_amount: true, settlement_date: true, created_at: true },
    }),
    // Parcels whose status *became* returned_to_vendor today (by status-history
    // timestamp, since parcels has no returned_at column). DISTINCT guards
    // against a parcel bouncing into the status more than once in a day.
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT h.parcel_id) AS count
      FROM parcel_status_history h
      JOIN parcels p ON p.id = h.parcel_id
      WHERE h.new_status::text = 'returned_to_vendor'
        AND h.created_at >= ${todayStart}
        AND p.deleted_at IS NULL
        ${pAliasScopeSql}
    `),
    prisma.$queryRaw<Array<Record<string, bigint>>>(Prisma.sql`
      SELECT ${Prisma.join(trendReturnedSelects, ",")}
      FROM parcel_status_history h
      JOIN parcels p ON p.id = h.parcel_id
      WHERE h.new_status::text = 'returned_to_vendor'
        AND h.created_at >= ${trendDayRanges[0]!.start}
        AND h.created_at < ${trendDayRanges[TREND_DAYS - 1]!.end}
        AND p.deleted_at IS NULL
        ${pAliasScopeSql}
    `),
  ]);
  const todaysReturnedToVendor = Number(returnedTodayRows[0]?.count ?? 0);
  const trendReturnedRow = trendReturnedRows[0];

  // All figures are on the collected-cash basis (see codScopeSql above). Total
  // is the cash actually collected; settled is what has been remitted onward
  // (to the vendor for vendor/staff scope, to the office for rider scope),
  // clamped in SQL so it can't exceed the collection; pending is the remainder.
  const codRow = codRows[0];
  const totalCod = Number(codRow?.total_collected ?? 0);
  const settledCod = riderId
    ? Number(codRow?.settled_to_rider ?? 0)
    : Number(codRow?.settled_to_vendor ?? 0);
  const pendingCod = Math.max(totalCod - settledCod, 0);

  // Cash currently outstanding, split by who's holding it - shown on the
  // dashboard card under one "COD to collect from riders" heading, broken
  // down by carrier beneath it. NCM's figure is a proxy (no NCM
  // remittance-to-office column exists): it clears the moment the vendor leg
  // settles, same as the rest of "pending" does. The parent total is the sum
  // of the identified carriers, not an independent all-rider_id-null figure -
  // that keeps every level using the same accurate per-carrier formula (a
  // future 3PL just adds another FILTER clause and another addend here).
  const codFromPmRider = Number(codRow?.cod_from_pm_rider ?? 0);
  const codFromNcm = Number(codRow?.cod_from_ncm ?? 0);
  const codFromUpaya = Number(codRow?.cod_from_upaya ?? 0);
  const codFromRiders = codFromPmRider + codFromNcm + codFromUpaya;

  // Delivery charge on orders whose COD hasn't been settled to the vendor
  // yet - this is deducted from collected_amount at settlement time (see
  // finance.service.ts's payableAmount calc), so it's still "owed" until then.
  const pendingDeliveryCharge = Number(codRow?.pending_delivery_charge ?? 0);
  // Total delivery charges (the office's cut) on the same delivered orders the
  // COD figures above are drawn from - shown as its own line on the COD card.
  const deliveryCharge = Number(codRow?.total_delivery_charge ?? 0);

  const weeklyTrend = trendDayRanges.map(({ start }, index) => {
    const [dayTotalOrders, dayPickedUp, dayDelivered] = trendCounts[index] ?? [0, 0, 0];
    const dayReturned = Number(trendReturnedRow?.[`d${index}_returned`] ?? 0);
    const nepalDate = formatDate(start);
    return {
      // Weekday of the Nepal calendar date, not the raw instant - the host
      // timezone must not shift a Sunday bucket onto "Sat".
      day: new Date(`${nepalDate}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      date: nepalDate,
      totalOrders: dayTotalOrders,
      pickedUp: dayPickedUp,
      delivered: dayDelivered,
      returned: dayReturned,
    };
  });

  // ── SLA breaches ────────────────────────────────────────────────────────────
  // An order breaches its SLA when the time since it *entered its current status*
  // (latest parcel_status_history row, falling back to created_at) exceeds the
  // hours configured for that status. Counts are scoped like everything else.
  const slaSettings = await getSlaSettings();
  const statusThresholds: Array<[string, number]> = [];
  for (const status of [
    ...SLA_GROUPS.pickup,
    ...SLA_GROUPS.delivery,
    ...SLA_GROUPS.transit,
    ...SLA_GROUPS.return,
  ]) {
    const hours = slaSettings[status];
    if (typeof hours === "number") statusThresholds.push([status, hours]);
  }

  const slaCounts: Record<string, number> = {};
  // Delivery breaches whose destination sits inside the valley, per status.
  // Only the delivery group is split this way - a pickup is worked by the
  // origin branch's own riders, so splitting it by valley tells the desk
  // nothing it doesn't already know from the row it is looking at.
  // "Inside" is valley = 'inside' on the destination, which covers both sides
  // of the ring road. The outside-valley figure is the status total minus this,
  // so a destination outside the valley - or not classified at all - lands in
  // the outside bucket, the same way pricing treats anything that is not
  // explicitly inside (resolveDestinationPricing).
  const slaInsideValleyCounts: Record<string, number> = {};
  const deliverySlaStatuses: readonly string[] = SLA_GROUPS.delivery;
  if (statusThresholds.length) {
    const breachedSql = (status: string, hours: number) =>
      Prisma.sql`status = ${status} AND status_since < now() - (${hours} * interval '1 hour')`;
    const breachColumns = statusThresholds.flatMap(([status, hours]) => {
      const columns = [
        Prisma.sql`COUNT(*) FILTER (WHERE ${breachedSql(status, hours)}) AS ${Prisma.raw(`c_${status}`)}`,
      ];
      if (deliverySlaStatuses.includes(status)) {
        columns.push(Prisma.sql`COUNT(*) FILTER (
          WHERE ${breachedSql(status, hours)} AND destination_valley = 'inside'
        ) AS ${Prisma.raw(`i_${status}`)}`);
      }
      return columns;
    });
    // A location's valley falls back to its parent's, the same way pricing
    // resolves it (resolveDestinationPricing).
    const [row] = await prisma.$queryRaw<Array<Record<string, bigint>>>(Prisma.sql`
      SELECT ${Prisma.join(breachColumns)}
      FROM (
        SELECT
          status::text AS status,
          COALESCE(
            (SELECT MAX(h.created_at) FROM parcel_status_history h WHERE h.parcel_id = parcels.id),
            created_at
          ) AS status_since,
          (
            SELECT COALESCE(l.valley, pl.valley)
            FROM locations l LEFT JOIN locations pl ON pl.id = l.parent_id
            WHERE l.id = parcels.destination_location_id
          ) AS destination_valley
        FROM parcels
        WHERE deleted_at IS NULL
          AND status::text = ANY(${statusThresholds.map(([status]) => status)})
          ${parcelScopeSql}
      ) sla_parcels
    `);
    for (const [status] of statusThresholds) {
      slaCounts[status] = Number(row?.[`c_${status}`] ?? 0);
      if (row?.[`i_${status}`] !== undefined) slaInsideValleyCounts[status] = Number(row[`i_${status}`]);
    }
  }

  const sumStatuses = (statuses: readonly string[]) =>
    statuses.reduce((n, s) => n + (slaCounts[s] ?? 0), 0);

  // The statuses behind a group's total, so "Pickup SLA breached: 3" can say
  // which stages those three are stuck in. Only the ones actually breaching -
  // a list padded with zeroes tells the reader nothing and crowds the row.
  const breachesByStatus = (statuses: readonly string[]) =>
    statuses
      .map((status) => ({ status, count: slaCounts[status] ?? 0 }))
      .filter((entry) => entry.count > 0);

  // The delivery group split by the destination's valley: inside (both sides of
  // the ring road) and outside (everything else) - each side with its own total
  // and per-status breakdown.
  const breachesByValley = (statuses: readonly string[]) => {
    const side = (countFor: (status: string) => number) => {
      const breaches = statuses
        .map((status) => ({ status, count: countFor(status) }))
        .filter((entry) => entry.count > 0);
      return { count: breaches.reduce((n, entry) => n + entry.count, 0), breaches };
    };
    const inside = (status: string) => slaInsideValleyCounts[status] ?? 0;
    return {
      insideValley: side(inside),
      outsideValley: side((status) => (slaCounts[status] ?? 0) - inside(status)),
    };
  };

  // Representative SLA threshold to display for a group row: the tightest
  // (smallest) configured hours among its statuses, or null if none set.
  const groupHours = (statuses: readonly string[]): number | null => {
    const vals = statuses
      .map((s) => slaSettings[s])
      .filter((h): h is number => typeof h === "number");
    return vals.length ? Math.min(...vals) : null;
  };

  // Branch COD submission: parcels delivered to a branch whose collected COD is
  // still not on any branch settlement past the SLA. Same rule branch-billing
  // uses for a branch's overdue figure, counted here across the whole network
  // (or the admin's own branches) so it can sit beside the other SLA breaches.
  let overdueBranchCod = 0;
  let overdueBranchCodAmount = 0;
  const branchCodHours = slaSettings[BRANCH_COD_SLA_KEY];
  if (typeof branchCodHours === "number") {
    const branchScopeSql =
      branchLocationIds === undefined
        ? Prisma.empty
        : branchLocationIds.length === 0
        ? Prisma.sql`AND false`
        : Prisma.sql`AND p.destination_location_id IN (${Prisma.join(branchLocationIds)}::uuid[])`;
    const rows = await prisma.$queryRaw<Array<{ n: bigint; amount: string }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS n,
             COALESCE(SUM(GREATEST(0::numeric, COALESCE(cc.collected_amount, p.cod_amount))), 0) AS amount
      FROM parcels p
      LEFT JOIN cod_collections cc ON cc.parcel_id = p.id
      JOIN locations dl ON dl.id = p.destination_location_id
      WHERE p.deleted_at IS NULL
        AND p.status::text IN ('delivered', 'partially_delivered')
        AND p.delivered_at IS NOT NULL
        AND p.delivered_at < now() - make_interval(hours => ${branchCodHours})
        AND p.destination_location_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM branch_settlement_items bsi WHERE bsi.parcel_id = p.id)
        -- COD on parcels delivered into Imadol is already at the master branch:
        -- there is no settlement for it to sit on, so it is never overdue.
        AND COALESCE(dl.parent_id, dl.id) IS DISTINCT FROM (
          SELECT id FROM locations
          WHERE upper(code) = 'IMADOL' AND parent_id IS NULL AND is_hub LIMIT 1
        )
        ${branchScopeSql}
    `);
    overdueBranchCod = Number(rows[0]?.n ?? 0);
    overdueBranchCodAmount = Math.round(Number(rows[0]?.amount ?? 0) * 100) / 100;
  }

  let overdueRemarks = 0;
  const remarksHours = slaSettings["remarks"];
  if (typeof remarksHours === "number") {
    const remarksCutoff = new Date(Date.now() - remarksHours * 3600 * 1000);
    // Unclosed comments past their SLA - the same set the badge counts, aged.
    // Counting raw parcel_remarks rows instead swept in every reply as its own
    // breach, plus staff notes and the sync jobs' own bookkeeping rows, none of
    // which anyone is waiting to reply to and none of which are ever closed.
    // Both queues here, not just the vendor one: this row links to /remarks,
    // which lists them together.
    overdueRemarks = await prisma.parcel_remarks.count({
      where: {
        ...unclosedRemarksWhere(),
        // The clock runs from the last message in the thread, not from the one
        // that opened it: the row means "nobody has answered this in N hours",
        // so a reply is activity and restarts it. Root older than the cutoff
        // AND no reply since is the same test as "newest message is older than
        // the cutoff", without a correlated subquery.
        created_at: { lt: remarksCutoff },
        replies: { none: { created_at: { gte: remarksCutoff } } },
        parcels: parcelWhere,
      },
    });
  }

  const summary = {
    overview: {
      totalOrders,
      totalOrderAmount,
      pendingPickups,
      pendingPickupsAmount,
      pendingReturns,
      pendingReturnsAmount,
      inTransit,
      inTransitAmount,
      pendingDeliveries,
      pendingDeliveriesAmount,
      awaitingPickup,
      awaitingPickupAmount,
      inDelivery,
      inDeliveryAmount,
      totalDelivered,
      totalDeliveredAmount,
      totalPickedUp,
      totalReturns,
      totalReturnsAmount,
      totalReturnedToVendor,
      totalReturnedToVendorAmount,
    },
    today: {
      totalOrders: todaysOrders,
      delivered: todaysDelivered,
      deliveredAmount: todaysDeliveredAmount,
      inTransit,
      returns: todaysReturns,
      returnedToVendor: todaysReturnedToVendor,
      remarks: todaysRemarks,
      unclosedComments,
    },
    codSettlement: {
      totalCod,
      settledCod,
      pendingCod,
      codFromRiders,
      codFromPmRider,
      codFromNcm,
      codFromUpaya,
      deliveryCharge,
      pendingCodCount,
      pendingDeliveryCharge,
      progressPercent: totalCod > 0 ? (settledCod / totalCod) * 100 : 0,
      scopedToRider: Boolean(riderId),
      // Net amount the vendor was actually paid (collected COD minus delivery
      // charge - see finance.service.ts's payableAmount), not the gross total.
      lastAmount: lastSettlement ? moneyToNumber(lastSettlement.payable_amount ?? lastSettlement.amount) : 0,
      // Full timestamp, not just the (time-less) settlement_date column, so the
      // UI can show both date and time of when the settlement was created.
      lastSettledAt: lastSettlement ? lastSettlement.created_at.toISOString() : null,
    },
    sla: {
      overduePickup: sumStatuses(SLA_GROUPS.pickup),
      overdueDelivery: sumStatuses(SLA_GROUPS.delivery),
      overdueTransit: sumStatuses(SLA_GROUPS.transit),
      overdueRemarks,
      overdueReturn: sumStatuses(SLA_GROUPS.return),
      overdueBranchCod,
      overdueBranchCodAmount,
      branchCodHours: typeof branchCodHours === "number" ? branchCodHours : null,
      pickupHours: groupHours(SLA_GROUPS.pickup),
      deliveryHours: groupHours(SLA_GROUPS.delivery),
      transitHours: groupHours(SLA_GROUPS.transit),
      remarksHours: typeof slaSettings["remarks"] === "number" ? slaSettings["remarks"] : null,
      returnHours: groupHours(SLA_GROUPS.return),
      pickupBreaches: breachesByStatus(SLA_GROUPS.pickup),
      deliveryBreaches: breachesByStatus(SLA_GROUPS.delivery),
      transitBreaches: breachesByStatus(SLA_GROUPS.transit),
      returnBreaches: breachesByStatus(SLA_GROUPS.return),
      deliveryByValley: breachesByValley(SLA_GROUPS.delivery),
    },
    weeklyTrend,
    updatedAt: new Date().toISOString(),
  };

  if (cacheKey) {
    try {
      await redis.setex(cacheKey, DASHBOARD_SUMMARY_TTL_SECONDS, JSON.stringify(summary));
    } catch (error) {
      console.error("[Redis] Failed to write dashboard summary cache:", error);
    }
  }

  return summary;
}
