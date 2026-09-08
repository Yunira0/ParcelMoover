import { Prisma } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { getBillingSettings, type BillingThresholds } from "./billing.service";

type Actor = { id: string; roles: string[] };
const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
const isSuperAdmin = (actor: Actor) => actor.roles.includes("super_admin");
const isOfficeReviewer = (actor: Actor) => actor.roles.some((role) => role === "super_admin" || role === "admin");

export type BranchBillingState = "ok" | "warned" | "blocked";
export type BranchPaymentStatusFilter = "pending" | "verified" | "rejected";

export interface BranchAccountBalance {
  /**
   * COD the branch still owes the office: the outstanding balance of its
   * non-cancelled statements PLUS collected COD on delivered parcels destined
   * to the branch that are not yet on any statement (net of the branch's
   * commission per parcel). The unstatemented portion is an estimate — the
   * final commission is fixed when the statement is cut.
   */
  unsettledCod: number;
  paymentsReceived: number;
  /** Negative means the branch still has COD to remit to the office. */
  balance: number;
}

export interface BranchBillingStatus extends BranchAccountBalance, BillingThresholds {
  branchId: string;
  branchName: string;
  state: BranchBillingState;
  amountToClearBlock: number;
  pendingPaymentAmount: number;
}

export interface BranchPaymentItem {
  id: string;
  branchId: string;
  branchName: string;
  settlementId: string | null;
  statementNo: string | null;
  amount: number;
  method: string;
  reference: string | null;
  proofPath: string | null;
  status: BranchPaymentStatusFilter;
  note: string | null;
  reviewRemark: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

async function ownBranchContext(actor: Actor): Promise<{ locationId: string; branchScoped: boolean }> {
  const admin = await prisma.admins.findUnique({ where: { user_id: actor.id }, select: { location_id: true, branch_scoped: true } });
  if (!admin?.location_id) throw new AppError(403, "Your admin account is not assigned to a branch");
  return { locationId: admin.location_id, branchScoped: admin.branch_scoped };
}

async function ownBranchId(actor: Actor): Promise<string> {
  return (await ownBranchContext(actor)).locationId;
}

/**
 * Soft variant for the read/review path: an office reviewer with tracking
 * permission but no assigned hub must still reach the master queue, so a
 * missing location_id is not an error here (unlike the submit path, where
 * ownBranchId still requires one).
 */
async function ownBranchScope(actor: Actor): Promise<{ locationId: string | null; branchScoped: boolean }> {
  const admin = await prisma.admins.findUnique({ where: { user_id: actor.id }, select: { location_id: true, branch_scoped: true } });
  return { locationId: admin?.location_id ?? null, branchScoped: admin?.branch_scoped ?? false };
}

async function resolveBranchId(actor: Actor, suppliedId?: string): Promise<string> {
  if (isSuperAdmin(actor)) {
    if (!suppliedId) throw new AppError(400, "branchId is required");
    return suppliedId;
  }
  return ownBranchId(actor);
}

function thresholdsForBranch(
  branch: { branch_billing_warn_threshold: Prisma.Decimal | null; branch_billing_block_threshold: Prisma.Decimal | null },
  defaults: BillingThresholds,
): BillingThresholds {
  return {
    warnThreshold: branch.branch_billing_warn_threshold === null ? defaults.warnThreshold : money(branch.branch_billing_warn_threshold),
    blockThreshold: branch.branch_billing_block_threshold === null ? defaults.blockThreshold : money(branch.branch_billing_block_threshold),
  };
}

export function branchStateForBalance(balance: number, thresholds: BillingThresholds): BranchBillingState {
  if (balance <= thresholds.blockThreshold) return "blocked";
  if (balance <= thresholds.warnThreshold) return "warned";
  return "ok";
}

async function computeBranchBalance(branchId: string): Promise<BranchAccountBalance> {
  // branch_locs mirrors resolveBranchLocationIds (branch.service): the branch's
  // own id, its active covered areas, and — one level only — each virtually
  // covered branch plus that branch's own active covered areas. Kept inline as
  // SQL to avoid a branch.service <-> branch-billing.service import cycle.
  const rows = await prisma.$queryRaw<Array<{ outstanding: string; unstatemented: string; payments: string }>>(Prisma.sql`
    WITH branch_locs AS (
      SELECT ${branchId}::uuid AS id
      UNION SELECT l.id FROM locations l WHERE l.parent_id = ${branchId}::uuid AND l.is_active
      UNION SELECT vc.covered_branch_id FROM branch_virtual_coverage vc WHERE vc.branch_id = ${branchId}::uuid
      UNION SELECT l.id FROM locations l
        JOIN branch_virtual_coverage vc ON vc.branch_id = ${branchId}::uuid
        WHERE l.parent_id = vc.covered_branch_id AND l.is_active
    )
    SELECT
      COALESCE((
        SELECT SUM(bs.net_payable - bs.paid_amount)
        FROM branch_settlements bs
        WHERE bs.from_branch_id = ${branchId}::uuid
          AND bs.status <> 'cancelled'
      ), 0) AS outstanding,
      COALESCE((
        SELECT SUM(GREATEST(
          0::numeric,
          COALESCE(cc.collected_amount, p.cod_amount)
            - COALESCE((SELECT commission_per_parcel FROM locations WHERE id = ${branchId}::uuid), 0)
        ))
        FROM parcels p
        LEFT JOIN cod_collections cc ON cc.parcel_id = p.id
        WHERE p.deleted_at IS NULL
          AND p.status::text IN ('delivered', 'partially_delivered')
          AND p.destination_location_id IN (SELECT id FROM branch_locs)
          AND NOT EXISTS (SELECT 1 FROM branch_settlement_items bsi WHERE bsi.parcel_id = p.id)
      ), 0) AS unstatemented,
      COALESCE((
        SELECT SUM(bp.amount)
        FROM branch_payments bp
        WHERE bp.branch_id = ${branchId}::uuid AND bp.status = 'verified' AND bp.settlement_id IS NULL
      ), 0) AS payments
  `);
  const unsettledCod = money(money(rows[0]?.outstanding) + money(rows[0]?.unstatemented));
  const paymentsReceived = money(rows[0]?.payments);
  return { unsettledCod, paymentsReceived, balance: money(paymentsReceived - unsettledCod) };
}

export async function getBranchBillingStatus(branchId: string): Promise<BranchBillingStatus> {
  const [branch, settings, balance, pending] = await Promise.all([
    prisma.locations.findFirst({
      where: { id: branchId, parent_id: null, is_hub: true },
      select: { id: true, name: true, branch_billing_warn_threshold: true, branch_billing_block_threshold: true },
    }),
    getBillingSettings(),
    computeBranchBalance(branchId),
    prisma.branch_payments.aggregate({ where: { branch_id: branchId, status: "pending" }, _sum: { amount: true } }),
  ]);
  if (!branch) throw new AppError(404, "Branch not found");
  const thresholds = thresholdsForBranch(branch, settings);
  return {
    branchId: branch.id,
    branchName: branch.name,
    ...balance,
    ...thresholds,
    state: branchStateForBalance(balance.balance, thresholds),
    amountToClearBlock: Math.max(0, money(thresholds.blockThreshold - balance.balance)),
    pendingPaymentAmount: money(pending._sum.amount),
  };
}

/** The authoritative server-side transit gate. */
export async function assertBranchCanReceiveTransit(branchId: string): Promise<void> {
  const status = await getBranchBillingStatus(branchId);
  if (status.state !== "blocked") return;
  throw new AppError(
    403,
    `${status.branchName} cannot receive transit: Rs. ${Math.abs(status.balance).toFixed(2)} in COD is outstanding. ` +
      `Verify at least Rs. ${status.amountToClearBlock.toFixed(2)} in branch payment credit to resume transit.`,
    "BRANCH_BILLING_BLOCKED",
  );
}

export async function evaluateBranchBilling(branchId: string): Promise<BranchBillingState | null> {
  try {
    const status = await getBranchBillingStatus(branchId);
    const branch = await prisma.locations.findUnique({ where: { id: branchId }, select: { branch_billing_alert_state: true } });
    if (!branch || branch.branch_billing_alert_state === status.state) return branch?.branch_billing_alert_state ?? null;
    await prisma.locations.updateMany({
      where: { id: branchId, branch_billing_alert_state: branch.branch_billing_alert_state },
      data: { branch_billing_alert_state: status.state, branch_billing_alert_at: new Date() },
    });
    return status.state;
  } catch (error) {
    console.error("[Branch billing] Failed to evaluate branch credit state:", error);
    return null;
  }
}

function mapPayment(row: any): BranchPaymentItem {
  return {
    id: row.id, branchId: row.branch_id, branchName: row.branch.name, amount: money(row.amount), method: row.method,
    settlementId: row.settlement_id, statementNo: row.settlement?.statement_no ?? null,
    reference: row.reference, proofPath: row.proof_path, status: row.status, note: row.note,
    reviewRemark: row.review_remark, reviewedAt: row.reviewed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function submitBranchPayment(
  actor: Actor,
  input: { branchId?: string; settlementId?: string; amount: number; method?: string; reference?: string; note?: string; proofPath?: string | null },
): Promise<BranchPaymentItem> {
  const branchId = await resolveBranchId(actor, input.branchId);
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new AppError(400, "amount must be greater than zero");
  if (!input.proofPath) throw new AppError(400, "A payment screenshot or receipt is required");
  const branch = await prisma.locations.findFirst({ where: { id: branchId, parent_id: null, is_hub: true, is_active: true }, select: { id: true } });
  if (!branch) throw new AppError(404, "Branch not found or inactive");
  if (input.settlementId) {
    const statement = await prisma.branch_settlements.findFirst({ where: { id: input.settlementId, from_branch_id: branchId, status: { in: ["pending", "partially_paid"] } }, select: { net_payable: true, paid_amount: true } });
    if (!statement) throw new AppError(404, "Pending settlement not found for this branch");
    if (input.amount > money(statement.net_payable) - money(statement.paid_amount)) throw new AppError(400, "Receipt amount exceeds this settlement's outstanding balance");
  }

  const created = await prisma.branch_payments.create({
    data: {
      branch_id: branchId, amount: input.amount, method: input.method?.trim() || "fonepay",
      reference: input.reference?.trim() || null, note: input.note?.trim() || null,
      proof_path: input.proofPath ?? null, settlement_id: input.settlementId ?? null, submitted_by: actor.id,
    },
    include: { branch: { select: { name: true } }, settlement: { select: { statement_no: true } } },
  });
  await prisma.audit_logs.create({ data: {
    actor_id: actor.id, entity_type: "branch_payment", entity_id: created.id, action: "SUBMIT_BRANCH_PAYMENT",
    new_data: { branchId, settlementId: input.settlementId ?? null, amount: input.amount, reference: created.reference },
  } });
  return mapPayment(created);
}

export async function listBranchPayments(
  actor: Actor,
  filters: { branchId?: string; status?: BranchPaymentStatusFilter; page?: number; pageSize?: number },
) {
  const ownScope = isSuperAdmin(actor) ? null : await ownBranchScope(actor);
  if (ownScope?.branchScoped && !ownScope.locationId) {
    throw new AppError(403, "Your branch account is not assigned to a branch");
  }
  // A restricted branch sees only payments it submitted. An unrestricted
  // head-office admin works the master verification queue across branches.
  const branchId = isSuperAdmin(actor) || !ownScope?.branchScoped ? filters.branchId : ownScope.locationId;
  const take = Math.min(500, Math.max(1, filters.pageSize || 20));
  const page = Math.max(1, filters.page || 1);
  const where = { ...(branchId ? { branch_id: branchId } : {}), ...(filters.status ? { status: filters.status } : {}) };
  const [total, rows] = await Promise.all([
    prisma.branch_payments.count({ where }),
    prisma.branch_payments.findMany({ where, include: { branch: { select: { name: true } }, settlement: { select: { statement_no: true } } }, orderBy: { created_at: "desc" }, skip: (page - 1) * take, take }),
  ]);
  return { data: rows.map(mapPayment), meta: { page, pageSize: take, total, totalPages: Math.max(1, Math.ceil(total / take)) } };
}

/**
 * Apply already-verified branch money against one open COD statement: record a
 * branch_settlement_payments line, roll the running payment-method breakdown
 * forward, and flip the statement to `settled` once its balance reaches zero
 * (`partially_paid` while a balance remains). Returns how much was absorbed.
 */
async function applyVerifiedCreditToSettlement(
  tx: Prisma.TransactionClient,
  settlement: { id: string; statement_no: string; net_payable: Prisma.Decimal; paid_amount: Prisma.Decimal; payments: unknown },
  credit: number,
  actorId: string,
  opts: { method: string; remark: string },
): Promise<{ applied: number; settled: boolean; statementNo: string }> {
  const outstanding = money(money(settlement.net_payable) - money(settlement.paid_amount));
  const applied = Math.min(money(credit), outstanding);
  if (applied <= 0) return { applied: 0, settled: false, statementNo: settlement.statement_no };
  const paidAmount = money(money(settlement.paid_amount) + applied);
  const settled = Math.round((money(settlement.net_payable) - paidAmount) * 100) === 0;
  await tx.branch_settlement_payments.create({ data: {
    settlement_id: settlement.id, amount: applied, method: opts.method,
    breakdown: [{ method: opts.method, amount: applied }] as unknown as Prisma.InputJsonValue,
    remark: opts.remark, recorded_by: actorId,
  } });
  const mergedByMethod = new Map<string, number>();
  if (Array.isArray(settlement.payments)) {
    for (const line of settlement.payments as Array<{ method?: unknown; amount?: unknown }>) {
      if (line && typeof line.method === "string" && Number.isFinite(Number(line.amount))) {
        mergedByMethod.set(line.method, money((mergedByMethod.get(line.method) ?? 0) + Number(line.amount)));
      }
    }
  }
  mergedByMethod.set(opts.method, money((mergedByMethod.get(opts.method) ?? 0) + applied));
  const mergedLines = Array.from(mergedByMethod, ([method, amount]) => ({ method, amount }));
  await tx.branch_settlements.update({ where: { id: settlement.id }, data: {
    paid_amount: paidAmount, status: settled ? "settled" : "partially_paid",
    payment_method: mergedLines.map((line) => line.method).join(", "),
    payments: mergedLines as unknown as Prisma.InputJsonValue,
    ...(settled ? { settled_by: actorId, settled_at: new Date() } : {}),
  } });
  return { applied, settled, statementNo: settlement.statement_no };
}

export interface DepositAllocation {
  settlementId: string;
  statementNo: string;
  amount: number;
  settled: boolean;
  /** Set only when the statement was already settled and this deposit was
   *  linked to it for balance purposes without moving paid_amount. */
  linkOnly?: true;
}

/**
 * Waterfall an already-verified, statement-less branch deposit onto that
 * branch's COD statements, oldest first, re-pointing the branch_payments row so
 * the branch balance nets out (its floating credit drops by the same amount the
 * statements absorb). Shared by the live verify path and the
 * repoint-branch-deposits backfill.
 *
 * A `pending` / `partially_paid` statement is paid down for real via
 * applyVerifiedCreditToSettlement — balance-neutral, it only moves the money
 * from "floating credit" to "recorded against the statement". With
 * `includeSettled`, an already-`settled` statement instead absorbs the deposit
 * as a *link only*: no branch_settlement_payments line, no paid_amount change,
 * capped at net_payable minus the deposits already pointing at it. That path
 * lowers the branch balance, and exists to clean up deposits that predate this
 * waterfall (verified while the office settled the same statement by hand, so
 * the money got counted twice).
 */
export async function waterfallVerifiedDeposit(
  tx: Prisma.TransactionClient,
  deposit: {
    id: string; branch_id: string; amount: Prisma.Decimal | number; method: string;
    reference: string | null; proof_path: string | null; note: string | null;
    submitted_by: string | null;
  },
  actorId: string,
  opts: { remark?: string | null; includeSettled?: boolean } = {},
): Promise<{ allocations: DepositAllocation[]; leftoverCredit: number; consumed: number }> {
  const statuses: Array<"pending" | "partially_paid" | "settled"> = opts.includeSettled
    ? ["pending", "partially_paid", "settled"]
    : ["pending", "partially_paid"];
  const statements = await tx.branch_settlements.findMany({
    where: { from_branch_id: deposit.branch_id, status: { in: statuses } },
    orderBy: [{ settlement_date: "asc" }, { created_at: "asc" }],
  });

  const depositAmount = money(deposit.amount);
  const refSuffix = deposit.reference ? ` · ${deposit.reference}` : "";
  const allocations: DepositAllocation[] = [];
  let credit = depositAmount;
  let firstTouched: string | null = null;

  for (const statement of statements) {
    if (credit <= 0) break;

    if (statement.status === "settled") {
      const linked = await tx.branch_payments.aggregate({
        where: { settlement_id: statement.id, status: "verified" }, _sum: { amount: true },
      });
      const capacity = money(money(statement.net_payable) - money(linked._sum.amount));
      const applied = Math.min(credit, capacity);
      if (applied <= 0) continue;
      credit = money(credit - applied);
      firstTouched ??= statement.id;
      allocations.push({
        settlementId: statement.id, statementNo: statement.statement_no,
        amount: applied, settled: true, linkOnly: true,
      });
      continue;
    }

    const applied = await applyVerifiedCreditToSettlement(tx, statement, credit, actorId, {
      method: deposit.method, remark: `Verified deposit${refSuffix}`,
    });
    if (applied.applied <= 0) continue;
    credit = money(credit - applied.applied);
    firstTouched ??= statement.id;
    allocations.push({
      settlementId: statement.id, statementNo: applied.statementNo,
      amount: applied.applied, settled: applied.settled,
    });
  }

  const consumed = money(depositAmount - credit);
  if (consumed > 0 && firstTouched) {
    if (credit <= 0) {
      await tx.branch_payments.update({ where: { id: deposit.id }, data: { settlement_id: firstTouched } });
    } else {
      await tx.branch_payments.update({ where: { id: deposit.id }, data: { amount: credit } });
      await tx.branch_payments.create({ data: {
        branch_id: deposit.branch_id, settlement_id: firstTouched, amount: consumed,
        method: deposit.method, reference: deposit.reference, proof_path: deposit.proof_path,
        note: deposit.note, submitted_by: deposit.submitted_by, status: "verified",
        reviewed_by: actorId, reviewed_at: new Date(), review_remark: opts.remark ?? null,
      } });
    }
  }

  return { allocations, leftoverCredit: credit, consumed };
}

export async function reviewBranchPayment(
  actor: Actor, paymentId: string, decision: "verified" | "rejected", remark?: string,
): Promise<BranchPaymentItem> {
  if (!isOfficeReviewer(actor)) throw new AppError(403, "Not authorized to review branch payments");
  if (!isSuperAdmin(actor) && (await ownBranchScope(actor)).branchScoped) {
    throw new AppError(403, "A paying branch cannot verify branch payments");
  }
  const existing = await prisma.branch_payments.findFirst({ where: { id: paymentId }, include: { branch: { select: { name: true } }, settlement: { select: { statement_no: true } } } });
  if (!existing) throw new AppError(404, "Payment not found");
  if (existing.status !== "pending") throw new AppError(400, `This payment has already been ${existing.status}`);
  if (decision === "rejected" && !remark?.trim()) throw new AppError(400, "A remark is required when rejecting a payment");
  if (!isSuperAdmin(actor) && existing.submitted_by === actor.id) throw new AppError(403, "You cannot review your own branch payment");

  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.branch_payments.updateMany({
      where: { id: paymentId, status: "pending" },
      data: { status: decision, reviewed_by: actor.id, reviewed_at: new Date(), review_remark: remark?.trim() || null },
    });
    if (!claimed.count) throw new AppError(409, "This payment was already reviewed by someone else");

    const allocations: DepositAllocation[] = [];
    let leftoverCredit = 0;

    if (decision === "verified" && existing.settlement_id) {
      const settlement = await tx.branch_settlements.findUnique({ where: { id: existing.settlement_id } });
      if (!settlement || settlement.status === "cancelled" || settlement.status === "settled") throw new AppError(409, "The linked settlement is no longer payable");
      const outstanding = money(settlement.net_payable) - money(settlement.paid_amount);
      if (money(existing.amount) > outstanding) throw new AppError(409, "Receipt amount now exceeds the settlement balance");
      const applied = await applyVerifiedCreditToSettlement(tx, settlement, money(existing.amount), actor.id, {
        method: existing.method, remark: `Verified receipt${existing.reference ? ` · ${existing.reference}` : ""}`,
      });
      allocations.push({ settlementId: settlement.id, statementNo: applied.statementNo, amount: applied.applied, settled: applied.settled });
    } else if (decision === "verified") {
      // A branch "Add money" deposit that named no statement: waterfall the
      // verified amount onto that branch's open COD statements, oldest first.
      // A statement it fully covers is marked settled; a short one goes
      // partially_paid with the balance still outstanding; any remainder stays
      // as general branch credit. The applied portion is re-pointed at a
      // statement so the branch balance still nets out (credit down by the same
      // amount the statements' outstanding drops).
      const result = await waterfallVerifiedDeposit(tx, existing, actor.id, { remark: remark?.trim() || null });
      allocations.push(...result.allocations);
      leftoverCredit = result.leftoverCredit;
    }

    await tx.audit_logs.create({ data: {
      actor_id: actor.id, entity_type: "branch_payment", entity_id: paymentId,
      action: decision === "verified" ? "VERIFY_BRANCH_PAYMENT" : "REJECT_BRANCH_PAYMENT",
      old_data: { status: "pending" },
      new_data: {
        status: decision, amount: money(existing.amount), remark: remark?.trim() || null,
        ...(allocations.length ? { allocations } : {}),
        ...(leftoverCredit > 0 ? { leftoverCredit } : {}),
      } as unknown as Prisma.InputJsonValue,
    } });
    return tx.branch_payments.findFirstOrThrow({ where: { id: paymentId }, include: { branch: { select: { name: true } }, settlement: { select: { statement_no: true } } } });
  });
  if (decision === "verified") await evaluateBranchBilling(existing.branch_id);
  return mapPayment(updated);
}

export async function getBranchBillingForActor(actor: Actor, branchId?: string) {
  return getBranchBillingStatus(await resolveBranchId(actor, branchId));
}

export async function listBranchBalances(actor: Actor): Promise<BranchBillingStatus[]> {
  if (!isSuperAdmin(actor)) throw new AppError(403, "Only a super admin can view every branch balance");
  const branches = await prisma.locations.findMany({ where: { parent_id: null, is_hub: true, is_active: true }, select: { id: true }, orderBy: { name: "asc" } });
  return Promise.all(branches.map((branch) => getBranchBillingStatus(branch.id)));
}
