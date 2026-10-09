// Finds statements with no journal entry, says why, and posts them.
//
//   npm run ledger:repair                                   read-only report
//   npm run ledger:repair -- --map "Online=1102"            also map a method name to an account
//   npm run ledger:repair -- --apply                        post the missing entries
//   npm run ledger:repair -- --check                        read-only, exit 1 if any are missing (post-deploy check)
//   node dist/scripts/repair-statement-entries.js ...       (production)
//
// A statement usually has no entry because a payment method name on it - an
// old method, or one renamed since - has no ledger account, and posting
// refuses rather than guess where the money went. `--map "Name=CODE"` records
// that name as an inactive payment method pointing at the account with that
// code: inactive, so it never shows in a picker, but posting finds it. Repeat
// --map for each name. `--apply` then posts every missing statement through
// the normal sync, the same path a deploy takes; any it still can't describe
// are logged with the reason.
import "dotenv/config";
import prisma from "../lib/prisma";
import { loadMethodAccounts } from "../services/accounting/accounts";
import { methodNamesOf, unmappedMethods } from "../services/accounting/repair";
import {
  syncBranchSettlementPostings,
  syncCarrierSettlementPostings,
  syncSettlementPostings,
} from "../services/accounting/sync";

type Kind = "settlement" | "branch_settlement" | "carrier_settlement";
interface Missing {
  kind: Kind;
  id: string;
  number: string;
  status: string;
  amount: number;
  names: string[];
}

const CHUNK = 25;
const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const maps = argv.flatMap((arg, i) => (arg === "--map" ? [argv[i + 1] ?? ""] : arg.startsWith("--map=") ? [arg.slice(6)] : []));

/** Statements of each kind whose statement-level entry is missing. */
async function findMissing(): Promise<Missing[]> {
  const live = await prisma.journal_entries.findMany({
    where: {
      status: "posted",
      source_type: { in: ["settlement", "branch_settlement", "carrier_settlement"] },
      NOT: { event_key: { contains: "payment:" } },
    },
    select: { source_type: true, source_id: true },
  });
  const posted = new Set(live.map((entry) => `${entry.source_type}:${entry.source_id}`));
  const instalment = { select: { method: true, breakdown: true } } as const;

  const [settlements, branch, carrier] = await Promise.all([
    prisma.settlements.findMany({
      where: { status: { not: "cancelled" } },
      select: { id: true, statement_id: true, status: true, amount: true, payable_amount: true, payments: true, payment_method: true, settlement_payments: instalment },
    }),
    prisma.branch_settlements.findMany({
      where: { status: { not: "cancelled" } },
      select: { id: true, statement_no: true, status: true, net_payable: true, payments: true, payment_method: true, payment_records: instalment },
    }),
    prisma.carrier_settlements.findMany({
      where: { status: { not: "cancelled" } },
      select: { id: true, statement_no: true, status: true, net_receivable: true, payments: true, payment_method: true, payment_records: instalment },
    }),
  ]);

  return [
    ...settlements.map((s) => ({
      kind: "settlement" as const, id: s.id, number: s.statement_id, status: s.status,
      amount: Number(s.payable_amount ?? s.amount),
      names: methodNamesOf({ payments: s.payments, payment_method: s.payment_method, instalments: s.settlement_payments }),
    })),
    ...branch.map((s) => ({
      kind: "branch_settlement" as const, id: s.id, number: s.statement_no, status: s.status, amount: Number(s.net_payable),
      names: methodNamesOf({ payments: s.payments, payment_method: s.payment_method, instalments: s.payment_records }),
    })),
    ...carrier.map((s) => ({
      kind: "carrier_settlement" as const, id: s.id, number: s.statement_no, status: s.status, amount: Number(s.net_receivable),
      names: methodNamesOf({ payments: s.payments, payment_method: s.payment_method, instalments: s.payment_records }),
    })),
  ].filter((statement) => !posted.has(`${statement.kind}:${statement.id}`));
}

/** Records `Name=CODE`: an inactive payment method with that name, posting to that account. */
async function applyMap(spec: string) {
  const at = spec.lastIndexOf("=");
  const name = spec.slice(0, at).trim();
  const code = spec.slice(at + 1).trim();
  if (at < 1 || !name || !code) throw new Error(`--map "${spec}" must look like "Method name=ACCOUNT_CODE"`);

  const account = await prisma.ledger_accounts.findUnique({ where: { code }, select: { id: true, name: true, is_active: true } });
  if (!account?.is_active) throw new Error(`--map "${spec}": no active ledger account with code ${code}`);

  const existing = await prisma.payment_methods.findFirst({ where: { name: { equals: name, mode: "insensitive" } } });
  if (existing?.ledger_account_id) {
    console.log(`  "${name}" already posts to an account - left as it is.`);
    return;
  }
  if (existing) {
    await prisma.payment_methods.update({ where: { id: existing.id }, data: { ledger_account_id: account.id } });
  } else {
    await prisma.payment_methods.create({ data: { name, is_active: false, ledger_account_id: account.id } });
  }
  await prisma.audit_logs.create({
    data: { actor_id: null, entity_type: "payment_method", action: "MAP_LEGACY_PAYMENT_METHOD", new_data: { name, accountCode: code } },
  });
  console.log(`  "${name}" now posts to ${code} ${account.name}.`);
}

async function post(missing: Missing[]) {
  const syncs = { settlement: syncSettlementPostings, branch_settlement: syncBranchSettlementPostings, carrier_settlement: syncCarrierSettlementPostings };
  let changed = 0;
  let unresolved = 0;
  for (const kind of Object.keys(syncs) as Kind[]) {
    const ids = missing.filter((statement) => statement.kind === kind).map((statement) => statement.id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const summary = await prisma.$transaction((tx) => syncs[kind](tx, ids.slice(i, i + CHUNK), { reason: "missing entry repaired" }), {
        timeout: 120_000,
        maxWait: 30_000,
      });
      changed += summary.changed;
      unresolved += summary.unresolved;
    }
  }
  console.log(`\nPosted ${changed} statement(s). ${unresolved} still can't be described - the reasons are logged above.`);
}

async function main() {
  if (maps.length > 0) {
    console.log("Mapping method names:");
    for (const spec of maps) await applyMap(spec);
  }

  const methodAccounts = await loadMethodAccounts(prisma);
  const missing = await findMissing();
  console.log(`\n${missing.length} statement(s) have no journal entry.`);
  if (missing.length === 0) return;

  const rows = missing.map((statement) => ({
    statement: statement.number,
    status: statement.status,
    amount: statement.amount,
    blockedBy: statement.amount === 0 ? "(moves no money - nothing to post)" : unmappedMethods(statement.names, methodAccounts).join(", ") || "-",
  }));
  console.table(rows);

  const blocking = new Map<string, number>();
  for (const statement of missing) {
    for (const name of unmappedMethods(statement.names, methodAccounts)) blocking.set(name, (blocking.get(name) ?? 0) + 1);
  }
  if (blocking.size > 0) {
    console.log("\nMethod names with no ledger account (map each to the account its money went into):");
    for (const [name, count] of blocking) console.log(`  ${name}  - on ${count} statement(s)   e.g. --map "${name}=<account code>"`);
  }

  if (!apply) {
    console.log("\nRead-only: nothing written. Add --apply to post the missing entries.");
    // For the post-deploy check: statements that should have posted and did not.
    if (argv.includes("--check") && missing.some((statement) => statement.amount !== 0)) process.exitCode = 1;
    return;
  }
  await post(missing);
  console.log("Run reconcile-ledger to confirm the books agree.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit();
  });
