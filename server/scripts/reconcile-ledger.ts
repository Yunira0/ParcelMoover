// Proves the ledger agrees with the system it was built from.
//
// This is the acceptance test for the whole shadow-mode phase. The ledger is
// only worth switching on if it reproduces, exactly, the numbers the business
// already runs on:
//
//   1. Every entry balances, and every account total balances against the rest
//      (the trial balance). A failure here means the invariant leaked.
//   2. Each vendor's Vendor account balance equals getVendorAccountBalance()
//      for that vendor - the derived figure from billing.service that drives
//      credit control today.
//   3. Each rider's Cash with Rider balance equals COD they collected minus
//      COD they have remitted, computed straight from cod_collections.
//
// (2) is the important one. Both sides are lifetime figures built from the same
// source rows by completely different routes - one a running sum of journal
// lines, the other a four-part aggregate query - so agreement to the paisa
// across every vendor is strong evidence the mapping is right.
//
// Read-only. Safe to run against production, and worth running on a schedule
// once posting goes live: drift appearing later means a money path was added
// without a posting.
//
// Usage:
//   ts-node --transpile-only scripts/reconcile-ledger.ts [--limit=50] [--verbose]
import "dotenv/config";
import { Prisma } from "../src/generated/prisma/client";
import prisma from "../src/lib/prisma";
import redis from "../src/lib/redis";
import { getVendorAccountBalance } from "../src/services/billing.service";
import { ACCOUNT } from "../src/services/accounting/accounts";

const ZERO = new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) => value.toFixed(2);

interface Drift {
  label: string;
  ledger: Prisma.Decimal;
  expected: Prisma.Decimal;
  difference: Prisma.Decimal;
}

// ── 1. Trial balance ────────────────────────────────────────────────────────

async function checkTrialBalance(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ code: string; name: string; debit: string; credit: string }>>(Prisma.sql`
    SELECT a.code, a.name,
           COALESCE(SUM(l.debit), 0)  AS debit,
           COALESCE(SUM(l.credit), 0) AS credit
      FROM ledger_accounts a
      LEFT JOIN journal_lines l ON l.account_id = a.id
      LEFT JOIN journal_entries e ON e.id = l.entry_id AND TRUE /* see ALL_ENTRIES in accounting.service.ts */
     GROUP BY a.code, a.name
     ORDER BY a.code
  `);

  let debitTotal = ZERO;
  let creditTotal = ZERO;

  console.log("Trial balance");
  console.log(`  ${"code".padEnd(6)} ${"account".padEnd(30)} ${"debit".padStart(16)} ${"credit".padStart(16)}`);
  for (const row of rows) {
    const debit = new Prisma.Decimal(row.debit);
    const credit = new Prisma.Decimal(row.credit);
    debitTotal = debitTotal.plus(debit);
    creditTotal = creditTotal.plus(credit);
    if (debit.isZero() && credit.isZero()) continue;
    console.log(`  ${row.code.padEnd(6)} ${row.name.slice(0, 30).padEnd(30)} ${money(debit).padStart(16)} ${money(credit).padStart(16)}`);
  }
  console.log(`  ${"".padEnd(6)} ${"TOTAL".padEnd(30)} ${money(debitTotal).padStart(16)} ${money(creditTotal).padStart(16)}`);

  const balanced = debitTotal.equals(creditTotal);
  console.log(balanced ? "  ✓ balanced\n" : `  ✗ OUT BY ${money(debitTotal.minus(creditTotal))}\n`);

  // Belt and braces: the trial balance can only balance if every entry does,
  // but naming the offending entries is far more useful than a bare total.
  const unbalanced = await prisma.$queryRaw<Array<{ entry_no: string; debit: string; credit: string }>>(Prisma.sql`
    SELECT e.entry_no,
           COALESCE(SUM(l.debit), 0)  AS debit,
           COALESCE(SUM(l.credit), 0) AS credit
      FROM journal_entries e
      LEFT JOIN journal_lines l ON l.entry_id = e.id
     GROUP BY e.id, e.entry_no
    HAVING COALESCE(SUM(l.debit), 0) <> COALESCE(SUM(l.credit), 0)
     LIMIT 20
  `);
  if (unbalanced.length > 0) {
    console.log("  ✗ unbalanced entries:");
    for (const row of unbalanced) console.log(`      ${row.entry_no}: debits ${row.debit}, credits ${row.credit}`);
    console.log("");
    return false;
  }

  return balanced;
}

// ── 2. Vendor control vs the derived balance ────────────────────────────────

async function checkVendors(limit: number, verbose: boolean): Promise<Drift[]> {
  // Credit-normal account, so the vendor's position is credits minus debits:
  // positive means the office owes them. That is the same sign convention
  // getVendorAccountBalance uses, which is what makes the two comparable.
  const ledgerRows = await prisma.$queryRaw<Array<{ party_id: string; balance: string }>>(Prisma.sql`
    SELECT l.party_id, COALESCE(SUM(l.credit - l.debit), 0) AS balance
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id AND TRUE /* see ALL_ENTRIES in accounting.service.ts */
      JOIN ledger_accounts a ON a.id = l.account_id
     WHERE a.code = ${ACCOUNT.VENDOR_CONTROL}
       AND l.party_type = 'vendor'
     GROUP BY l.party_id
  `);
  const ledgerByVendor = new Map(ledgerRows.map((row) => [row.party_id, new Prisma.Decimal(row.balance)]));

  const vendors = await prisma.vendors.findMany({
    where: { deleted_at: null },
    select: { id: true, client_name: true, business_name: true },
  });

  const drifts: Drift[] = [];
  let checked = 0;

  for (const vendor of vendors) {
    // skipCache, or a stale 30s cache entry could make a real drift invisible
    // (or invent one that is not there).
    const derived = await getVendorAccountBalance(vendor.id, { skipCache: true });
    const expected = new Prisma.Decimal(derived.balance);
    const ledger = ledgerByVendor.get(vendor.id) ?? ZERO;
    checked += 1;

    if (!ledger.equals(expected)) {
      drifts.push({
        label: `${vendor.business_name || vendor.client_name} (${vendor.id})`,
        ledger,
        expected,
        difference: ledger.minus(expected),
      });
    } else if (verbose && !expected.isZero()) {
      console.log(`  ✓ ${(vendor.business_name || vendor.client_name).slice(0, 40).padEnd(40)} ${money(expected).padStart(14)}`);
    }
  }

  console.log(`Vendor control: ${checked} vendor(s) checked, ${drifts.length} drifting`);
  for (const drift of drifts.slice(0, limit)) {
    console.log(`  ✗ ${drift.label}`);
    console.log(`      ledger ${money(drift.ledger)}   derived ${money(drift.expected)}   out by ${money(drift.difference)}`);
  }
  if (drifts.length > limit) console.log(`  ... and ${drifts.length - limit} more`);
  if (drifts.length === 0) console.log("  ✓ every vendor agrees to the paisa");
  console.log("");

  return drifts;
}

// ── 3. Cash with rider vs the collections ───────────────────────────────────

async function checkRiders(limit: number): Promise<Drift[]> {
  const ledgerRows = await prisma.$queryRaw<Array<{ party_id: string; balance: string }>>(Prisma.sql`
    SELECT l.party_id, COALESCE(SUM(l.debit - l.credit), 0) AS balance
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id AND TRUE /* see ALL_ENTRIES in accounting.service.ts */
      JOIN ledger_accounts a ON a.id = l.account_id
     WHERE a.code = ${ACCOUNT.CASH_WITH_RIDER}
       AND l.party_type = 'rider'
     GROUP BY l.party_id
  `);
  const ledgerByRider = new Map(ledgerRows.map((row) => [row.party_id, new Prisma.Decimal(row.balance)]));

  // The operational truth: cash collected, less what has been remitted through
  // a settled rider statement. rider_remitted_amount is only written when a
  // statement is actually paid, so this is genuinely "still in their pocket".
  //
  // Soft-deleted parcels are excluded for the same reason the vendor side
  // excludes them: billing.service scopes the whole balance to live parcels, so
  // a voided order must not appear on either side of this comparison.
  const derivedRows = await prisma.$queryRaw<Array<{ rider_id: string; name: string; balance: string }>>(Prisma.sql`
    SELECT c.rider_id,
           r.name,
           COALESCE(SUM(c.collected_amount - c.rider_remitted_amount), 0) AS balance
      FROM cod_collections c
      JOIN riders r ON r.id = c.rider_id
      JOIN parcels p ON p.id = c.parcel_id AND p.deleted_at IS NULL
     WHERE c.rider_id IS NOT NULL
     GROUP BY c.rider_id, r.name
  `);

  const drifts: Drift[] = [];
  const seen = new Set<string>();

  for (const row of derivedRows) {
    seen.add(row.rider_id);
    const expected = new Prisma.Decimal(row.balance);
    const ledger = ledgerByRider.get(row.rider_id) ?? ZERO;
    if (!ledger.equals(expected)) {
      drifts.push({
        label: `${row.name} (${row.rider_id})`,
        ledger,
        expected,
        difference: ledger.minus(expected),
      });
    }
  }

  // A rider with ledger lines but no collections at all would otherwise slip
  // through the loop above entirely.
  for (const [riderId, ledger] of ledgerByRider) {
    if (!seen.has(riderId) && !ledger.isZero()) {
      drifts.push({ label: `rider ${riderId} (no collections)`, ledger, expected: ZERO, difference: ledger });
    }
  }

  console.log(`Cash with rider: ${derivedRows.length} rider(s) checked, ${drifts.length} drifting`);
  for (const drift of drifts.slice(0, limit)) {
    console.log(`  ✗ ${drift.label}`);
    console.log(`      ledger ${money(drift.ledger)}   derived ${money(drift.expected)}   out by ${money(drift.difference)}`);
  }
  if (drifts.length > limit) console.log(`  ... and ${drifts.length - limit} more`);
  if (drifts.length === 0) console.log("  ✓ every rider agrees to the paisa");
  console.log("");

  return drifts;
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const limitArg = argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 20;
  const verbose = argv.includes("--verbose");

  const entryCount = await prisma.journal_entries.count();
  console.log(`Ledger holds ${entryCount} journal entr${entryCount === 1 ? "y" : "ies"}.\n`);

  const balanced = await checkTrialBalance();
  const vendorDrifts = await checkVendors(limit, verbose);
  const riderDrifts = await checkRiders(limit);

  const failed = !balanced || vendorDrifts.length > 0 || riderDrifts.length > 0;
  if (failed) {
    console.error("✗ Reconciliation FAILED - the ledger does not yet agree with the source data.");
    process.exitCode = 1;
  } else {
    console.log("✓ Reconciliation passed. The ledger reproduces the existing balances exactly.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  // Comparing against getVendorAccountBalance means pulling in billing.service,
  // which opens the shared Redis client. Its reconnect timer keeps the event
  // loop alive forever, so a script that only closes Prisma would print its
  // results and then hang - disconnect both.
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
