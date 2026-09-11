// One-off: re-point branch "Add money" deposits that were verified BEFORE the
// auto-waterfall existed (git da1fd74) - rows in branch_payments with
// status='verified' and settlement_id IS NULL - onto the COD statements they
// actually paid for, so getBranchBillingStatus stops counting them as floating
// credit on top of statements the office had already settled by hand.
//
// Per branch, oldest deposit first, this runs the same waterfall the live
// verify path now runs (waterfallVerifiedDeposit) with includeSettled:
//   - a pending / partially_paid statement is paid down for real
//     (balance-neutral - the money just moves from "floating credit" to
//     "recorded against the statement");
//   - an already-`settled` statement absorbs the deposit as a LINK ONLY - no
//     branch_settlement_payments line, no paid_amount change - capped at its
//     net_payable minus the deposits already linked to it. This is the part
//     that lowers the branch balance;
//   - anything left over stays as genuine general credit.
//
// A branch can flip to `warned` / `blocked` as a result. The script prints the
// per-branch before/after balance and re-runs evaluateBranchBilling so the
// stored alert state follows.
//
// Dry run does the real writes inside a transaction and then rolls back, so the
// printed allocations are exactly what a committed run would do.
//
// Usage:
//   ts-node --transpile-only src/scripts/repoint-branch-deposits.ts --actor=<superAdminUserId> --dry-run
//   ts-node --transpile-only src/scripts/repoint-branch-deposits.ts --actor=<superAdminUserId> --branch=<branchLocationId> --dry-run
//   ts-node --transpile-only src/scripts/repoint-branch-deposits.ts --actor=<superAdminUserId> --commit
import "dotenv/config";
import type { Prisma } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import {
  evaluateBranchBilling,
  getBranchBillingStatus,
  waterfallVerifiedDeposit,
  type DepositAllocation,
} from "../services/branch-billing.service";

const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
const rs = (value: number) => `Rs. ${value.toFixed(2)}`;

class Rollback extends Error {}

interface DepositReport {
  id: string;
  amount: number;
  allocations: DepositAllocation[];
  leftoverCredit: number;
}

interface BranchReport {
  branchId: string;
  branchName: string;
  beforeBalance: number;
  beforeState: string;
  deposits: DepositReport[];
  linkOnlyTotal: number;
  paidDownTotal: number;
  leftoverTotal: number;
  projectedBalance: number;
}

async function processBranch(
  branchId: string,
  actorId: string,
  dryRun: boolean,
): Promise<BranchReport | null> {
  const before = await getBranchBillingStatus(branchId);
  const deposits = await prisma.branch_payments.findMany({
    where: { branch_id: branchId, status: "verified", settlement_id: null },
    orderBy: [{ reviewed_at: "asc" }, { created_at: "asc" }],
  });
  if (deposits.length === 0) return null;

  const depositReports: DepositReport[] = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        for (const deposit of deposits) {
          const result = await waterfallVerifiedDeposit(tx, deposit, actorId, {
            remark: "repoint-branch-deposits backfill",
            includeSettled: true,
          });
          depositReports.push({
            id: deposit.id,
            amount: money(deposit.amount),
            allocations: result.allocations,
            leftoverCredit: result.leftoverCredit,
          });
          if (result.consumed > 0) {
            await tx.audit_logs.create({
              data: {
                actor_id: actorId,
                entity_type: "branch_payment",
                entity_id: deposit.id,
                action: "REPOINT_BRANCH_PAYMENT",
                old_data: { settlement_id: null, amount: money(deposit.amount) },
                new_data: {
                  allocations: result.allocations,
                  leftoverCredit: result.leftoverCredit,
                } as unknown as Prisma.InputJsonValue,
              },
            });
          }
        }
        if (dryRun) throw new Rollback();
      },
      { maxWait: 15_000, timeout: 120_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  const linkOnlyTotal = money(
    depositReports.reduce(
      (sum, d) => sum + d.allocations.filter((a) => a.linkOnly).reduce((s, a) => s + a.amount, 0),
      0,
    ),
  );
  const paidDownTotal = money(
    depositReports.reduce(
      (sum, d) => sum + d.allocations.filter((a) => !a.linkOnly).reduce((s, a) => s + a.amount, 0),
      0,
    ),
  );
  const leftoverTotal = money(depositReports.reduce((sum, d) => sum + d.leftoverCredit, 0));

  // Only link-only allocations move the balance: paying down an open statement
  // drops outstanding and floating credit by the same amount.
  const projectedBalance = money(before.balance - linkOnlyTotal);

  if (!dryRun) await evaluateBranchBilling(branchId);
  const after = dryRun ? null : await getBranchBillingStatus(branchId);

  return {
    branchId,
    branchName: before.branchName,
    beforeBalance: money(before.balance),
    beforeState: before.state,
    deposits: depositReports,
    linkOnlyTotal,
    paidDownTotal,
    leftoverTotal,
    projectedBalance: after ? money(after.balance) : projectedBalance,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes("--commit");
  const actorId = args.find((a) => a.startsWith("--actor="))?.split("=")[1];
  const branchArg = args.find((a) => a.startsWith("--branch="))?.split("=")[1];

  if (!actorId) {
    console.error("Missing --actor=<userId>. Pass the super-admin user id to attribute the re-point to.");
    process.exit(1);
  }
  const actor = await prisma.users.findUnique({ where: { id: actorId }, select: { id: true } });
  if (!actor) {
    console.error(`--actor ${actorId} is not a known user id.`);
    process.exit(1);
  }

  console.log(dryRun ? "DRY RUN - writes are rolled back.\n" : "COMMIT - changes will be persisted.\n");

  const branches = branchArg
    ? [{ id: branchArg }]
    : await prisma.locations.findMany({
        where: { parent_id: null, is_hub: true, is_active: true },
        select: { id: true },
        orderBy: { name: "asc" },
      });

  let touchedBranches = 0;
  let totalLinkOnly = 0;
  let totalPaidDown = 0;
  let totalLeftover = 0;

  for (const branch of branches) {
    const report = await processBranch(branch.id, actorId, dryRun);
    if (!report) continue;
    touchedBranches += 1;
    totalLinkOnly = money(totalLinkOnly + report.linkOnlyTotal);
    totalPaidDown = money(totalPaidDown + report.paidDownTotal);
    totalLeftover = money(totalLeftover + report.leftoverTotal);

    console.log(`${report.branchName}  (${report.branchId})`);
    console.log(`  deposits re-pointed:      ${report.deposits.length}`);
    console.log(`  netted vs settled stmts:  ${rs(report.linkOnlyTotal)}   <- lowers balance`);
    console.log(`  paid down open stmts:     ${rs(report.paidDownTotal)}   (balance-neutral)`);
    console.log(`  stays as general credit:  ${rs(report.leftoverTotal)}`);
    console.log(
      `  balance:  ${rs(report.beforeBalance)} (${report.beforeState})  ->  ${rs(report.projectedBalance)}`,
    );
    for (const deposit of report.deposits) {
      const parts = deposit.allocations
        .map((a) => `${a.statementNo}${a.linkOnly ? " (link)" : ""} ${rs(a.amount)}`)
        .join(", ");
      console.log(
        `    ${deposit.id}  ${rs(deposit.amount)}  ->  ${parts || "(no statement)"}` +
          (deposit.leftoverCredit > 0 ? `  · credit ${rs(deposit.leftoverCredit)}` : ""),
      );
    }
    console.log("");
  }

  console.log(
    `${dryRun ? "Would touch" : "Touched"} ${touchedBranches} branch(es).  ` +
      `netted ${rs(totalLinkOnly)}, paid down ${rs(totalPaidDown)}, left ${rs(totalLeftover)} as credit.`,
  );
  if (!dryRun) {
    console.log("Clear the branch-billing Redis cache (or wait for TTL) so the UI reflects the change.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
