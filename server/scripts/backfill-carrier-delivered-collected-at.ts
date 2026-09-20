// One-off backfill: zero-COD parcels delivered by an external carrier (NCM /
// Upaya) never got cod_collections.collected_at stamped. applyExternalCarrierStatus
// gated that stamp on cod_amount > 0, a guard the two in-house delivery paths
// had already dropped. getUnsettledOrders and getPendingCodBill both require
// collected_at IS NOT NULL, so those parcels are invisible on the settlement
// and pending-COD screens - and, because a zero-COD delivery still owes its
// delivery charge, that charge is never billed to the vendor. They show as
// delivered on the Vendor Overview the whole time, which is how the mismatch
// surfaces (21 delivered, 9 settleable).
//
// The carrier path now stamps collected_at for every delivery; this catches
// the backlog that transitioned before that fix shipped.
//
// Scoped to cod_amount = 0 deliberately. That is exactly the population the
// guard skipped, and it is the only population where stamping collected_at
// alone is correct: collected_amount is already 0, which is the truth for a
// zero-COD parcel. A delivered row with collected_at NULL *and* cod_amount > 0
// did not come from this bug - stamping it would record zero cash against a
// parcel that carried some - so those are only reported, never written.
//
// Safe to re-run: only touches rows where collected_at IS NULL, so once
// backfilled the where-clause matches zero rows.
//
// Usage:
//   ts-node --transpile-only scripts/backfill-carrier-delivered-collected-at.ts [--dry-run]
import "dotenv/config";
import type { Prisma } from "../src/generated/prisma/client";
import { parcel_status } from "../src/generated/prisma/enums";
import prisma from "../src/lib/prisma";
import { invalidateVendorFinanceCache } from "../src/services/finance.service";

const DELIVERED: parcel_status[] = [parcel_status.delivered, parcel_status.partially_delivered];

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const where: Prisma.cod_collectionsWhereInput = {
    collected_at: null,
    cod_amount: 0,
    parcels: { status: { in: DELIVERED }, deleted_at: null },
  };

  const rows = await prisma.cod_collections.findMany({
    where,
    select: {
      id: true,
      vendor_id: true,
      parcels: {
        select: { order_number: true, status: true, carrier_code: true, delivery_charge: true },
      },
    },
  });

  console.log(`cod_collections to backfill (collected_at -> now): ${rows.length}`);
  for (const r of rows) {
    const carrier = r.parcels.carrier_code ?? "in-house";
    console.log(`  #${r.parcels.order_number} (${r.parcels.status}, ${carrier}, charge ${r.parcels.delivery_charge})`);
  }

  // Not touched by this script - flagged so a human can decide. A delivered
  // parcel that carried COD but has no collected_at has a different cause,
  // and its collected_amount cannot be inferred safely here.
  const unexplained = await prisma.cod_collections.count({
    where: {
      collected_at: null,
      cod_amount: { gt: 0 },
      parcels: { status: { in: DELIVERED }, deleted_at: null },
    },
  });
  if (unexplained > 0) {
    console.log(
      `\nWARNING: ${unexplained} delivered row(s) also have collected_at NULL but cod_amount > 0.` +
        `\nThose are NOT from this bug and are left alone - investigate before settling them.`,
    );
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

  // The settlement and pending-COD screens are cached per vendor, so without
  // this they keep serving the pre-backfill counts until the TTL lapses.
  const vendorIds = [...new Set(rows.map((r) => r.vendor_id).filter((v): v is string => !!v))];
  for (const vendorId of vendorIds) {
    await invalidateVendorFinanceCache(vendorId);
  }

  console.log(`\nBackfilled ${res.count} row(s); cleared finance cache for ${vendorIds.length} vendor(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
