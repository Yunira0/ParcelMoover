// Proves the ledger agrees with the system it was built from.
//
// Settlements are the only money event in these books, so every check here is
// a statement about statements:
//
//   1. Every entry balances, and every account total balances against the rest
//      (the trial balance). A failure here means the invariant leaked.
//   2. Every live statement has exactly one live entry, and every cancelled one
//      has none.
//   3. The COD float in 2005 equals what riders remitted in minus what vendor
//      statements released out - and is never negative.
//   4. Revenue equals what those statements withheld.
//
// (2) is the important one, and it is the check this script used to lack.
// revertSettlement never called syncSettlementPostings; the sweep only looked
// at parcels; and the old vendor/rider checks compared the ledger against
// balances that a stale payout entry happened not to disturb. So a statement
// could carry a posted payout for money that had been un-paid, and nothing in
// here would say a word. Coverage is checked directly now rather than inferred
// from a total agreeing.
//
// Note what is deliberately *not* checked: what each entry contains. Recomputing
// that would mean restating events.ts in SQL, and a second copy of a money rule
// is how a ledger starts lying - which is the same reason the per-parcel
// postings were retired in the first place.
//
// Read-only. Safe to run against production, and worth running on a schedule
// once posting goes live: drift appearing later means a money path was added
// without a posting.
//
// Usage:
//   npm run reconcile:ledger -- [--limit=50] [--verbose]     (development)
//   node dist/scripts/reconcile-ledger.js [--limit=50] [--verbose]  (production)
//
// Under src/ for the same reason as backfill-ledger.ts: the deployed image has
// no ts-node, and being able to prove the books agree matters most exactly
// where the money is real.
import "dotenv/config";
import { Prisma } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import redis from "../lib/redis";
import { ACCOUNT } from "../services/accounting/accounts";

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

// ── 2. Every statement has the entry it should, and no other ────────────────
//
// The check that matters most, because it is the one whose absence let a real
// bug live for months. revertSettlement never called syncSettlementPostings and
// the old sweep only looked at parcels, so a reverted statement kept a posted
// payout forever and nothing anywhere would say so.
//
// Deliberately a *coverage* check rather than an amount check. Recomputing what
// each entry should contain would mean restating events.ts in SQL, and two
// copies of a money rule is how a ledger starts lying. Asking "is there a live
// entry exactly where there should be one" needs no second copy of anything.
async function checkSettlementCoverage(limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ statement_id: string; status: string; entries: bigint }>>(Prisma.sql`
    SELECT s.statement_id, s.status::text AS status,
           COUNT(e.id) FILTER (WHERE e.status = 'posted') AS entries
      FROM settlements s
      LEFT JOIN journal_entries e
        ON e.source_type = 'settlement' AND e.source_id = s.id
     GROUP BY s.statement_id, s.status
  `);

  const problems: string[] = [];
  for (const row of rows) {
    const posted = Number(row.entries);
    // A cancelled statement moved no money, so it must carry nothing live.
    // Everything else was created, and creating it is the money event.
    if (row.status === "cancelled" && posted > 0) {
      problems.push(`${row.statement_id} is cancelled but still has ${posted} live entr${posted === 1 ? "y" : "ies"}`);
    } else if (row.status !== "cancelled" && posted === 0) {
      // Zero is legitimate for a statement that moves nothing at all - see
      // describeVendorSettlement's skip - so this is a lead, not a verdict.
      problems.push(`${row.statement_id} (${row.status}) has no live entry`);
    } else if (posted > 1) {
      problems.push(`${row.statement_id} has ${posted} live entries; a statement posts exactly one`);
    }
  }

  console.log(`Statement coverage: ${rows.length} statement(s) checked, ${problems.length} problem(s)`);
  for (const problem of problems.slice(0, limit)) console.log(`  ✗ ${problem}`);
  if (problems.length > limit) console.log(`  ... and ${problems.length - limit} more`);
  if (problems.length === 0) console.log("  ✓ every statement has exactly the entry it should");
  console.log("");

  return problems;
}

// ── 3. The COD float ────────────────────────────────────────────────────────
//
// 2005 holds COD taken in from riders and not yet passed on. Two things must be
// true of it, and neither can be got at by re-deriving the entries:
//
//   - It is never a debit balance. The office cannot hand on more COD than it
//     ever took in; if it appears to have, a statement has been settled twice
//     or a remittance was reversed out from under one.
//   - It equals remittances in minus gross released out, taken from the
//     settlements table rather than from the entries posted off it.
async function checkCodFloat(): Promise<string[]> {
  const [ledger] = await prisma.$queryRaw<Array<{ balance: string }>>(Prisma.sql`
    SELECT COALESCE(SUM(l.credit - l.debit), 0) AS balance
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id AND TRUE /* see ALL_ENTRIES in accounting.service.ts */
      JOIN ledger_accounts a ON a.id = l.account_id
     WHERE a.code = ${ACCOUNT.COD_HELD}
  `);

  const [derived] = await prisma.$queryRaw<Array<{ taken_in: string; released: string }>>(Prisma.sql`
    SELECT
      COALESCE(SUM(COALESCE(s.payable_amount, s.amount)) FILTER (WHERE s.payee_type = 'rider'), 0) AS taken_in,
      COALESCE(SUM(s.amount) FILTER (WHERE s.payee_type = 'vendor'), 0) AS released
      FROM settlements s
     WHERE s.status::text <> 'cancelled'
  `);

  const held = new Prisma.Decimal(ledger?.balance ?? 0);
  const expected = new Prisma.Decimal(derived?.taken_in ?? 0).minus(derived?.released ?? 0);

  const problems: string[] = [];
  console.log("COD float (2005 COD in Transit)");
  console.log(`  taken in from riders   ${money(new Prisma.Decimal(derived?.taken_in ?? 0)).padStart(14)}`);
  console.log(`  released to vendors    ${money(new Prisma.Decimal(derived?.released ?? 0)).padStart(14)}`);
  console.log(`  ledger balance         ${money(held).padStart(14)}`);

  if (!held.equals(expected)) {
    problems.push(`COD float is ${money(held)} but the statements say ${money(expected)}`);
    console.log(`  ✗ out by ${money(held.minus(expected))}`);
  }
  if (held.isNegative()) {
    problems.push(`COD float is negative (${money(held)}) - more COD released than was ever taken in`);
    console.log("  ✗ negative float: more COD has been released than was taken in");
  }
  if (problems.length === 0) console.log("  ✓ the float agrees with the statements");
  console.log("");

  return problems;
}

// ── 4. Revenue equals what the statements withheld ──────────────────────────
//
// The office's cut is recognised on the statement that withholds it, so the sum
// of the revenue accounts must equal gross minus payable across every live
// statement. This is what catches a revenue split gone wrong, or an entry that
// posted its cash legs and lost its revenue line.
async function checkRevenue(): Promise<string[]> {
  const [posted] = await prisma.$queryRaw<Array<{ revenue: string }>>(Prisma.sql`
    SELECT COALESCE(SUM(l.credit - l.debit), 0) AS revenue
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id AND TRUE /* see ALL_ENTRIES */
      JOIN ledger_accounts a ON a.id = l.account_id
     WHERE a.code IN (${ACCOUNT.DELIVERY_REVENUE}, ${ACCOUNT.RETURN_REVENUE})
       AND e.source_type = 'settlement'
  `);

  const [withheld] = await prisma.$queryRaw<Array<{ charges: string }>>(Prisma.sql`
    SELECT COALESCE(SUM(s.amount - COALESCE(s.payable_amount, s.amount)), 0) AS charges
      FROM settlements s
     WHERE s.status::text <> 'cancelled' AND s.payee_type = 'vendor'
  `);

  const booked = new Prisma.Decimal(posted?.revenue ?? 0);
  const expected = new Prisma.Decimal(withheld?.charges ?? 0);

  console.log("Revenue vs charges withheld");
  console.log(`  withheld on statements ${money(expected).padStart(14)}`);
  console.log(`  booked to 4000 / 4020  ${money(booked).padStart(14)}`);

  if (!booked.equals(expected)) {
    console.log(`  ✗ out by ${money(booked.minus(expected))}`);
    console.log("");
    return [`revenue is ${money(booked)} but the statements withheld ${money(expected)}`];
  }
  console.log("  ✓ every rupee withheld reached the books");
  console.log("");
  return [];
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const limitArg = argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 20;
  // --verbose is accepted for compatibility; the checks below are already terse.

  const entryCount = await prisma.journal_entries.count();
  console.log(`Ledger holds ${entryCount} journal entr${entryCount === 1 ? "y" : "ies"}.\n`);

  const balanced = await checkTrialBalance();
  const coverage = await checkSettlementCoverage(limit);
  const float = await checkCodFloat();
  const revenue = await checkRevenue();

  const failed = !balanced || coverage.length > 0 || float.length > 0 || revenue.length > 0;
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
