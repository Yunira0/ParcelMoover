// Gives a vendor-less parcel its vendor, and moves the money that followed it.
//
// Some parcels were booked without a vendor even though the sender is one -
// "online store" is a vendor record and a party record both, and the parcel
// only ever pointed at the party. Their COD and delivery charge booked to
// 2010 Direct Customer Payable, which is now retired: posting refuses a parcel
// with no vendor, so these rows would only fail from here on.
//
// Two phases, because the first can succeed and leave the second still to do:
//
//   1. Set vendor_id on the parcel and on its COD collection.
//   2. Resync every parcel whose entries still sit on 2010. syncParcelPostings
//      compares each line's account *and* party against what is posted, so
//      2010/no-party becomes 2000/this-vendor, the fingerprint changes, and it
//      reverses the old entries and posts restatements. Nothing is deleted -
//      the reversal and the original both stay in the journal, which is what
//      makes this auditable rather than a quiet edit.
//
// Phase 2 is driven off the ledger rather than off phase 1's results, so a run
// that half-finished can simply be run again.
//
// Dry run by default: prints what it would do and writes nothing. Pass --apply
// to commit.
//
// Usage:
//   npx ts-node --transpile-only scripts/attribute-vendorless-parcels.ts [--apply]
import "dotenv/config";
import prisma from "../src/lib/prisma";
import redis from "../src/lib/redis";
import { syncParcelPostings } from "../src/services/accounting/sync";

const APPLY = process.argv.includes("--apply");
const RETIRED_ACCOUNT = "2010";

/** Matches a vendor to a vendor-less parcel by its sender's name. */
async function resolveVendor(senderName: string | null | undefined) {
  if (!senderName) return null;
  const matches = await prisma.vendors.findMany({
    where: { business_name: { equals: senderName, mode: "insensitive" }, deleted_at: null },
    select: { id: true, business_name: true },
  });
  // Only act on an unambiguous match. Two vendors trading under the same name
  // is a question for a person, not a guess for a script.
  return matches.length === 1 ? matches[0]! : null;
}

// ── Phase 1: give the parcel its vendor ─────────────────────────────────────

async function attribute(): Promise<{ done: number; skipped: string[] }> {
  const parcels = await prisma.parcels.findMany({
    where: { vendor_id: null, deleted_at: null },
    select: {
      id: true,
      tracking_id: true,
      status: true,
      delivery_charge: true,
      cod_amount: true,
      parties_parcels_sender_idToparties: { select: { name: true } },
      cod_collections: { select: { id: true, vendor_id: true } },
    },
  });

  console.log(`\n── Phase 1: vendor-less parcels (${parcels.length}) ─────────────────────`);
  if (parcels.length === 0) console.log("  None. Nothing to attribute.");

  let done = 0;
  const skipped: string[] = [];

  for (const parcel of parcels) {
    const senderName = parcel.parties_parcels_sender_idToparties?.name ?? null;
    const vendor = await resolveVendor(senderName);

    if (!vendor) {
      skipped.push(`${parcel.tracking_id}  sender "${senderName ?? "?"}" matches no single vendor`);
      continue;
    }

    // A parcel carries at most one COD collection.
    const collection = parcel.cod_collections;
    console.log(`  ${parcel.tracking_id}  ${parcel.status}`);
    console.log(`    sender "${senderName}" → vendor ${vendor.business_name} (${vendor.id})`);
    console.log(
      `    charge ${parcel.delivery_charge.toFixed(2)}, COD ${parcel.cod_amount.toFixed(2)}, ` +
        `${collection && collection.vendor_id === null ? "collection to re-attribute" : "no collection to re-attribute"}`,
    );
    done += 1;

    if (!APPLY) continue;

    // Both rows move together, so a failure cannot leave the collection
    // pointing at one vendor and the parcel at none.
    await prisma.$transaction([
      prisma.parcels.update({ where: { id: parcel.id }, data: { vendor_id: vendor.id } }),
      prisma.cod_collections.updateMany({
        where: { parcel_id: parcel.id, vendor_id: null },
        data: { vendor_id: vendor.id },
      }),
    ]);
  }

  if (skipped.length > 0) {
    console.log(`\n  Left alone (${skipped.length}):`);
    for (const line of skipped) console.log(`    ${line}`);
  }

  return { done, skipped };
}

// ── Phase 2: move what is still posted to 2010 ──────────────────────────────

async function resync(): Promise<number> {
  const account = await prisma.ledger_accounts.findUnique({
    where: { code: RETIRED_ACCOUNT },
    select: { id: true },
  });

  console.log(`\n── Phase 2: entries still on ${RETIRED_ACCOUNT} ──────────────────────────`);
  if (!account) {
    console.log("  Account is gone. Nothing to move.");
    return 0;
  }

  const lines = await prisma.journal_lines.findMany({
    where: { account_id: account.id, parcel_id: { not: null }, entry: { status: "posted" } },
    select: { parcel_id: true },
    distinct: ["parcel_id"],
  });
  const parcelIds = lines.map((line) => line.parcel_id!).filter(Boolean);

  if (parcelIds.length === 0) {
    console.log("  No live entries reference a parcel. Nothing to move.");
    return 0;
  }

  const parcels = await prisma.parcels.findMany({
    where: { id: { in: parcelIds } },
    select: { id: true, tracking_id: true, vendor_id: true },
  });

  let moved = 0;
  for (const parcel of parcels) {
    if (!parcel.vendor_id) {
      console.log(`  ${parcel.tracking_id}  still has no vendor - skipping, phase 1 could not place it`);
      continue;
    }
    console.log(`  ${parcel.tracking_id}  resync → 2000 Vendor`);
    moved += 1;

    if (!APPLY) continue;

    // Must run inside a transaction. postJournal inserts the entry and its
    // lines as two statements, and the journal_entries_balanced trigger is
    // DEFERRABLE INITIALLY DEFERRED - so outside a transaction the entry
    // auto-commits on its own with zero lines and the constraint fires. Every
    // production call site passes a `tx` for the same reason.
    const summary = await prisma.$transaction((tx) =>
      syncParcelPostings(tx, [parcel.id], { reason: "vendor attributed after the fact" }),
    );
    console.log(`    ${summary.changed} entr(ies) restated, ${summary.unresolved} unresolved`);
  }

  return moved;
}

async function main() {
  if (!APPLY) console.log("Dry run - nothing will be written. Pass --apply to commit.");

  await attribute();
  const moved = await resync();

  console.log("\n── Verdict ──────────────────────────────────────────────────");
  if (APPLY) {
    console.log(`  ✓ ${moved} parcel(s) resynced. Re-run check:vendorless to confirm ${RETIRED_ACCOUNT} is now flat.`);
  } else {
    console.log(`  ${moved} parcel(s) would be resynced. Re-run with --apply to commit.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  // syncParcelPostings pulls in the shared Redis client, whose reconnect timer
  // keeps the event loop alive forever - a script that only closes Prisma would
  // print its results and then hang. Same reason reconcile-ledger.ts does this.
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
