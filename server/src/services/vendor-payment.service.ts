import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { createNotification } from "./notification.service";
import { resolveOwnVendorId } from "./vendor-scope.service";
import { evaluateVendorBilling, invalidateVendorBalanceCache } from "./billing.service";
import { invalidateVendorFinanceCache } from "./finance.service";
import { syncVendorPaymentPostings } from "./accounting/sync";

// ── Vendor -> office payments ────────────────────────────────────────────────
//
// Vendors clear outstanding delivery charges by scanning the office Fonepay QR
// and then telling us they paid. That claim is untrusted: it credits nothing
// until an admin verifies it against the merchant statement. Without that gate
// a blocked vendor could unblock themselves in one request by claiming a
// payment they never made.

type Actor = { id: string; roles: string[] };

// 500 so the list can offer the same largest page as every other screen.
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 20;

export type VendorPaymentStatusFilter = "pending" | "verified" | "rejected";

export interface VendorPaymentItem {
  id: string;
  vendorId: string;
  vendorName: string;
  amount: number;
  method: string;
  reference: string | null;
  proofPath: string | null;
  status: string;
  note: string | null;
  reviewRemark: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface VendorPaymentsResult {
  data: VendorPaymentItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

const isStaffActor = (actor: Actor) => actor.roles.some((r) => ["super_admin", "admin"].includes(r));

function mapPayment(row: {
  id: string;
  vendor_id: string;
  amount: unknown;
  method: string;
  reference: string | null;
  proof_path: string | null;
  status: string;
  note: string | null;
  review_remark: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  vendors: { client_name: string; business_name: string | null };
}): VendorPaymentItem {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    vendorName: row.vendors.business_name || row.vendors.client_name,
    amount: Number(row.amount),
    method: row.method,
    reference: row.reference,
    proofPath: row.proof_path,
    status: row.status,
    note: row.note,
    reviewRemark: row.review_remark,
    reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

// Vendors submit against their own account only — never a caller-supplied
// vendorId, mirroring resolveVendor in finance.service.
async function resolveOwnVendorOrThrow(actor: Actor): Promise<string> {
  const vendorId = await resolveOwnVendorId(actor);
  if (!vendorId) throw new AppError(403, "Only a vendor account can submit a payment");
  return vendorId;
}

export async function submitVendorPayment(
  actor: Actor,
  input: { amount: number; reference?: string; note?: string; method?: string; proofPath?: string | null },
): Promise<VendorPaymentItem> {
  const vendorId = await resolveOwnVendorOrThrow(actor);

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new AppError(400, "amount must be greater than zero");
  }

  const created = await prisma.vendor_payments.create({
    data: {
      vendor_id: vendorId,
      amount: input.amount,
      method: input.method || "fonepay",
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
      proof_path: input.proofPath ?? null,
      status: "pending",
      submitted_by: actor.id,
    },
    include: { vendors: { select: { client_name: true, business_name: true } } },
  });

  await prisma.audit_logs.create({
    data: {
      actor_id: actor.id,
      entity_type: "vendor_payment",
      entity_id: created.id,
      action: "SUBMIT_VENDOR_PAYMENT",
      new_data: { vendorId, amount: input.amount, reference: created.reference },
    },
  });

  // Deliberately no balance change and no re-evaluation here — a pending claim
  // is not money.
  return mapPayment(created);
}

export async function listVendorPayments(
  actor: Actor,
  filters: { vendorId?: string; status?: VendorPaymentStatusFilter; page?: number; pageSize?: number },
): Promise<VendorPaymentsResult> {
  const staff = isStaffActor(actor);
  let vendorId = filters.vendorId;

  if (!staff) {
    // Vendor / vendor_staff see only their own history, whatever they ask for.
    vendorId = await resolveOwnVendorOrThrow(actor);
  }

  const take = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize || DEFAULT_PAGE_SIZE));
  const page = Math.max(1, filters.page || 1);

  const where = {
    ...(vendorId ? { vendor_id: vendorId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.vendor_payments.count({ where }),
    prisma.vendor_payments.findMany({
      where,
      include: { vendors: { select: { client_name: true, business_name: true } } },
      orderBy: { created_at: "desc" },
      skip: (page - 1) * take,
      take,
    }),
  ]);

  return {
    data: rows.map(mapPayment),
    meta: { page, pageSize: take, total, totalPages: Math.max(1, Math.ceil(total / take)) },
  };
}

/**
 * Admin decision on a claim. Verifying is the only thing that moves money into
 * the balance, so it re-evaluates the vendor's billing state immediately —
 * a vendor who has just paid should be unblocked without waiting for a cache
 * TTL or their next delivery.
 */
export async function reviewVendorPayment(
  actor: Actor,
  paymentId: string,
  decision: "verified" | "rejected",
  remark?: string,
): Promise<VendorPaymentItem> {
  if (!isStaffActor(actor)) {
    throw new AppError(403, "Not authorized to review vendor payments");
  }

  const existing = await prisma.vendor_payments.findFirst({
    where: { id: paymentId },
    include: { vendors: { select: { client_name: true, business_name: true, user_id: true } } },
  });
  if (!existing) throw new AppError(404, "Payment not found");

  // A decided claim is final. Re-verifying an already-verified row would be a
  // no-op, but flipping verified -> rejected would silently claw back credit a
  // vendor has already been told about; corrections go through a new record.
  if (existing.status !== "pending") {
    throw new AppError(400, `This payment has already been ${existing.status}`);
  }

  if (decision === "rejected" && !remark?.trim()) {
    throw new AppError(400, "A remark is required when rejecting a payment");
  }

  // One transaction: money must never be credited without the matching audit
  // record. The status guard is repeated inside the update as a compare-and-swap
  // so two reviewers hitting Verify at once can't both take the decision.
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.vendor_payments.updateMany({
      where: { id: paymentId, status: "pending" },
      data: {
        status: decision,
        reviewed_by: actor.id,
        reviewed_at: new Date(),
        review_remark: remark?.trim() || null,
      },
    });
    if (claimed.count === 0) {
      throw new AppError(409, "This payment was already reviewed by someone else");
    }

    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "vendor_payment",
        entity_id: paymentId,
        action: decision === "verified" ? "VERIFY_VENDOR_PAYMENT" : "REJECT_VENDOR_PAYMENT",
        old_data: { status: existing.status },
        new_data: { status: decision, amount: Number(existing.amount), remark: remark?.trim() || null },
      },
    });

    // Verification is the moment the money becomes real to the books - a
    // pending or rejected claim posts nothing, which is the same rule that
    // keeps it out of the credit-control balance.
    await syncVendorPaymentPostings(tx, [paymentId], {
      actorId: actor.id,
      reason: `payment ${decision}`,
    });

    return tx.vendor_payments.findFirstOrThrow({
      where: { id: paymentId },
      include: { vendors: { select: { client_name: true, business_name: true } } },
    });
  });

  await invalidateVendorBalanceCache(existing.vendor_id);
  await invalidateVendorFinanceCache(existing.vendor_id);

  // Tell the vendor about the payment itself BEFORE re-evaluating their credit
  // state. evaluateVendorBilling may send its own "charges cleared" notice, and
  // sending that first would announce the effect ahead of the cause.
  const vendorUserId = existing.vendors.user_id;
  if (vendorUserId) {
    await createNotification(
      vendorUserId,
      decision === "verified" ? "Payment verified" : "Payment could not be verified",
      decision === "verified"
        ? `Rs. ${Number(existing.amount).toFixed(2)} has been credited to your account.`
        : `Rs. ${Number(existing.amount).toFixed(2)} was not verified. ${remark?.trim() ?? ""}`.trim(),
      null,
      "billing",
      "/finance/billing",
    );
  }

  if (decision === "verified") {
    // Recompute now so the block lifts in the same breath as the verification.
    await evaluateVendorBilling(existing.vendor_id);
  }

  return mapPayment(updated);
}
