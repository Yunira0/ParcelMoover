// Gives a payment method to settlements that were recorded without one, and
// moves the money they parked in the retired family accounts.
//
// 1030 Digital Wallets and 1090 Unclassified Funds collected exactly the
// payments nobody had decided about: settlements with payment_method null, and
// splits naming a method ("online") that no longer has an account. Both
// accounts are retired now, and posting refuses a method it cannot place - so
// these rows have to name a real method before the books can be tidy.
//
// What it does, per settlement:
//   - payments null            -> set payment_method to the target
//   - payments with splits     -> rewrite only the splits whose method has no
//                                 account, leaving cash (and anything already
//                                 routable) exactly where it is
// then resyncs, which reverses the old entry and posts a restatement. Nothing
// is deleted; the original and its reversal both stay in the journal.
//
// Dry run by default. Pass --apply to commit.
//
// Usage:
//   npx ts-node --transpile-only scripts/repoint-unrouted-settlements.ts [--apply] [--method="prabhu bank"]
import "dotenv/config";
import prisma from "../src/lib/prisma";
import redis from "../src/lib/redis";
import { cashAccountForMethod, loadMethodAccounts } from "../src/services/accounting/accounts";
import { syncSettlementPostings } from "../src/services/accounting/sync";

const APPLY = process.argv.includes("--apply");
const METHOD =
  process.argv.find((arg) => arg.startsWith("--method="))?.split("=").slice(1).join("=").replace(/^"|"$/g, "") ??
  "prabhu bank";

/** The accounts whose balances this is meant to clear. */
const RETIRED = ["1030", "1090"];

interface Split {
  method?: string | null;
  amount?: number | string;
}

async function main() {
  if (!APPLY) console.log("Dry run - nothing will be written. Pass --apply to commit.\n");

  const methodAccounts = await loadMethodAccounts(prisma);

  // The target has to be a method that actually owns an account, or this just
  // moves the problem.
  const target = cashAccountForMethod(METHOD, methodAccounts);
  if (!target) {
    console.error(`✗ "${METHOD}" has no ledger account. Add it as a payment method first.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Target: "${METHOD}" → account ${target}\n`);

  // Driven off the ledger, so a half-finished run can simply be run again.
  const accounts = await prisma.ledger_accounts.findMany({
    where: { code: { in: RETIRED } },
    select: { id: true, code: true },
  });
  if (accounts.length === 0) {
    console.log("Neither retired account exists. Nothing to move.");
    return;
  }

  const lines = await prisma.journal_lines.findMany({
    where: { account_id: { in: accounts.map((a) => a.id) }, entry: { status: "posted" } },
    select: { entry: { select: { source_type: true, source_id: true } } },
  });
  const settlementIds = Array.from(
    new Set(
      lines
        .filter((line) => line.entry.source_type === "settlement" && line.entry.source_id)
        .map((line) => line.entry.source_id!),
    ),
  );

  if (settlementIds.length === 0) {
    console.log("No posted settlement entries reference those accounts. Nothing to move.");
    return;
  }

  const settlements = await prisma.settlements.findMany({
    where: { id: { in: settlementIds } },
    select: { id: true, statement_id: true, payment_method: true, payments: true, payable_amount: true },
  });

  // Chicken and egg: the accounts were deactivated when they were retired, and
  // an inactive account cannot be posted to - but emptying one *requires*
  // posting a reversal into it. Lifted for the duration and put back at the end.
  if (APPLY) {
    await prisma.ledger_accounts.updateMany({ where: { code: { in: RETIRED } }, data: { is_active: true } });
    console.log(`  (${RETIRED.join(", ")} reactivated for the reversals)\n`);
  }

  let moved = 0;

  for (const settlement of settlements) {
    const splits = Array.isArray(settlement.payments) ? (settlement.payments as Split[]) : null;

    let nextMethod = settlement.payment_method;
    let nextSplits: Split[] | null = null;

    if (!splits || splits.length === 0) {
      nextMethod = METHOD;
      console.log(`  ${settlement.statement_id}  method ${settlement.payment_method ?? "(none)"} → "${METHOD}"`);
    } else {
      // A split needs moving if its method has no account at all, or if that
      // account is one of the retired ones - a method still pointing at 1030
      // technically "routes", which is exactly why its money is stuck there.
      const stuck = (split: Split) => {
        const code = cashAccountForMethod(split.method, methodAccounts);
        return !code || RETIRED.includes(code);
      };
      const rewritten = splits.map((split) => (stuck(split) ? { ...split, method: METHOD } : split));
      const changed = rewritten.filter((split, i) => split.method !== splits[i]!.method);
      if (changed.length === 0) {
        console.log(`  ${settlement.statement_id}  every split already routes - skipping`);
        continue;
      }
      nextSplits = rewritten;
      nextMethod = Array.from(new Set(rewritten.map((s) => s.method).filter(Boolean))).join(", ");
      console.log(
        `  ${settlement.statement_id}  ${changed.length} of ${splits.length} split(s) → "${METHOD}"` +
          `  (header "${settlement.payment_method ?? "(none)"}" → "${nextMethod}")`,
      );
    }

    moved += 1;
    if (!APPLY) continue;

    await prisma.settlements.update({
      where: { id: settlement.id },
      data: {
        payment_method: nextMethod,
        ...(nextSplits ? { payments: nextSplits as never } : {}),
      },
    });

    // Inside a transaction: postJournal writes the entry and its lines as two
    // statements, and the balanced trigger is DEFERRABLE INITIALLY DEFERRED, so
    // outside one the entry auto-commits alone with zero lines and the
    // constraint fires. Every production call site passes a `tx` for this reason.
    const summary = await prisma.$transaction((tx) =>
      syncSettlementPostings(tx, [settlement.id], { reason: "payment method recorded after the fact" }),
    );
    console.log(`    ${summary.changed} entr(ies) restated, ${summary.unresolved} unresolved`);
  }

  if (APPLY) {
    await prisma.ledger_accounts.updateMany({ where: { code: { in: RETIRED } }, data: { is_active: false } });
    console.log(`\n  (${RETIRED.join(", ")} deactivated again)`);
  }

  console.log(
    APPLY
      ? `\n✓ ${moved} settlement(s) repointed. Re-run reconcile:ledger and check ${RETIRED.join("/")} are flat.`
      : `\n${moved} settlement(s) would be repointed. Re-run with --apply to commit.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    redis.disconnect();
  });
