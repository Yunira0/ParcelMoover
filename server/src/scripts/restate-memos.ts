// Brings the memo on already-posted entries into line with what the mapping
// says today.
//
// The difference between this and resync-postings.ts is what counts as a
// change. syncPosting compares a fingerprint of account, debit, credit and
// party - deliberately, because that is the money, and restating an entry every
// time an unrelated field moved would fill the day book with reversal pairs
// that cancel to nothing. A memo is not money, so a reworded mapping is
// "unchanged" to the resync and old entries keep the old sentence forever.
//
// This is the way to fix that, and it is an in-place UPDATE rather than a
// reversal. That is allowed on purpose: assert_journal_entry_immutable() guards
// entry_date, period_key, bs_date, source_type, source_id, event_key and
// entry_no - everything that makes the entry an accounting fact - and does not
// guard memo. The label may be corrected; the fact may not.
//
// Line memos are out of scope. journal_lines are write-once under their own
// trigger, with no exceptions, so a line's memo is whatever it was posted with.
// Every screen that shows a sentence to a human - the day book, the voucher
// narration, the account ledger - reads the entry memo, so this reaches all of
// them.
//
// Usage:
//   npm run restate:memos -- --all --dry-run
//   npm run restate:memos -- --source=settlement
//   node dist/scripts/restate-memos.js --all        (production)
import "dotenv/config";
import prisma from "../lib/prisma";
import { loadMethodAccounts } from "../services/accounting/accounts";
import {
  describeExpense,
  describeRiderRemittance,
  describeVendorPaymentVerified,
  describeVendorSettlement,
  isSkip,
} from "../services/accounting/events";

type SourceName = "settlement" | "vendor_payment" | "expense";

const SOURCE_NAMES: SourceName[] = ["settlement", "vendor_payment", "expense"];

/** The memo each source's rows should carry, keyed by source_id. */
type MemoMap = Map<string, string>;

async function settlementMemos(): Promise<MemoMap> {
  const [rows, methodAccounts] = await Promise.all([
    prisma.settlements.findMany({
      where: { status: { not: "cancelled" } },
      select: {
        id: true,
        statement_id: true,
        payee_type: true,
        rider_id: true,
        vendor_id: true,
        amount: true,
        payable_amount: true,
        paid_amount: true,
        payment_method: true,
        payments: true,
        settlement_date: true,
        updated_at: true,
        status: true,
        riders: { select: { name: true } },
        vendors: { select: { client_name: true, business_name: true } },
      },
    }),
    loadMethodAccounts(prisma),
  ]);

  const memos: MemoMap = new Map();
  for (const row of rows) {
    const settlement = { ...row, methodAccounts };
    // describeX throws on a row it considers unpostable. That is the resync's
    // problem, not this script's - a memo it cannot derive is one it leaves
    // alone.
    try {
      const described =
        settlement.payee_type === "rider"
          ? describeRiderRemittance(settlement)
          : describeVendorSettlement(settlement);
      if (!isSkip(described)) memos.set(row.id, described.memo);
    } catch {
      // Left as posted.
    }
  }
  return memos;
}

async function vendorPaymentMemos(): Promise<MemoMap> {
  const [rows, methodAccounts] = await Promise.all([
    prisma.vendor_payments.findMany({
      where: { status: "verified" },
      select: {
        id: true,
        vendor_id: true,
        amount: true,
        method: true,
        reference: true,
        reviewed_at: true,
        created_at: true,
        vendors: { select: { client_name: true, business_name: true } },
      },
    }),
    loadMethodAccounts(prisma),
  ]);

  const memos: MemoMap = new Map();
  for (const row of rows) {
    try {
      const described = describeVendorPaymentVerified({ ...row, methodAccounts });
      if (!isSkip(described)) memos.set(row.id, described.memo);
    } catch {
      // Left as posted.
    }
  }
  return memos;
}

async function expenseMemos(): Promise<MemoMap> {
  const rows = await prisma.expenses.findMany({
    select: {
      id: true,
      expense_no: true,
      expense_date: true,
      amount: true,
      payee: true,
      note: true,
      location_id: true,
      party_type: true,
      party_id: true,
      status: true,
      account: { select: { code: true } },
      paid_from: { select: { code: true } },
    },
  });

  const memos: MemoMap = new Map();
  for (const row of rows) {
    try {
      const described = describeExpense(row);
      if (!isSkip(described)) memos.set(row.id, described.memo);
    } catch {
      // Left as posted.
    }
  }
  return memos;
}

const BUILDERS: Record<SourceName, () => Promise<MemoMap>> = {
  settlement: settlementMemos,
  vendor_payment: vendorPaymentMemos,
  expense: expenseMemos,
};

async function restate(source: SourceName, dryRun: boolean) {
  const memos = await BUILDERS[source]();
  if (memos.size === 0) {
    console.log(`${source}: nothing to check`);
    return { checked: 0, changed: 0 };
  }

  // Posted entries only. A voided one is history that its reversal already
  // answered, and rewording it would edit a record nobody reads forward from.
  const entries = await prisma.journal_entries.findMany({
    where: { source_type: source, source_id: { in: [...memos.keys()] }, status: "posted" },
    select: { id: true, entry_no: true, source_id: true, memo: true },
  });

  let changed = 0;
  for (const entry of entries) {
    const desired = entry.source_id ? memos.get(entry.source_id) : undefined;
    if (!desired || desired === entry.memo) continue;

    changed += 1;
    console.log(`  ${entry.entry_no}`);
    console.log(`    - ${entry.memo ?? "(none)"}`);
    console.log(`    + ${desired}`);

    if (!dryRun) {
      await prisma.journal_entries.update({ where: { id: entry.id }, data: { memo: desired } });
    }
  }

  console.log(`${source}: ${entries.length} posted entries, ${changed} reworded`);
  return { checked: entries.length, changed };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const all = args.includes("--all");
  const named = args.find((arg) => arg.startsWith("--source="))?.split("=")[1] as SourceName | undefined;

  if (!all && !named) {
    console.error("Usage: restate-memos --all [--dry-run] | --source=settlement|vendor_payment|expense");
    process.exit(1);
  }
  if (named && !SOURCE_NAMES.includes(named)) {
    console.error(`Unknown source "${named}" - expected one of ${SOURCE_NAMES.join(", ")}`);
    process.exit(1);
  }

  const sources = named ? [named] : SOURCE_NAMES;
  if (dryRun) console.log("Dry run - nothing will be written.\n");

  let checked = 0;
  let changed = 0;
  for (const source of sources) {
    const result = await restate(source, dryRun);
    checked += result.checked;
    changed += result.changed;
  }

  console.log(`\nTotal: ${checked} entries checked, ${changed} ${dryRun ? "would be " : ""}reworded.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  // No redis: the accounting reads are uncached, so there is nothing to
  // invalidate and nothing to wait on.
  .finally(() => prisma.$disconnect());
