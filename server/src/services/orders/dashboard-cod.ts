import { Prisma } from "../../generated/prisma/client";
import {
  BRANCH_CLEARED_SQL,
  BRANCH_OWED_SQL,
  CARRIER_OWED_SQL,
  PART_PAID_FRACTIONS_SQL,
  pmRiderFilterSql,
} from "./cod-detail";

export interface CodSummaryRow {
  total_collected: string;
  settled_to_vendor: string;
  settled_to_rider: string;
  cod_from_pm_rider: string;
  cod_from_ncm: string;
  cod_from_upaya: string;
  cod_from_branches: string;
  pending_delivery_charge: string;
  total_delivery_charge: string;
}

/**
 * The COD Settlement card's figures in one pass. `branchFilter` is
 * branchCodFilterSql's predicate; `riderScoped` is a rider's own card, where
 * every parcel they hold stays under PM-Rider and Branches is not shown.
 */
export function buildCodSummaryQuery(scope: Prisma.Sql, branchFilter: Prisma.Sql, riderScoped: boolean) {
  return Prisma.sql`
      SELECT
        COALESCE(SUM(c.collected_amount), 0) AS total_collected,
        -- remitted_amount only moves once a statement is paid in full, so a
        -- partially_paid statement's instalments are counted through pp below.
        COALESCE(SUM(LEAST(c.remitted_amount + c.collected_amount * pp.vendor_frac, c.collected_amount)), 0) AS settled_to_vendor,
        COALESCE(SUM(LEAST(c.rider_remitted_amount + c.collected_amount * pp.rider_frac, c.collected_amount)), 0) AS settled_to_rider,
        -- Cash a ParcelMoover rider physically holds, not yet remitted to the
        -- office. r.carrier_code IS NULL / c.carrier_code IS NULL leave out the
        -- carrier placeholder riders ("PM Rider N/U") and anything a 3PL
        -- delivered - that cash is with the carrier, counted below. Branch
        -- parcels are left out too: their branch answers for that cash.
        COALESCE(SUM(c.collected_amount - LEAST(c.rider_remitted_amount + c.collected_amount * pp.rider_frac, c.collected_amount))
          FILTER (WHERE ${pmRiderFilterSql(riderScoped ? null : branchFilter)}), 0) AS cod_from_pm_rider,
        -- Cash a 3PL carrier collected on parcels it delivered (c.carrier_code,
        -- stamped at delivery) and hasn't paid us yet: full COD until it is on a
        -- carrier statement, then its net less its share of what was paid.
        COALESCE(SUM(${CARRIER_OWED_SQL})
          FILTER (WHERE c.carrier_code = 'ncm'), 0) AS cod_from_ncm,
        COALESCE(SUM(${CARRIER_OWED_SQL})
          FILTER (WHERE c.carrier_code = 'upaya'), 0) AS cod_from_upaya,
        -- COD every branch together still owes head office, whether it is with
        -- a branch rider or already at the branch (BRANCH_OWED_SQL).
        COALESCE(SUM(${BRANCH_OWED_SQL}) FILTER (WHERE ${branchFilter}), 0) AS cod_from_branches,
        -- Cleared by the same fraction as the COD above, so the vendor card's
        -- net pending (COD - charge) drops by exactly what was paid out.
        COALESCE(SUM(p.delivery_charge * (1 - pp.vendor_frac)) FILTER (WHERE c.payment_status::text = 'pending'), 0) AS pending_delivery_charge,
        COALESCE(SUM(p.delivery_charge), 0) AS total_delivery_charge
      FROM cod_collections c
      JOIN parcels p ON p.id = c.parcel_id
      LEFT JOIN riders r ON r.id = c.rider_id
      LEFT JOIN LATERAL (${PART_PAID_FRACTIONS_SQL}) pp ON TRUE
      LEFT JOIN LATERAL (${BRANCH_CLEARED_SQL}) bs ON TRUE
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
        ${scope}
    `;
}
