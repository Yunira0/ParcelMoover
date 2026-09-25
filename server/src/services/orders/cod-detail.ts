import { Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import {
  HANDOFF_REMARK_PREFIX as NCM_HANDOFF_REMARK_PREFIX,
  UPAYA_HANDOFF_REMARK_PREFIX,
} from "../../utils/carrierRemark";
import { getActorScope, branchHandlesSql } from "./scope";
import type { OrderActor } from "./types";

// ── COD settlement detail (drill-down from the dashboard card) ──────────────

export const COD_DETAIL_BUCKETS = [
  "total",
  "settled",
  "pending",
  "pm-rider",
  "ncm",
  "upaya",
  "delivery-charge",
] as const;
export type CodDetailBucket = (typeof COD_DETAIL_BUCKETS)[number];

export interface CodDetailRow {
  id: string;
  trackingId: string;
  orderNumber: number;
  vendorName: string;
  receiverName: string;
  riderName: string | null;
  collectedAmount: number;
  riderRemittedAmount: number;
  remittedAmount: number;
  deliveryCharge: number;
  /** The amount this bucket is actually about for this row, so the rows always
   *  sum to the dashboard figure that linked here: gross collection for
   *  'total', the settled leg for 'settled', the office's cut for
   *  'delivery-charge', and outstanding cash for the rest. */
  bucketAmount: number;
  deliveredAt: string | null;
}

// Same cap-and-flag shape as VendorMetricDetail's bulk-fetch pattern on the
// client - COD buckets are bounded per-vendor/per-office data, not a
// high-volume list, so one capped query is simpler than cursor pagination
// and matches how the rest of this app already handles dashboard drill-downs.
const COD_DETAIL_ROW_CAP = 1000;

export async function getCodSettlementDetail(
  actor: OrderActor,
  bucket: CodDetailBucket,
): Promise<{ rows: CodDetailRow[]; capped: boolean }> {
  const { vendorId, vendorIds, riderId, branchLocationIds } = await getActorScope(actor);

  // Joins `p` (parcels) alongside `c`, so the branch check reads off that join.
  const codScopeSql: Prisma.Sql = vendorId
    ? Prisma.sql`AND c.vendor_id = ${vendorId}::uuid`
    : vendorIds
    ? Prisma.sql`AND c.vendor_id = ANY(${vendorIds}::uuid[])`
    : riderId
    ? Prisma.sql`AND c.rider_id = ${riderId}::uuid`
    : branchLocationIds
    ? branchHandlesSql(branchLocationIds, "p.")
    : Prisma.empty;

  // Same durable NCM/Upaya signals as the dashboard summary above - see its comment.
  const ncmHandoffExistsSql = Prisma.sql`EXISTS (
    SELECT 1 FROM parcel_remarks pr
    WHERE pr.parcel_id = p.id AND pr.remark LIKE ${NCM_HANDOFF_REMARK_PREFIX + "%"}
  )`;
  const upayaHandoffExistsSql = Prisma.sql`EXISTS (
    SELECT 1 FROM parcel_remarks pr
    WHERE pr.parcel_id = p.id AND pr.remark LIKE ${UPAYA_HANDOFF_REMARK_PREFIX + "%"}
  )`;

  // The "settled" leg is scope-dependent, exactly as in computeDashboardSummary:
  // a rider's own dashboard measures settlement as cash remitted to the office
  // (rider_remitted_amount), everyone else's as cash remitted onward to the
  // vendor (remitted_amount). Reusing one column for both would make a rider's
  // drill-down disagree with the card that linked to it.
  const remittedColSql: Prisma.Sql = riderId
    ? Prisma.sql`c.rider_remitted_amount`
    : Prisma.sql`c.remitted_amount`;
  const settledExprSql = Prisma.sql`LEAST(${remittedColSql}, c.collected_amount)`;
  const pendingExprSql = Prisma.sql`c.collected_amount - ${settledExprSql}`;

  // Mirrors the per-bucket formulas in computeDashboardSummary exactly, so a
  // detail page's rows always sum to the dashboard figure that linked here.
  const bucketFilterSql: Prisma.Sql =
    bucket === "settled"
      ? Prisma.sql`AND ${settledExprSql} > 0`
      : bucket === "pending"
        ? Prisma.sql`AND ${pendingExprSql} > 0`
        : bucket === "pm-rider"
          ? Prisma.sql`AND c.rider_id IS NOT NULL AND r.carrier_code IS NULL AND (c.collected_amount - LEAST(c.rider_remitted_amount, c.collected_amount)) > 0`
          : bucket === "ncm"
            ? Prisma.sql`AND ((c.rider_id IS NULL AND ${ncmHandoffExistsSql}) OR r.carrier_code = 'ncm') AND (c.collected_amount - LEAST(c.remitted_amount, c.collected_amount)) > 0`
            : bucket === "upaya"
              ? Prisma.sql`AND ((c.rider_id IS NULL AND ${upayaHandoffExistsSql}) OR r.carrier_code = 'upaya') AND (c.collected_amount - LEAST(c.remitted_amount, c.collected_amount)) > 0`
              : Prisma.empty; // 'total' and 'delivery-charge': every in-scope row

  // Each bucket's rows must add up to the exact figure on the card, so the
  // per-row amount is the bucket's own measure - the gross collection for
  // "total", the settled leg for "settled", the office's cut for
  // "delivery-charge", and outstanding cash for the rest.
  const outstandingExprSql: Prisma.Sql =
    bucket === "total"
      ? Prisma.sql`c.collected_amount`
      : bucket === "settled"
        ? settledExprSql
        : bucket === "pm-rider"
          ? Prisma.sql`c.collected_amount - LEAST(c.rider_remitted_amount, c.collected_amount)`
          : bucket === "ncm" || bucket === "upaya"
            ? Prisma.sql`c.collected_amount - LEAST(c.remitted_amount, c.collected_amount)`
            : bucket === "delivery-charge"
              ? Prisma.sql`p.delivery_charge`
              : pendingExprSql;

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      tracking_id: string;
      order_number: number;
      vendor_name: string | null;
      receiver_name: string;
      rider_name: string | null;
      collected_amount: string;
      rider_remitted_amount: string;
      remitted_amount: string;
      delivery_charge: string;
      bucket_amount: string;
      delivered_at: Date | null;
    }>
  >(Prisma.sql`
    SELECT
      c.id,
      p.tracking_id,
      p.order_number,
      COALESCE(v.business_name, v.client_name) AS vendor_name,
      party.name AS receiver_name,
      r.name AS rider_name,
      c.collected_amount,
      c.rider_remitted_amount,
      c.remitted_amount,
      p.delivery_charge,
      (${outstandingExprSql}) AS bucket_amount,
      p.delivered_at
    FROM cod_collections c
    JOIN parcels p ON p.id = c.parcel_id
    JOIN parties party ON party.id = p.receiver_id
    LEFT JOIN vendors v ON v.id = c.vendor_id
    LEFT JOIN riders r ON r.id = c.rider_id
    WHERE p.deleted_at IS NULL
      AND p.status::text IN ('delivered', 'partially_delivered')
      ${codScopeSql}
      ${bucketFilterSql}
    ORDER BY p.delivered_at DESC NULLS LAST, c.id DESC
    LIMIT ${COD_DETAIL_ROW_CAP + 1}
  `);

  const capped = rows.length > COD_DETAIL_ROW_CAP;
  const trimmed = capped ? rows.slice(0, COD_DETAIL_ROW_CAP) : rows;

  return {
    capped,
    rows: trimmed.map((r) => ({
      id: r.id,
      trackingId: r.tracking_id,
      orderNumber: r.order_number,
      vendorName: r.vendor_name ?? "—",
      receiverName: r.receiver_name,
      riderName: r.rider_name,
      collectedAmount: Number(r.collected_amount),
      riderRemittedAmount: Number(r.rider_remitted_amount),
      remittedAmount: Number(r.remitted_amount),
      deliveryCharge: Number(r.delivery_charge),
      bucketAmount: Number(r.bucket_amount),
      deliveredAt: r.delivered_at ? r.delivered_at.toISOString() : null,
    })),
  };
}
