// Dry run of the per-payment ledger postings against real data. Writes nothing.
//
// Inside one transaction that is always rolled back:
//   1. sync every statement the old way (one entry each), repairing any drift
//   2. reverse those entries and sync the new way (statement + one per payment)
//   3. sync again, which must change nothing
// then check every statement, and the trial balance, nets the same after 1 and 2.
//
// Run it against a copy of production before deploying; exit code 1 on any
// difference.
//   npm run ledger:dry-run -- [--verbose]
//   npm run ledger:dry-run:prod -- [--verbose]
import "dotenv/config";
import { Prisma } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import { EVENT_KEY } from "../services/accounting/events";
import { reverseJournal } from "../services/accounting/posting.service";
import {
  syncBranchSettlementPostings,
  syncCarrierSettlementPostings,
  syncSettlementPostings,
} from "../services/accounting/sync";

type Tx = Prisma.TransactionClient;

const SOURCES = ["settlement", "branch_settlement", "carrier_settlement"];
const OLD_KEYS = [EVENT_KEY.riderRemittance, EVENT_KEY.vendorSettlement, EVENT_KEY.branchSettlement, EVENT_KEY.carrierSettlement];
const CHUNK = 50;

class Rollback extends Error {}

/** Net per account and party, keyed by `group`, over the entries `where` picks. */
async function balances(tx: Tx, group: Prisma.Sql, where: Prisma.Sql): Promise<Map<string, string>> {
  const rows = await tx.$queryRaw<Array<{ key: string; line: string; net: string }>>(Prisma.sql`
    SELECT ${group} AS key, a.code || '|' || COALESCE(l.party_id::text, '') AS line, SUM(l.debit - l.credit)::text AS net
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      JOIN ledger_accounts a ON a.id = l.account_id
     WHERE ${where}
     GROUP BY 1, 2
  `);
  const out = new Map<string, string[]>();
  for (const row of rows) {
    if (new Prisma.Decimal(row.net).isZero()) continue;
    out.set(row.key, [...(out.get(row.key) ?? []), `${row.line}=${new Prisma.Decimal(row.net).toFixed(2)}`]);
  }
  return new Map([...out].map(([key, lines]) => [key, lines.sort().join(" ")]));
}

// A statement by its live entries; the journal by every entry, so each reversal cancels the entry it voids.
const perStatement = (tx: Tx) =>
  balances(tx, Prisma.sql`e.source_type::text || ':' || e.source_id::text`, Prisma.sql`e.status = 'posted' AND e.source_type::text IN (${Prisma.join(SOURCES)})`);
const trialBalance = (tx: Tx) => balances(tx, Prisma.sql`'journal'`, Prisma.sql`TRUE`);

async function syncAll(tx: Tx, ids: string[][]): Promise<{ changed: number; unresolved: number }> {
  const total = { changed: 0, unresolved: 0 };
  const syncs = [syncSettlementPostings, syncBranchSettlementPostings, syncCarrierSettlementPostings];
  for (const [index, sync] of syncs.entries()) {
    for (let i = 0; i < ids[index]!.length; i += CHUNK) {
      const summary = await sync(tx, ids[index]!.slice(i, i + CHUNK), { reason: "ledger dry run" });
      total.changed += summary.changed;
      total.unresolved += summary.unresolved;
    }
  }
  return total;
}

function differences(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((key) => before.get(key) !== after.get(key))
    .map((key) => `${key}\n      before ${before.get(key) ?? "(nothing)"}\n      after  ${after.get(key) ?? "(nothing)"}`);
}

async function main(): Promise<boolean> {
  const verbose = process.argv.includes("--verbose");
  const report: string[] = [];
  let ok = false;

  try {
    await prisma.$transaction(async (tx) => {
      const ids = await Promise.all([
        tx.settlements.findMany({ select: { id: true } }),
        tx.branch_settlements.findMany({ select: { id: true } }),
        tx.carrier_settlements.findMany({ select: { id: true } }),
      ]).then((tables) => tables.map((rows) => rows.map((row) => row.id)));
      report.push(`Statements: ${ids[0]!.length} rider/vendor, ${ids[1]!.length} branch, ${ids[2]!.length} 3PL`);

      process.env.LEDGER_PER_PAYMENT_POSTINGS = "off";
      const pass1 = await syncAll(tx, ids);
      const [statementsBefore, journalBefore] = [await perStatement(tx), await trialBalance(tx)];
      report.push(`1. Old way: ${pass1.changed} repaired (drift already in the books), ${pass1.unresolved} unreadable`);

      process.env.LEDGER_PER_PAYMENT_POSTINGS = "on";
      const oldEntries = await tx.journal_entries.findMany({
        where: { status: "posted", source_type: { in: SOURCES }, OR: OLD_KEYS.flatMap((key) => [{ event_key: key }, { event_key: { startsWith: `${key}#` } }]) },
        select: { id: true },
      });
      for (const entry of oldEntries) {
        await reverseJournal(tx, { entryId: entry.id, reason: "ledger dry run", allowClosedPeriod: true });
      }
      const pass2 = await syncAll(tx, ids);
      const [statementsAfter, journalAfter] = [await perStatement(tx), await trialBalance(tx)];
      report.push(`2. New way: ${oldEntries.length} moved across, ${pass2.unresolved} unreadable`);

      const pass3 = await syncAll(tx, ids);
      report.push(`3. Again: ${pass3.changed} changed (must be 0)`);

      const statementDiffs = differences(statementsBefore, statementsAfter);
      const journalDiffs = differences(journalBefore, journalAfter);
      report.push(`Statements that net differently: ${statementDiffs.length} (must be 0)`);
      report.push(`Trial balance differs: ${journalDiffs.length > 0 ? "yes" : "no"}`);
      for (const line of [...statementDiffs, ...journalDiffs].slice(0, verbose ? undefined : 20)) report.push(`  ✗ ${line}`);

      ok = statementDiffs.length === 0 && journalDiffs.length === 0 && pass3.changed === 0 && pass2.unresolved <= pass1.unresolved;
      throw new Rollback();
    }, { timeout: 30 * 60_000, maxWait: 30_000 });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  console.log(report.join("\n"));
  console.log(ok ? "\n✓ Safe: the split moves no money." : "\n✗ Do not deploy until the differences above are explained.");
  console.log("(rolled back - nothing was written)");
  return ok;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
