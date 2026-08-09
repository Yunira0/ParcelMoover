// One-off backfill: parcels already sitting at status "returned_to_vendor"
// from before the RTV settlement-visibility fix never got cod_collections.
// collected_at stamped (the old code only did this for order_type "return");
// getUnsettledOrders requires collected_at IS NOT NULL, so those parcels -
// mostly plain RTO (order_type "delivery" bounced back) - are invisible on
// the unsettled/settlement screens even though the parcel itself is closed
// out. The status-transition code now stamps collected_at going forward for
// any parcel entering returned_to_vendor; this just catches the backlog that
// transitioned before that fix shipped.
//
// Safe to re-run: only touches rows where collected_at IS NULL, so once
// backfilled the where-clause matches zero rows.
//
// Usage:
//   ts-node --transpile-only scripts/backfill-rtv-collected-at.ts [--dry-run]
import "dotenv/config";
import type { Prisma } from "../src/generated/prisma/client";
import { parcel_status } from "../src/generated/prisma/enums";
import prisma from "../src/lib/prisma";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const where: Prisma.cod_collectionsWhereInput = {
    collected_at: null,
    parcels: { status: parcel_status.returned_to_vendor },
  };

  const rows = await prisma.cod_collections.findMany({
    where,
    select: { id: true, parcels: { select: { order_number: true, order_type: true } } },
  });

  console.log(`cod_collections to backfill (collected_at -> now): ${rows.length}`);
  for (const r of rows) {
    console.log(`  #${r.parcels.order_number} (${r.parcels.order_type})`);
  }

  if (dryRun) {
    console.log("\n--dry-run: no changes written.");
    return;
  }

  if (rows.length === 0) return;

  const res = await prisma.cod_collections.updateMany({
    where,
    data: { collected_at: new Date() },
  });

  console.log(`\nBackfilled ${res.count} row(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
