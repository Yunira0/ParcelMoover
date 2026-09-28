import { Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { parseOrderNumber } from "./where";
import { getActorScope, getAdminBranchScope, riderCustodySql, branchHandlesSql } from "./scope";
import type { OrderActor } from "./types";

// Returns per-status-group counts for the operation-page tab badges. Accepts a
// record like { pickup_ordered: ["pickup_ordered"], rider_assigned:
// ["rider_assigned"], … } and returns { pickup_ordered: 12, rider_assigned: 5 }.
export async function getStatusCounts(
  actor: OrderActor,
  statusGroups: Record<string, string[]>,
  filters: { deliveryRiderId?: string; vendorId?: string[]; search?: string } = {},
): Promise<Record<string, number>> {
  const scope = await getActorScope(actor);
  const allStatuses = [...new Set(Object.values(statusGroups).flat())];

  const scopeSql: Prisma.Sql = scope.vendorId
    ? Prisma.sql`AND vendor_id = ${scope.vendorId}::uuid`
    : scope.vendorIds
      ? Prisma.sql`AND vendor_id = ANY(${scope.vendorIds}::uuid[])`
      : scope.riderId
        ? riderCustodySql(scope.riderId)
        : Prisma.empty;

  // A branch-scoped admin (see getAdminBranchScope) - mirrors buildOrdersWhere's
  // branchHandlesFilter exactly, so the tab badges never disagree with the list.
  const branchScopeSql: Prisma.Sql = scope.branchLocationIds
    ? branchHandlesSql(scope.branchLocationIds)
    : Prisma.empty;

  // Caller-supplied filters, applied on top of the actor's own scope so the tab
  // badges stay in step with the filtered list (see buildOrdersWhere).
  const riderSql: Prisma.Sql = filters.deliveryRiderId
    ? Prisma.sql`AND delivery_rider_id = ${filters.deliveryRiderId}::uuid`
    : Prisma.empty;

  // ANDed with scopeSql above rather than replacing it: a vendor-scoped actor
  // filtering by vendor still only ever counts their own parcels.
  const vendorSql: Prisma.Sql = filters.vendorId?.length
    ? Prisma.sql`AND vendor_id = ANY(${filters.vendorId}::uuid[])`
    : Prisma.empty;

  // Mirrors buildOrdersWhere's search exactly, or a scan would show one row in
  // the table while the tab above it still claimed the unfiltered total. A
  // comma-separated list (a barcode scanner batching parcels) matches tracking
  // ids outright; a single term goes through the same search_text trigram
  // column the list query uses, plus the order_number equality match that
  // makes "#2980" resolve to one order.
  const searchSql: Prisma.Sql = (() => {
    const search = filters.search?.trim();
    if (!search) return Prisma.empty;

    const terms = search.split(",").map((t) => t.trim()).filter(Boolean);
    if (terms.length > 1) {
      const trackingSql = Prisma.sql`lower(tracking_id) = ANY(${terms.map((t) => t.toLowerCase())})`;
      const orderNumbers = terms
        .filter((t) => t.startsWith("#"))
        .map(parseOrderNumber)
        .filter((n): n is number => n !== null);
      return orderNumbers.length
        ? Prisma.sql`AND (${trackingSql} OR order_number = ANY(${orderNumbers}::int[]))`
        : Prisma.sql`AND ${trackingSql}`;
    }

    const orderNumber = parseOrderNumber(search);
    if (orderNumber !== null && search.startsWith("#")) {
      return Prisma.sql`AND order_number = ${orderNumber}::int`;
    }
    const textSql = Prisma.sql`search_text ILIKE ${`%${search.toLowerCase()}%`}`;
    return orderNumber !== null
      ? Prisma.sql`AND (${textSql} OR order_number = ${orderNumber}::int)`
      : Prisma.sql`AND ${textSql}`;
  })();

  const rows = await prisma.$queryRaw<{ status: string; cnt: bigint }[]>(Prisma.sql`
    SELECT status::text AS status, COUNT(*) AS cnt
    FROM parcels
    WHERE deleted_at IS NULL
      AND status::text = ANY(${allStatuses})
      ${scopeSql}
      ${branchScopeSql}
      ${riderSql}
      ${vendorSql}
      ${searchSql}
    GROUP BY status
  `);

  const statusMap = new Map(rows.map((r) => [r.status, Number(r.cnt)]));
  const result: Record<string, number> = {};
  for (const [group, statuses] of Object.entries(statusGroups)) {
    result[group] = statuses.reduce((sum, s) => sum + (statusMap.get(s) ?? 0), 0);
  }
  return result;
}

// ─── Merchant Overview ──────────────────────────────────────────────────────
// Server-side aggregation for the Merchant Overview stats cards. Replaces the
// client-side 5 000-order walk with a single SQL query that joins parcels,
// cod_collections, and settlements so every figure is exact and up-to-date.
//
// Money invariants (all filtering on p.created_at + vendor, like the table):
//   totalDelivered(amount) = SUM(collected_amount)                            — gross cash collected on delivered
//   deliveryCharge(amount) = SUM(delivery_charge) FILTER delivered            — office fee on delivered
//   deposited(amount)      = SUM(si.amount) where settlement settled          — net collected - charge, frozen at settlement time
//   pendingDeposit(amount) = SUM(collected - delivery_charge) FILTER delivered NOT in settled settlement — net still owed
//   => deposited(net) + pendingDeposit(net) + deliveryCharge = totalDelivered(gross)
//   => depositedCount + pendingCount = deliveredCount
// See finance.service.ts: payableAmount = collected - delivery_charge is the
// vendor-payout definition used everywhere.

export interface MerchantOverviewMetric {
  count: number;
  amount: number;
}

export interface MerchantOverviewResult {
  metrics: {
    totalOrders: MerchantOverviewMetric;
    pendingOrders: MerchantOverviewMetric;
    totalDelivered: MerchantOverviewMetric;
    returnProcessing: MerchantOverviewMetric;
    returnDelivered: MerchantOverviewMetric;
    holdOrder: MerchantOverviewMetric;
    cancelledOrders: MerchantOverviewMetric;
    deliveryCharge: MerchantOverviewMetric;
    deposited: MerchantOverviewMetric;
    pendingDeposit: MerchantOverviewMetric;
  };
}

export async function getMerchantOverview(
  actor: OrderActor,
  vendorId?: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<MerchantOverviewResult> {
  const vendorCondition = vendorId
    ? Prisma.sql`AND p.vendor_id = ${vendorId}::uuid`
    : Prisma.empty;

  // A branch-scoped admin's Vendor Overview counts only parcels the branch
  // handles (originated here / physically here), matching the branch order list.
  const branchLocationIds = await getAdminBranchScope(actor);
  const branchCondition = branchLocationIds ? branchHandlesSql(branchLocationIds, "p.") : Prisma.empty;

  const dateConditions: Prisma.Sql[] = [];
  if (dateFrom) {
    const from = new Date(`${dateFrom}T00:00:00+05:45`);
    dateConditions.push(Prisma.sql`p.created_at >= ${from}`);
  }
  if (dateTo) {
    const toDate = new Date(`${dateTo}T00:00:00+05:45`);
    toDate.setDate(toDate.getDate() + 1);
    dateConditions.push(Prisma.sql`p.created_at < ${toDate}`);
  }
  const dateFilter = dateConditions.length
    ? Prisma.sql`AND ${Prisma.join(dateConditions, ' AND ')}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<
    {
      total_count: bigint;
      total_cod: string;
      pending_count: bigint;
      pending_cod: string;
      delivered_count: bigint;
      delivered_collected: string;
      return_processing_count: bigint;
      return_processing_cod: string;
      return_delivered_count: bigint;
      return_delivered_cod: string;
      hold_count: bigint;
      hold_cod: string;
      cancelled_count: bigint;
      cancelled_cod: string;
      delivery_charge_sum: string;
    }[]
  >`
    SELECT
      COUNT(*)::bigint                                                        AS total_count,
      COALESCE(SUM(p.cod_amount), 0)::text                                   AS total_cod,

      COUNT(*) FILTER (
        WHERE p.status IN (
          'pickup_ordered','rider_assigned','picked_up','arrived',
          'oov','dispatched','arrived_at_branch','ready_to_deliver',
          'sent_for_delivery','failed_pickup','failed_delivery','loss_and_damage'
        )
      )::bigint                                                               AS pending_count,
      COALESCE(SUM(p.cod_amount) FILTER (
        WHERE p.status IN (
          'pickup_ordered','rider_assigned','picked_up','arrived',
          'oov','dispatched','arrived_at_branch','ready_to_deliver',
          'sent_for_delivery','failed_pickup','failed_delivery','loss_and_damage'
        )
      ), 0)::text                                                             AS pending_cod,

      COUNT(*) FILTER (
        WHERE p.status IN ('delivered','partially_delivered')
      )::bigint                                                               AS delivered_count,
      COALESCE(SUM(COALESCE(cc.collected_amount, 0)) FILTER (
        WHERE p.status IN ('delivered','partially_delivered')
      ), 0)::text                                                             AS delivered_collected,

      COUNT(*) FILTER (
        WHERE p.status IN ('follow_up','ready_to_return','sent_to_vendor')
      )::bigint                                                               AS return_processing_count,
      COALESCE(SUM(p.cod_amount) FILTER (
        WHERE p.status IN ('follow_up','ready_to_return','sent_to_vendor')
      ), 0)::text                                                             AS return_processing_cod,

      COUNT(*) FILTER (
        WHERE p.status = 'returned_to_vendor'
      )::bigint                                                               AS return_delivered_count,
      COALESCE(SUM(p.cod_amount) FILTER (
        WHERE p.status = 'returned_to_vendor'
      ), 0)::text                                                             AS return_delivered_cod,

      COUNT(*) FILTER (
        WHERE p.status = 'hold'
      )::bigint                                                               AS hold_count,
      COALESCE(SUM(p.cod_amount) FILTER (
        WHERE p.status = 'hold'
      ), 0)::text                                                             AS hold_cod,

      COUNT(*) FILTER (
        WHERE p.status = 'cancelled'
      )::bigint                                                               AS cancelled_count,
      COALESCE(SUM(p.cod_amount) FILTER (
        WHERE p.status = 'cancelled'
      ), 0)::text                                                             AS cancelled_cod,

      COALESCE(SUM(p.delivery_charge) FILTER (
        WHERE p.status IN ('delivered','partially_delivered')
      ), 0)::text                                                             AS delivery_charge_sum

    FROM parcels p
    LEFT JOIN cod_collections cc ON cc.parcel_id = p.id
    WHERE p.deleted_at IS NULL
      ${vendorCondition}
      ${branchCondition}
      ${dateFilter}
  `;

  // Authentic settlement aggregation — only settlements with at least one
  // settlement_items (i.e. an order attached) count. Deposited = delivered
  // parcels that are linked to a settled vendor settlement via
  // parcels → cod_collections → settlement_items → settlements.
  // Pending = delivered parcels not yet linked to a settled settlement.
  // This filters out the empty STL-2024-001 style settlements and ensures
  // money is from real COD collections.
  const depositedVendorCondition = vendorId
    ? Prisma.sql`AND p.vendor_id = ${vendorId}::uuid`
    : Prisma.empty;
  // Use same date window as parcels (created_at) for both deposited/pending
  const depositedDateFilter = dateFilter;

  const [depositedRows, pendingRows] = await Promise.all([
    // Deposited: delivered parcels that ARE in a settled settlement
    prisma.$queryRaw<{ cnt: bigint; total: string }[]>`
      SELECT
        COUNT(DISTINCT p.id)::bigint AS cnt,
        COALESCE(SUM(si.amount), 0)::text AS total
      FROM parcels p
      JOIN cod_collections cc ON cc.parcel_id = p.id
      JOIN settlement_items si ON si.cod_collection_id = cc.id
      JOIN settlements s ON s.id = si.settlement_id AND s.status = 'settled' AND s.payee_type = 'vendor'
      WHERE p.deleted_at IS NULL
        AND p.status IN ('delivered','partially_delivered')
        ${depositedVendorCondition}
        ${branchCondition}
        ${depositedDateFilter}
    `,
    // Pending: delivered parcels that are NOT in any settled settlement.
    // Amount is net payable (collected - delivery_charge) — same basis as
    // deposited (si.amount = collected - charge frozen at settlement time)
    // so the books balance: deposited(net) + pending(net) + deliveryCharge = delivered(gross),
    // and depositedCount + pendingCount = deliveredCount.
    prisma.$queryRaw<{ cnt: bigint; total: string }[]>`
      SELECT
        COUNT(*)::bigint AS cnt,
        COALESCE(SUM(COALESCE(cc.collected_amount,0) - COALESCE(p.delivery_charge,0)), 0)::text AS total
      FROM parcels p
      LEFT JOIN cod_collections cc ON cc.parcel_id = p.id
      WHERE p.deleted_at IS NULL
        AND p.status IN ('delivered','partially_delivered')
        ${depositedVendorCondition}
        ${branchCondition}
        ${depositedDateFilter}
        AND NOT EXISTS (
          SELECT 1 FROM settlement_items si
          JOIN settlements s ON s.id = si.settlement_id AND s.status='settled' AND s.payee_type='vendor'
          WHERE si.cod_collection_id = cc.id
        )
    `,
  ]);

  const depositedCount = depositedRows[0] ? Number(depositedRows[0].cnt) : 0;
  const depositedAmount = depositedRows[0] ? Number(depositedRows[0].total) : 0;
  let pendingDepositCount = pendingRows[0] ? Number(pendingRows[0].cnt) : 0;
  let pendingDepositAmount = pendingRows[0] ? Number(pendingRows[0].total) : 0;

  const row = rows[0];
  if (!row) {
    return {
      metrics: {
        totalOrders: { count: 0, amount: 0 },
        pendingOrders: { count: 0, amount: 0 },
        totalDelivered: { count: 0, amount: 0 },
        returnProcessing: { count: 0, amount: 0 },
        returnDelivered: { count: 0, amount: 0 },
        holdOrder: { count: 0, amount: 0 },
        cancelledOrders: { count: 0, amount: 0 },
        deliveryCharge: { count: 0, amount: 0 },
        deposited: { count: depositedCount, amount: depositedAmount },
        pendingDeposit: { count: pendingDepositCount, amount: pendingDepositAmount },
      },
    };
  }

  const deliveredCount = Number(row.delivered_count);
  const deliveredCollected = Number(row.delivered_collected);

  return {
    metrics: {
      totalOrders: { count: Number(row.total_count), amount: Number(row.total_cod) },
      pendingOrders: { count: Number(row.pending_count), amount: Number(row.pending_cod) },
      totalDelivered: { count: deliveredCount, amount: deliveredCollected },
      returnProcessing: { count: Number(row.return_processing_count), amount: Number(row.return_processing_cod) },
      returnDelivered: { count: Number(row.return_delivered_count), amount: Number(row.return_delivered_cod) },
      holdOrder: { count: Number(row.hold_count), amount: Number(row.hold_cod) },
      cancelledOrders: { count: Number(row.cancelled_count), amount: Number(row.cancelled_cod) },
      deliveryCharge: { count: deliveredCount, amount: Number(row.delivery_charge_sum) },
      deposited: { count: depositedCount, amount: depositedAmount },
      pendingDeposit: { count: pendingDepositCount, amount: pendingDepositAmount },
    },
  };
}
