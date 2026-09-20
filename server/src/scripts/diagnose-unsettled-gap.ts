// Read-only diagnostic: why does a vendor show more delivered orders on the
// Vendor Overview than the settlement page offers to settle?
//
// The two screens count different tables. The overview counts parcels
// (p.vendor_id, status delivered/partially_delivered). getUnsettledOrders
// counts cod_collections, and every clause it adds is a way for a delivered
// parcel to drop out:
//
//   cc row missing          - no cod_collections row for the parcel at all
//   vendor_id mismatch      - cc.vendor_id NULL or pointing elsewhere; it is
//                             denormalized off the parcel and only resynced
//                             for payment_status 'pending' rows
//   collected_at NULL       - never stamped by a delivery transition
//   payment_status not pending - already marked paid
//   on a statement          - bundled into a vendor settlement of ANY status
//
// This prints, per vendor, how many delivered parcels each clause removes, so
// the gap can be attributed instead of guessed at.
//
// Every statement is a SELECT. Safe against production.
//
// Usage:
//   ts-node --transpile-only src/scripts/diagnose-unsettled-gap.ts [--vendor=<uuid>] [--limit=10]
import "dotenv/config";
import { Prisma } from "../generated/prisma/client";
import prisma from "../lib/prisma";

type Row = {
  vendor_id: string | null;
  company: string | null;
  delivered: bigint;
  no_cc_row: bigint;
  vendor_mismatch: bigint;
  collected_at_null: bigint;
  not_pending: bigint;
  on_statement: bigint;
  settleable: bigint;
};

async function main() {
  const args = process.argv.slice(2);
  const vendorArg = args.find((a) => a.startsWith("--vendor="))?.split("=")[1];
  const limit = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 10);

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      p.vendor_id::text                                              AS vendor_id,
      COALESCE(v.business_name, v.client_name)                       AS company,
      COUNT(*)::bigint                                               AS delivered,
      COUNT(*) FILTER (WHERE cc.id IS NULL)::bigint                  AS no_cc_row,
      COUNT(*) FILTER (WHERE cc.id IS NOT NULL
                         AND cc.vendor_id IS DISTINCT FROM p.vendor_id)::bigint AS vendor_mismatch,
      COUNT(*) FILTER (WHERE cc.id IS NOT NULL
                         AND cc.collected_at IS NULL)::bigint        AS collected_at_null,
      COUNT(*) FILTER (WHERE cc.id IS NOT NULL
                         AND cc.payment_status <> 'pending')::bigint AS not_pending,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM settlement_items si
        JOIN settlements s ON s.id = si.settlement_id AND s.payee_type = 'vendor'
        WHERE si.cod_collection_id = cc.id
      ))::bigint                                                     AS on_statement,
      COUNT(*) FILTER (WHERE cc.id IS NOT NULL
                         AND cc.vendor_id = p.vendor_id
                         AND cc.collected_at IS NOT NULL
                         AND cc.payment_status = 'pending'
                         AND NOT EXISTS (
                           SELECT 1 FROM settlement_items si
                           JOIN settlements s ON s.id = si.settlement_id AND s.payee_type = 'vendor'
                           WHERE si.cod_collection_id = cc.id
                         ))::bigint                                  AS settleable
    FROM parcels p
    LEFT JOIN cod_collections cc ON cc.parcel_id = p.id
    LEFT JOIN vendors v ON v.id = p.vendor_id
    WHERE p.deleted_at IS NULL
      AND p.status IN ('delivered','partially_delivered')
      ${vendorArg ? Prisma.sql`AND p.vendor_id = ${vendorArg}::uuid` : Prisma.empty}
    GROUP BY p.vendor_id, v.business_name, v.client_name
    ORDER BY (COUNT(*) - COUNT(*) FILTER (WHERE cc.id IS NOT NULL
                         AND cc.vendor_id = p.vendor_id
                         AND cc.collected_at IS NOT NULL
                         AND cc.payment_status = 'pending'
                         AND NOT EXISTS (
                           SELECT 1 FROM settlement_items si
                           JOIN settlements s ON s.id = si.settlement_id AND s.payee_type = 'vendor'
                           WHERE si.cod_collection_id = cc.id
                         ))) DESC
    LIMIT ${limit}
  `;

  if (rows.length === 0) {
    console.log("No delivered parcels found.");
    return;
  }

  console.log("Vendors with the largest delivered-vs-settleable gap:\n");
  for (const r of rows) {
    const delivered = Number(r.delivered);
    const settleable = Number(r.settleable);
    console.log(`${r.company ?? "(no vendor)"}  [${r.vendor_id ?? "vendor_id NULL"}]`);
    console.log(`  delivered ${delivered}  ->  settleable ${settleable}   gap ${delivered - settleable}`);
    console.log(
      `  removed by: no cc row ${r.no_cc_row}, vendor mismatch ${r.vendor_mismatch}, ` +
        `collected_at NULL ${r.collected_at_null}, not pending ${r.not_pending}, on a statement ${r.on_statement}`,
    );
    console.log("");
  }
  console.log("Note: the 'removed by' counts overlap - one parcel can fail several clauses.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
