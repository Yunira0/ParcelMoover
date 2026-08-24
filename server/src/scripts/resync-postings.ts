// Re-runs the posting authority over rows that already have entries.
//
// The difference between this and backfill-ledger.ts is the difference between
// postJournal and syncPosting. The backfill is idempotent *by existence*: it
// asks "does this row have an entry?" and stops if it does, which is right for
// filling in history and useless for correcting it. This script asks "does the
// entry match what the mapping says today?" and converges - posting, reversing,
// or reversing-and-reposting as needed.
//
// So this is the tool for a rule that changed. When the settlement mapping was
// rewritten to carry the whole COD cycle, every existing settlement entry was
// still in the old shape; nothing was missing, so the backfill had nothing to
// do. One `--source=settlement --all` brought the books into the new model.
//
// It is also the standing replacement for writing another one-off fix script.
// There are eight of those in this repo, most of them existing because a rule
// moved and the entries posted under the old one had no way back. This is the
// way back.
//
// Usage:
//   npm run resync:postings -- --source=settlement --all [--dry-run]
//   npm run resync:postings -- --source=settlement --since=2026-08-01
//   node dist/scripts/resync-postings.js --source=expense --all   (production)
//
// Under src/ for the same reason as backfill-ledger.ts and reconcile-ledger.ts:
// the deployed image has no ts-node, and repairing the books matters most
// exactly where the money is real.
import "dotenv/config";
import prisma from "../lib/prisma";
import redis from "../lib/redis";
import {
  syncExpensePostings,
  syncSettlementPostings,
  syncVendorPaymentPostings,
  type SyncSummary,
} from "../services/accounting/sync";

type SourceName = "settlement" | "vendor_payment" | "expense";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

interface Source {
  /** Ids of rows to re-sync, oldest first so voucher numbers come out in order. */
  candidates(since: Date | null): Promise<string[]>;
  /**
   * Takes a transaction client, and must. The balance trigger is DEFERRABLE
   * INITIALLY DEFERRED, so it fires at the end of the enclosing transaction -
   * and without one, that is the end of the entry INSERT's own implicit
   * transaction, before any line exists. Every posting fails with "0 lines".
   */
  sync(tx: Tx, ids: string[]): Promise<SyncSummary>;
}

// Every source is driven by `updated_at`, never by a status filter. A row that
// moved *out* of a posting state needs its entry reversed just as much as one
// that moved into it - filtering to "the ones that should have entries" would
// skip exactly the rows most likely to be wrong.
const SOURCES: Record<SourceName, Source> = {
  settlement: {
    candidates: async (since) =>
      (
        await prisma.settlements.findMany({
          where: since ? { updated_at: { gte: since } } : {},
          select: { id: true },
          orderBy: { updated_at: "asc" },
        })
      ).map((row) => row.id),
    sync: (tx, ids) => syncSettlementPostings(tx, ids, { reason: "manual resync" }),
  },
  vendor_payment: {
    candidates: async (since) =>
      (
        await prisma.vendor_payments.findMany({
          where: since ? { updated_at: { gte: since } } : {},
          select: { id: true },
          orderBy: { updated_at: "asc" },
        })
      ).map((row) => row.id),
    sync: (tx, ids) => syncVendorPaymentPostings(tx, ids, { reason: "manual resync" }),
  },
  expense: {
    candidates: async (since) =>
      (
        await prisma.expenses.findMany({
          where: since ? { updated_at: { gte: since } } : {},
          select: { id: true },
          orderBy: { updated_at: "asc" },
        })
      ).map((row) => row.id),
    sync: (tx, ids) => syncExpensePostings(tx, ids, { reason: "manual resync" }),
  },
};

// Small enough that one unreadable row costs little, since a chunk that throws
// takes its whole chunk with it.
const CHUNK = 25;

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

  const sourceName = arg("source") as SourceName | undefined;
  const sinceArg = arg("since");
  const all = argv.includes("--all");
  const dryRun = argv.includes("--dry-run");

  if (!sourceName || !(sourceName in SOURCES)) {
    console.error(`--source is required, one of: ${Object.keys(SOURCES).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (!all && !sinceArg) {
    // Nothing here is reversible except by more reversals, so the full-table
    // run has to be asked for by name rather than being what happens when you
    // forget an argument.
    console.error("Pass --all to re-sync every row, or --since=YYYY-MM-DD for a window.");
    process.exitCode = 1;
    return;
  }

  const since = sinceArg ? new Date(sinceArg) : null;
  if (since && Number.isNaN(since.getTime())) {
    console.error(`--since=${sinceArg} is not a date`);
    process.exitCode = 1;
    return;
  }

  const source = SOURCES[sourceName];
  const ids = await source.candidates(since);
  console.log(
    `${sourceName}: ${ids.length} row(s) to re-sync${since ? ` (updated since ${since.toISOString().slice(0, 10)})` : ""}.`,
  );

  if (dryRun) {
    console.log("--dry-run: nothing written. Re-run without it to apply.");
    return;
  }
  if (ids.length === 0) return;

  let changed = 0;
  let unresolved = 0;
  let failed = 0;

  for (let index = 0; index < ids.length; index += CHUNK) {
    const chunk = ids.slice(index, index + CHUNK);
    try {
      const summary = await prisma.$transaction((tx) => source.sync(tx, chunk), {
        timeout: 120_000,
        maxWait: 30_000,
      });
      changed += summary.changed;
      unresolved += summary.unresolved;
    } catch (error) {
      failed += chunk.length;
      console.error(`  ✗ chunk of ${chunk.length} failed:`, error);
    }
    process.stdout.write(`  ${Math.min(index + CHUNK, ids.length)}/${ids.length}\r`);
  }

  console.log(`\nDone. ${changed} entr${changed === 1 ? "y" : "ies"} written, reversed or restated.`);
  // Everything left alone is the healthy case: syncPosting answers "unchanged"
  // for a row whose books already agree, so a re-run over corrected data writes
  // nothing at all.
  if (unresolved > 0) console.log(`${unresolved} row(s) could not be described - see the errors above.`);
  if (failed > 0) {
    console.log(`${failed} row(s) in failed chunks were not touched.`);
    process.exitCode = 1;
  }
  console.log("Run `npm run reconcile:ledger` to confirm the books agree.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  // sync.ts pulls in services that open the shared Redis client, whose
  // reconnect timer keeps the event loop alive forever - disconnect both or the
  // script prints its results and hangs.
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
