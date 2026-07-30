// One-off reconciliation: zero the COD ledger on parcels that are no longer in
// a delivered status. Before un-delivery started reversing the ledger, a
// super_admin forcing a parcel back out of delivered/partially_delivered left
// cod_collections.collected_amount frozen at its delivery-time value. A later
// COD edit only re-synced cod_amount, so those rows ended up with (say)
// cod_amount = 0 and collected_amount = 5000 - still listed as settleable, and
// still counted in the vendor's account balance, for cash nobody is holding.
//
// The invariant (now enforced by updateParcelStatus / bulkUpdateParcelStatus) is:
// collected_amount > 0 only while the parcel is delivered or partially_delivered.
// This script resets any row that breaks it.
//
// Rows whose COD has already moved through a settlement statement are SKIPPED
// and listed instead - the books there need a statement void/amendment, not a
// silent rewrite. (Going forward the same case is refused at the API with a 409.)
//
// Safe to re-run: once the data is consistent, the updateMany matches zero rows.
//
// Usage:
//   ts-node --transpile-only scripts/reconcile-undelivered-cod.ts [--dry-run]
import "dotenv/config";
import type { Prisma } from "../src/generated/prisma/client";
import prisma from "../src/lib/prisma";

const DELIVERED = ["delivered", "partially_delivered"] as const;

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Collected cash recorded against a parcel that is not (or no longer) delivered.
  const drifted: Prisma.cod_collectionsWhereInput = {
    collected_amount: { gt: 0 },
    parcels: { status: { notIn: [...DELIVERED] } },
  };

  // Already in a statement on either leg - money may have moved, so leave it be.
  const settled: Prisma.cod_collectionsWhereInput = {
    ...drifted,
    OR: [
      { payment_status: "paid" },
      { rider_payment_status: "paid" },
      { settlement_items: { some: {} } },
    ],
  };

  const blocked = await prisma.cod_collections.findMany({
    where: settled,
    select: {
      collected_amount: true,
      parcels: { select: { tracking_id: true, status: true } },
    },
  });

  const fixable: Prisma.cod_collectionsWhereInput = {
    ...drifted,
    payment_status: "pending",
    rider_payment_status: "pending",
    settlement_items: { none: {} },
  };
  const fixableCount = await prisma.cod_collections.count({ where: fixable });

  console.log(`Rows to reset (collected -> 0 on a non-delivered parcel): ${fixableCount}`);
  if (blocked.length > 0) {
    console.log(`\nSkipped ${blocked.length} row(s) already tied to a settlement statement - review these manually:`);
    for (const row of blocked) {
      console.log(`  ${row.parcels.tracking_id}  status=${row.parcels.status}  collected=${row.collected_amount}`);
    }
  }

  if (dryRun) {
    console.log("\n--dry-run: no changes written.");
    return;
  }

  const res = await prisma.cod_collections.updateMany({
    where: fixable,
    data: { collected_amount: 0, collected_at: null },
  });

  console.log(`\nReset ${res.count} collection(s).`);
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
