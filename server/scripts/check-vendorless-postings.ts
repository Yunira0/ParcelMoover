// Answers the one question the 2010 removal turns on: is there anything in this
// database that the new rule would have refused?
//
// Account 2010 Direct Customer Payable held the vendor side of parcels booked
// without a vendor. It is gone from the chart, and posting now throws rather
// than booking a parcel or COD collection with no vendor. Two things decide
// whether that is safe here:
//
//   1. Does 2010 carry any posted entries? If it does, the migration keeps the
//      row (deactivated) instead of deleting it, and that balance stays on the
//      balance sheet as history.
//   2. Do vendor-less parcels or COD collections exist? Every one of them is a
//      posting that will now fail - either on the next sync, or the next time
//      the backfill runs.
//
// Read-only: every statement here is a SELECT. Safe against production.
//
// Usage:
//   npx ts-node --transpile-only scripts/check-vendorless-postings.ts [--limit=20]
import "dotenv/config";
import { Prisma } from "../src/generated/prisma/client";
import prisma from "../src/lib/prisma";

const CODE = "2010";

const money = (value: Prisma.Decimal) => value.toFixed(2);

function parseLimit(): number {
  const arg = process.argv.find((value) => value.startsWith("--limit="));
  const parsed = Number(arg?.split("=")[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 20;
}

// ── 1. The account row and what was posted to it ────────────────────────────

async function checkAccount(limit: number): Promise<boolean> {
  const account = await prisma.ledger_accounts.findUnique({
    where: { code: CODE },
    select: { id: true, name: true, is_active: true },
  });

  console.log(`\n── Account ${CODE} ──────────────────────────────────────────`);

  if (!account) {
    console.log("  Not present. Nothing to clean up - the migration will no-op.");
    return false;
  }

  console.log(`  Present: "${account.name}"${account.is_active ? "" : " (already inactive)"}`);

  const [lines, expenseCategory, expenseFunding, methods, children] = await Promise.all([
    prisma.journal_lines.aggregate({
      where: { account_id: account.id },
      _count: { _all: true },
      _sum: { debit: true, credit: true },
    }),
    prisma.expenses.count({ where: { account_id: account.id } }),
    prisma.expenses.count({ where: { paid_from_id: account.id } }),
    prisma.payment_methods.count({ where: { ledger_account_id: account.id } }),
    prisma.ledger_accounts.count({ where: { parent_id: account.id } }),
  ]);

  const debit = lines._sum.debit ?? new Prisma.Decimal(0);
  const credit = lines._sum.credit ?? new Prisma.Decimal(0);

  console.log(`  Journal lines:     ${lines._count._all}`);
  console.log(`  Debits / credits:  ${money(debit)} / ${money(credit)}`);
  console.log(`  Balance (Cr - Dr): ${money(credit.minus(debit))}`);
  console.log(`  Also referenced by: ${expenseCategory} expense categories, ${expenseFunding} expense fundings, ` +
    `${methods} payment methods, ${children} child accounts`);

  const referenced =
    lines._count._all > 0 || expenseCategory > 0 || expenseFunding > 0 || methods > 0 || children > 0;

  if (referenced) {
    console.log("\n  → The migration will KEEP this row and deactivate it. Its balance stays");
    console.log("    on the balance sheet, which is the honest outcome - deleting it would");
    console.log("    strand the entries that point at it.");
  } else {
    console.log("\n  → Nothing references it. The migration will DELETE the row cleanly.");
  }

  if (lines._count._all > 0) {
    const recent = await prisma.journal_lines.findMany({
      where: { account_id: account.id },
      select: {
        debit: true,
        credit: true,
        memo: true,
        entry: { select: { entry_no: true, bs_date: true, memo: true } },
      },
      orderBy: { entry_date: "desc" },
      take: limit,
    });
    console.log(`\n  Most recent ${recent.length} of ${lines._count._all} lines:`);
    for (const line of recent) {
      console.log(
        `    ${line.entry.entry_no}  ${line.entry.bs_date}  ` +
          `Dr ${money(line.debit)}  Cr ${money(line.credit)}  ${line.memo ?? line.entry.memo ?? ""}`,
      );
    }
  }

  return referenced;
}

// ── 2. Source rows the new rule would refuse ────────────────────────────────

async function checkSourceRows(limit: number): Promise<boolean> {
  console.log("\n── Rows the new rule would refuse ───────────────────────────");

  // Only parcels that have actually earned their charge can post, so an
  // undelivered vendor-less parcel is not yet a problem. Both counts are shown:
  // the first is what breaks today, the second is what breaks when it delivers.
  const [postableParcels, allParcels, collections] = await Promise.all([
    prisma.parcels.count({
      where: {
        vendor_id: null,
        deleted_at: null,
        OR: [
          { status: { in: ["delivered", "partially_delivered"] } },
          { order_type: "return", status: "returned_to_vendor" },
        ],
      },
    }),
    prisma.parcels.count({ where: { vendor_id: null, deleted_at: null } }),
    prisma.cod_collections.count({ where: { vendor_id: null } }),
  ]);

  console.log(`  COD collections with no vendor:            ${collections}`);
  console.log(`  Parcels with no vendor, charge earned:     ${postableParcels}`);
  console.log(`  Parcels with no vendor, any status:        ${allParcels}`);

  if (collections > 0 || allParcels > 0) {
    const parcels = await prisma.parcels.findMany({
      where: { vendor_id: null, deleted_at: null },
      select: { id: true, tracking_id: true, status: true, order_type: true, delivery_charge: true, created_at: true },
      orderBy: { created_at: "desc" },
      take: limit,
    });
    if (parcels.length > 0) {
      console.log(`\n  Most recent ${parcels.length} of ${allParcels} vendor-less parcels:`);
      for (const parcel of parcels) {
        console.log(
          `    ${parcel.tracking_id}  ${parcel.status}  ${parcel.order_type}  ` +
            `charge ${money(parcel.delivery_charge)}  ${parcel.created_at.toISOString().slice(0, 10)}`,
        );
      }
    }
  }

  return collections > 0 || allParcels > 0;
}

async function main() {
  const limit = parseLimit();

  const accountReferenced = await checkAccount(limit);
  const sourceRowsExist = await checkSourceRows(limit);

  console.log("\n── Verdict ──────────────────────────────────────────────────");
  if (!accountReferenced && !sourceRowsExist) {
    console.log("  ✓ Clean. Nothing was ever posted to 2010 and no vendor-less parcel or");
    console.log("    collection exists. Removing the account changes nothing in this data.");
  } else {
    if (accountReferenced) {
      console.log("  ! 2010 carries history. The migration keeps and deactivates it; its");
      console.log("    balance remains visible in the ledger and on the balance sheet.");
    }
    if (sourceRowsExist) {
      console.log("  ! Vendor-less rows exist. Each one will now throw instead of posting -");
      console.log("    give them a vendor, or reconsider retiring the account.");
    }
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
