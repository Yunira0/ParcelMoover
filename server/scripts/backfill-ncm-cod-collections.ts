// One-off backfill: NCM (3PL carrier)-delivered parcels never wrote their
// cod_collections row. applyExternalCarrierStatus (the carrier webhook/
// reconciliation path) "deliberately bypasses the actor-driven transition
// machinery" and, until this fix, only touched parcels.status/delivered_at -
// it never upserted cod_collections the way the internal rider-driven
// delivery path does (see order.service.ts _updateParcelStatusImpl). Result:
// every parcel delivered via NCM sits at status='delivered' forever with
// cod_collections.collected_at = null, so it can never appear in a vendor's
// COD settlement (getUnsettledOrders/getPendingCodBill both require
// collected_at to be set). Reported as: Shranistha Collection's COD
// Settlement showing no parcels despite a delivered order; turned out to
// affect every vendor with NCM-delivered COD parcels (284 rows in prod).
//
// This script finds parcels stuck in exactly that state and upserts their
// cod_collections row, using the actual NCM "Delivered" webhook timestamp
// (parcel_status_history.created_at) as collected_at rather than "now", so
// settlement dates reflect when the cash was really collected.
//
// Safe to re-run: once a row's collected_at is set, it no longer matches the
// selection criteria.
//
// Usage:
//   ts-node --transpile-only scripts/backfill-ncm-cod-collections.ts [--dry-run]
import "dotenv/config";
import prisma from "../src/lib/prisma";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const stuck = await prisma.$queryRaw<
    { parcel_id: string; tracking_id: string; vendor_id: string | null; cod_amount: string; rider_id: string | null; delivered_via_ncm_at: Date }[]
  >`
    select p.id as parcel_id, p.tracking_id, p.vendor_id, p.cod_amount, p.delivery_rider_id as rider_id, h.created_at as delivered_via_ncm_at
    from parcels p
    join cod_collections c on c.parcel_id = p.id
    join lateral (
      select created_at from parcel_status_history
      where parcel_id = p.id and new_status = 'delivered' and remarks ilike 'NCM:%'
      order by created_at desc limit 1
    ) h on true
    where p.status = 'delivered'
      and c.collected_at is null
  `;

  console.log(`Found ${stuck.length} NCM-delivered parcel(s) with an unrecorded cod_collections row.`);
  const totalCod = stuck.reduce((sum, r) => sum + Number(r.cod_amount), 0);
  console.log(`Total COD stuck: ${totalCod.toFixed(2)}`);

  if (dryRun) {
    console.log("\n--dry-run: no changes written.");
    for (const row of stuck.slice(0, 20)) {
      console.log(`  ${row.tracking_id}  vendor=${row.vendor_id}  cod=${row.cod_amount}  delivered=${row.delivered_via_ncm_at.toISOString()}`);
    }
    if (stuck.length > 20) console.log(`  ...and ${stuck.length - 20} more`);
    return;
  }

  let updated = 0;
  for (const row of stuck) {
    await prisma.cod_collections.update({
      where: { parcel_id: row.parcel_id },
      data: {
        collected_amount: row.cod_amount,
        collected_at: row.delivered_via_ncm_at,
      },
    });
    updated++;
  }

  console.log(`\nBackfilled ${updated} cod_collections row(s).`);
  console.log("Remember to clear the finance Redis cache (or wait for TTL) so the UI reflects the change.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
