// One-off backfill: plain RTO parcels (order_type "delivery" bounced back to
// "returned_to_vendor") that transitioned before the RTO-repricing fix shipped
// - or before their vendor's return-percent override/the global default was
// configured - are still holding their full outbound delivery_charge instead
// of the discounted return-percent charge. The status-transition code now
// computes this correctly going forward; this catches the backlog by
// re-running the same computeReturnCharge quote against each one's CURRENT
// settings and updating parcels.delivery_charge if it changes.
//
// Genuine order_type "return" parcels are untouched - their charge was
// already priced this way from creation.
//
// Safe to re-run: recomputes and only writes rows whose charge actually
// changed, so a second run against unchanged settings is a no-op.
//
// Usage:
//   ts-node --transpile-only scripts/backfill-rto-return-charge.ts [--dry-run]
import "dotenv/config";
import { parcel_status, order_type } from "../src/generated/prisma/enums";
import prisma from "../src/lib/prisma";
import { computeReturnCharge } from "../src/services/order.service";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const parcels = await prisma.parcels.findMany({
    where: { status: parcel_status.returned_to_vendor, order_type: { not: order_type.return }, deleted_at: null },
    include: { vendors: true },
  });

  console.log(`Plain-RTO parcels at returned_to_vendor: ${parcels.length}`);

  let changed = 0;
  for (const p of parcels) {
    if (!p.destination_location_id) continue;
    const charge = await computeReturnCharge(
      p.vendors,
      p.destination_location_id,
      p.weight_kg === null ? null : Number(p.weight_kg),
      p.service_type,
    );
    if (charge === null) continue;
    const current = Number(p.delivery_charge);
    if (Math.abs(charge - current) < 0.01) continue;

    console.log(`  #${p.order_number} (${p.tracking_id}): ${current} -> ${charge}`);
    changed++;
    if (!dryRun) {
      await prisma.parcels.update({ where: { id: p.id }, data: { delivery_charge: charge } });
    }
  }

  console.log(dryRun ? `\n--dry-run: ${changed} row(s) would change, nothing written.` : `\nUpdated ${changed} row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
