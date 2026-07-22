// One-off reconciliation: fix cod_collections that were marked paid at
// settlement *creation* time under the old flow (see git 5143aec "updated make
// payment in settlement"). Before that change, createSettlement immediately set
// payment_status = paid / rider_payment_status = paid even though the statement
// itself was still `pending`. The result is the reported inconsistency: the
// Order's COD screen shows an order as SETTLED while its statement on the
// Settlements screen is still PENDING.
//
// The honest model (now enforced by payForSettlement) is: a collection's leg is
// `paid` ONLY if it belongs to a `settled` statement of that leg. This script
// resets any collection that is `paid` but is NOT part of a settled statement
// back to `pending`, and zeroes the corresponding remitted amount (nothing was
// actually remitted while the statement is unpaid).
//
// Safe to re-run: once the data is consistent, every updateMany matches zero
// rows. It only ever moves rows paid -> pending; the reverse (a collection in a
// settled statement) is already kept in sync by payForSettlement.
//
// Usage:
//   ts-node --transpile-only scripts/reconcile-settlement-payment-status.ts [--dry-run]
import "dotenv/config";
import type { Prisma } from "../src/generated/prisma/client";
import { payment_status } from "../src/generated/prisma/enums";
import prisma from "../src/lib/prisma";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Vendor leg: paid, but not in any *settled* vendor statement.
  const vendorWhere: Prisma.cod_collectionsWhereInput = {
    payment_status: payment_status.paid,
    settlement_items: {
      none: { settlements: { payee_type: "vendor", status: "settled" } },
    },
  };

  // Rider leg: paid, but not in any *settled* rider statement.
  const riderWhere: Prisma.cod_collectionsWhereInput = {
    rider_payment_status: payment_status.paid,
    settlement_items: {
      none: { settlements: { payee_type: "rider", status: "settled" } },
    },
  };

  const [vendorCount, riderCount] = await Promise.all([
    prisma.cod_collections.count({ where: vendorWhere }),
    prisma.cod_collections.count({ where: riderWhere }),
  ]);

  console.log(`Vendor legs to reset (paid -> pending): ${vendorCount}`);
  console.log(`Rider legs to reset  (paid -> pending): ${riderCount}`);

  if (dryRun) {
    console.log("\n--dry-run: no changes written.");
    return;
  }

  const vendorRes = await prisma.cod_collections.updateMany({
    where: vendorWhere,
    data: { payment_status: payment_status.pending, remitted_amount: 0 },
  });

  const riderRes = await prisma.cod_collections.updateMany({
    where: riderWhere,
    data: { rider_payment_status: payment_status.pending, rider_remitted_amount: 0, rider_settled_at: null },
  });

  console.log(`\nReset ${vendorRes.count} vendor leg(s) and ${riderRes.count} rider leg(s) to pending.`);
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
