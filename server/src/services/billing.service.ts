import { Prisma } from "../generated/prisma/client";
import { vendor_billing_state } from "../generated/prisma/enums";
import prisma from "../lib/prisma";
import redis from "../lib/redis";
import { AppError } from "../utils/AppError";
import { earnedChargeSql } from "./money-rules";
import { createNotification } from "./notification.service";

// ── Vendor credit control ────────────────────────────────────────────────────
//
// A vendor's account balance is derived from the money that has already moved,
// never stored:
//
//   balance = COD collected on their behalf
//           - delivery charges earned on their parcels
//           - payouts already settled to them
//           + payments they have made back to the office
//
// Negative means the vendor owes us. That is the normal direction for a vendor
// shipping zero-COD parcels, since each one is a pure delivery charge with no
// COD to net it off against.
//
// Lifetime-to-date is only coherent because payouts are subtracted. Summing
// lifetime COD without debiting what has already been paid out would leave a
// long-standing vendor showing a permanent six-figure credit that never trips
// a threshold.

const BALANCE_CACHE_TTL_SECONDS = 30;
const SETTINGS_CACHE_KEY = "billing:settings";
const SETTINGS_CACHE_TTL_SECONDS = 300;

const balanceCacheKey = (vendorId: string) => `finance:${vendorId}:balance`;

// When a delivery charge becomes the vendor's to pay. The rule and its SQL
// both come from money-rules.ts, which generates the fragment below from the
// same constant the TypeScript predicate reads - so there is no second copy to
// drift. There used to be, and it did.
//
// Re-exported here because this is where callers have always looked for it.
const EARNED_CHARGE_SQL = earnedChargeSql();

export { BALANCE_AFFECTING_STATUSES, statusAffectsBalance } from "./money-rules";

export interface VendorAccountBalance {
  /** Lifetime COD actually collected from receivers on this vendor's parcels. */
  codCollected: number;
  /** Lifetime delivery charges earned (see EARNED_CHARGE_SQL). */
  deliveryCharges: number;
  /** Lifetime net already paid out to the vendor via settled statements. */
  payouts: number;
  /** Lifetime verified payments the vendor has made back to the office. */
  paymentsReceived: number;
  /** Negative = the vendor owes the office. */
  balance: number;
}

export interface BillingThresholds {
  warnThreshold: number;
  blockThreshold: number;
}

export interface VendorBillingStatus extends VendorAccountBalance, BillingThresholds {
  vendorId: string;
  state: vendor_billing_state;
  /** Convenience for the client: how much would clear the block. */
  amountToClearBlock: number;
  /** Payment claims awaiting admin verification (not yet in the balance). */
  pendingPaymentAmount: number;
}

export interface BillingSettings extends BillingThresholds {
  id: string;
  paymentQrPath: string | null;
  paymentNote: string | null;
}

// Money is DECIMAL(12,2) in Postgres but travels as JS numbers everywhere in
// this codebase. Rounding at the boundary keeps float dust out of threshold
// comparisons (a balance of -2000.0000000001 must not read as past -2000).
const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;

// ── Settings ────────────────────────────────────────────────────────────────

// Lazily created singleton, same shape as pricing_settings.
export async function getBillingSettings(): Promise<BillingSettings> {
  try {
    const cached = await redis.get(SETTINGS_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (error) {
    console.error("[Redis] Failed to read billing settings cache:", error);
  }

  let settings = await prisma.billing_settings.findFirst();
  if (!settings) {
    settings = await prisma.billing_settings.create({ data: {} });
  }

  const result: BillingSettings = {
    id: settings.id,
    warnThreshold: money(settings.warn_threshold),
    blockThreshold: money(settings.block_threshold),
    paymentQrPath: settings.payment_qr_path,
    paymentNote: settings.payment_note,
  };

  try {
    await redis.setex(SETTINGS_CACHE_KEY, SETTINGS_CACHE_TTL_SECONDS, JSON.stringify(result));
  } catch (error) {
    console.error("[Redis] Failed to write billing settings cache:", error);
  }
  return result;
}

export async function invalidateBillingSettingsCache(): Promise<void> {
  try {
    await redis.del(SETTINGS_CACHE_KEY);
  } catch (error) {
    console.error("[Redis] Failed to invalidate billing settings cache:", error);
  }
}

export async function updateBillingSettings(
  actorId: string,
  input: {
    warnThreshold?: number;
    blockThreshold?: number;
    paymentQrPath?: string | null;
    paymentNote?: string | null;
  },
): Promise<BillingSettings> {
  const current = await getBillingSettings();
  const warn = input.warnThreshold ?? current.warnThreshold;
  const block = input.blockThreshold ?? current.blockThreshold;

  // The block threshold must be the harsher of the two, or a vendor could be
  // blocked before ever being warned.
  if (block > warn) {
    throw new AppError(400, "blockThreshold must be less than or equal to warnThreshold");
  }

  await prisma.billing_settings.update({
    where: { id: current.id },
    data: {
      warn_threshold: warn,
      block_threshold: block,
      ...(input.paymentQrPath !== undefined ? { payment_qr_path: input.paymentQrPath } : {}),
      ...(input.paymentNote !== undefined ? { payment_note: input.paymentNote } : {}),
    },
  });

  await prisma.audit_logs.create({
    data: {
      actor_id: actorId,
      entity_type: "billing_settings",
      entity_id: current.id,
      action: "UPDATE_BILLING_SETTINGS",
      old_data: { warnThreshold: current.warnThreshold, blockThreshold: current.blockThreshold },
      new_data: { warnThreshold: warn, blockThreshold: block },
    },
  });

  await invalidateBillingSettingsCache();
  return getBillingSettings();
}

// ── Balance ─────────────────────────────────────────────────────────────────

// One round trip for all four components. COD collected and delivery charges
// both come off the same parcels join so they share a scope (soft-deleted
// parcels excluded from both) and can never disagree about which parcels count.
async function computeBalance(vendorId: string): Promise<VendorAccountBalance> {
  const rows = await prisma.$queryRaw<
    Array<{ collected: string; charges: string; payouts: string; payments: string }>
  >(Prisma.sql`
    WITH parcel_totals AS (
      SELECT
        COALESCE(SUM(c.collected_amount), 0) AS collected,
        COALESCE(SUM(p.delivery_charge) FILTER (WHERE ${EARNED_CHARGE_SQL}), 0) AS charges
      FROM parcels p
      LEFT JOIN cod_collections c ON c.parcel_id = p.id
      WHERE p.vendor_id = ${vendorId}::uuid
        AND p.deleted_at IS NULL
    )
    SELECT
      pt.collected,
      pt.charges,
      (
        SELECT COALESCE(SUM(s.payable_amount), 0)
        FROM settlements s
        WHERE s.vendor_id = ${vendorId}::uuid
          AND s.payee_type = 'vendor'
          AND s.status::text = 'settled'
      ) AS payouts,
      (
        SELECT COALESCE(SUM(vp.amount), 0)
        FROM vendor_payments vp
        WHERE vp.vendor_id = ${vendorId}::uuid
          AND vp.status::text = 'verified'
      ) AS payments
    FROM parcel_totals pt
  `);

  const row = rows[0];
  const codCollected = money(row?.collected);
  const deliveryCharges = money(row?.charges);
  const payouts = money(row?.payouts);
  const paymentsReceived = money(row?.payments);

  return {
    codCollected,
    deliveryCharges,
    payouts,
    paymentsReceived,
    balance: money(codCollected - deliveryCharges - payouts + paymentsReceived),
  };
}

export async function getVendorAccountBalance(
  vendorId: string,
  options: { skipCache?: boolean } = {},
): Promise<VendorAccountBalance> {
  const key = balanceCacheKey(vendorId);

  if (!options.skipCache) {
    try {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached);
    } catch (error) {
      console.error("[Redis] Failed to read vendor balance cache:", error);
    }
  }

  const balance = await computeBalance(vendorId);

  try {
    await redis.setex(key, BALANCE_CACHE_TTL_SECONDS, JSON.stringify(balance));
  } catch (error) {
    console.error("[Redis] Failed to write vendor balance cache:", error);
  }
  return balance;
}

export function resolveThresholds(
  vendor: { billing_warn_threshold: Prisma.Decimal | null; billing_block_threshold: Prisma.Decimal | null },
  settings: BillingThresholds,
): BillingThresholds {
  return {
    warnThreshold:
      vendor.billing_warn_threshold === null ? settings.warnThreshold : money(vendor.billing_warn_threshold),
    blockThreshold:
      vendor.billing_block_threshold === null ? settings.blockThreshold : money(vendor.billing_block_threshold),
  };
}

export function stateForBalance(balance: number, thresholds: BillingThresholds): vendor_billing_state {
  // Block is checked first: it is the lower (harsher) of the two, so a balance
  // past it is also past the warn line.
  if (balance <= thresholds.blockThreshold) return "blocked";
  if (balance <= thresholds.warnThreshold) return "warned";
  return "ok";
}

export async function getVendorBillingStatus(
  vendorId: string,
  options: { skipCache?: boolean } = {},
): Promise<VendorBillingStatus> {
  const [vendor, settings, balance] = await Promise.all([
    prisma.vendors.findFirst({
      where: { id: vendorId },
      select: { id: true, billing_warn_threshold: true, billing_block_threshold: true },
    }),
    getBillingSettings(),
    getVendorAccountBalance(vendorId, options),
  ]);

  if (!vendor) throw new AppError(404, "Vendor not found");

  const thresholds = resolveThresholds(vendor, settings);
  const pending = await prisma.vendor_payments.aggregate({
    where: { vendor_id: vendorId, status: "pending" },
    _sum: { amount: true },
  });

  return {
    vendorId,
    ...balance,
    ...thresholds,
    state: stateForBalance(balance.balance, thresholds),
    amountToClearBlock: Math.max(0, money(thresholds.blockThreshold - balance.balance)),
    pendingPaymentAmount: money(pending._sum.amount),
  };
}

/**
 * The block decision alone, for the order-creation hot path.
 *
 * Deliberately not getVendorBillingStatus: that also aggregates pending payment
 * claims, which is display-only and has no bearing on whether an order may be
 * placed. Every order created was paying for that query.
 */
export async function getVendorBlockDecision(
  vendorId: string,
): Promise<{ blocked: boolean; balance: number; amountToClearBlock: number }> {
  const [vendor, settings, balance] = await Promise.all([
    prisma.vendors.findFirst({
      where: { id: vendorId },
      select: { billing_warn_threshold: true, billing_block_threshold: true },
    }),
    getBillingSettings(),
    getVendorAccountBalance(vendorId),
  ]);

  if (!vendor) throw new AppError(404, "Vendor not found");

  const thresholds = resolveThresholds(vendor, settings);
  return {
    blocked: stateForBalance(balance.balance, thresholds) === "blocked",
    balance: balance.balance,
    amountToClearBlock: Math.max(0, money(thresholds.blockThreshold - balance.balance)),
  };
}

export interface VendorBalanceRow extends VendorBillingStatus {
  vendorName: string;
  /** What the vendor was last notified about; drifts from `state` until the
   *  next evaluation runs. */
  storedState: vendor_billing_state;
}

/**
 * Every vendor's balance in one query.
 *
 * The obvious implementation - loop the vendors calling getVendorBillingStatus -
 * costs three round trips per vendor and turns an admin page into ~1500 queries
 * at 500 vendors. All four balance components are grouped server-side instead.
 */
export async function listVendorBalances(
  stateFilter?: vendor_billing_state,
): Promise<VendorBalanceRow[]> {
  const settings = await getBillingSettings();

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      client_name: string;
      business_name: string | null;
      billing_alert_state: vendor_billing_state;
      warn_override: Prisma.Decimal | null;
      block_override: Prisma.Decimal | null;
      collected: string;
      charges: string;
      payouts: string;
      payments: string;
      pending: string;
    }>
  >(Prisma.sql`
    WITH parcel_totals AS (
      SELECT p.vendor_id,
             COALESCE(SUM(c.collected_amount), 0) AS collected,
             COALESCE(SUM(p.delivery_charge) FILTER (WHERE ${EARNED_CHARGE_SQL}), 0) AS charges
      FROM parcels p
      LEFT JOIN cod_collections c ON c.parcel_id = p.id
      WHERE p.deleted_at IS NULL AND p.vendor_id IS NOT NULL
      GROUP BY p.vendor_id
    ),
    payout_totals AS (
      SELECT vendor_id, COALESCE(SUM(payable_amount), 0) AS payouts
      FROM settlements
      WHERE payee_type = 'vendor' AND status::text = 'settled' AND vendor_id IS NOT NULL
      GROUP BY vendor_id
    ),
    payment_totals AS (
      SELECT vendor_id,
             COALESCE(SUM(amount) FILTER (WHERE status::text = 'verified'), 0) AS payments,
             COALESCE(SUM(amount) FILTER (WHERE status::text = 'pending'), 0) AS pending
      FROM vendor_payments
      GROUP BY vendor_id
    )
    SELECT v.id,
           v.client_name,
           v.business_name,
           v.billing_alert_state,
           v.billing_warn_threshold  AS warn_override,
           v.billing_block_threshold AS block_override,
           COALESCE(pt.collected, 0) AS collected,
           COALESCE(pt.charges, 0)   AS charges,
           COALESCE(po.payouts, 0)   AS payouts,
           COALESCE(pm.payments, 0)  AS payments,
           COALESCE(pm.pending, 0)   AS pending
    FROM vendors v
    LEFT JOIN parcel_totals  pt ON pt.vendor_id = v.id
    LEFT JOIN payout_totals  po ON po.vendor_id = v.id
    LEFT JOIN payment_totals pm ON pm.vendor_id = v.id
    WHERE v.deleted_at IS NULL
    ORDER BY v.client_name ASC
  `);

  return rows
    .map((row) => {
      const codCollected = money(row.collected);
      const deliveryCharges = money(row.charges);
      const payouts = money(row.payouts);
      const paymentsReceived = money(row.payments);
      const balance = money(codCollected - deliveryCharges - payouts + paymentsReceived);
      const thresholds = resolveThresholds(
        { billing_warn_threshold: row.warn_override, billing_block_threshold: row.block_override },
        settings,
      );

      return {
        vendorId: row.id,
        vendorName: row.business_name || row.client_name,
        storedState: row.billing_alert_state,
        codCollected,
        deliveryCharges,
        payouts,
        paymentsReceived,
        balance,
        ...thresholds,
        state: stateForBalance(balance, thresholds),
        amountToClearBlock: Math.max(0, money(thresholds.blockThreshold - balance)),
        pendingPaymentAmount: money(row.pending),
      };
    })
    // Filtered on the live state, not the stored one - the stored value is only
    // what the vendor was last told, and lags until the next evaluation.
    .filter((row) => !stateFilter || row.state === stateFilter);
}

export async function invalidateVendorBalanceCache(vendorId: string): Promise<void> {
  try {
    await redis.del(balanceCacheKey(vendorId));
  } catch (error) {
    console.error("[Redis] Failed to invalidate vendor balance cache:", error);
  }
}

// ── Enforcement ─────────────────────────────────────────────────────────────

/**
 * Throws when the vendor's balance has fallen past their block threshold.
 *
 * Lives in the service layer on purpose: order creation has three entry points
 * (dashboard, bulk import, and the partner API at POST /api/v1/orders) and they
 * all funnel through _createOrderImpl. A controller-level check would leave the
 * partner API open.
 */
export async function assertVendorCanCreateOrder(vendorId: string): Promise<void> {
  const decision = await getVendorBlockDecision(vendorId);
  if (!decision.blocked) return;

  throw new AppError(
    403,
    `Order creation is on hold: Rs. ${Math.abs(decision.balance).toFixed(2)} in delivery charges is outstanding. ` +
      `Pay at least Rs. ${decision.amountToClearBlock.toFixed(2)} to resume placing orders.`,
    "VENDOR_BILLING_BLOCKED",
  );
}

// ── Alert state machine ─────────────────────────────────────────────────────

// Every delivery moves the balance, so notifying on the value itself would fire
// dozens of times a day. Notifications are driven off transitions of the stored
// state instead: a vendor is told once when they cross a line, and once when
// they recover.
const ALERT_COPY: Record<
  vendor_billing_state,
  { title: string; body: (status: VendorBillingStatus) => string } | null
> = {
  ok: {
    title: "Delivery charges cleared",
    body: () => "Your account is back in good standing. Thank you for the payment.",
  },
  warned: {
    title: "Delivery charges due",
    body: (s) =>
      `Rs. ${Math.abs(s.balance).toFixed(2)} in delivery charges is outstanding. ` +
      `Please clear it to keep sending parcels — order creation pauses at Rs. ${Math.abs(s.blockThreshold).toFixed(2)}.`,
  },
  blocked: {
    title: "Order creation paused",
    body: (s) =>
      `Rs. ${Math.abs(s.balance).toFixed(2)} in delivery charges is outstanding, so new orders are on hold. ` +
      `Pay at least Rs. ${s.amountToClearBlock.toFixed(2)} to resume.`,
  },
};

/**
 * Recomputes a vendor's balance, stores any state change, and notifies on the
 * transition. Best-effort by contract: this hangs off deliveries, settlements
 * and payment verification, none of which should fail because a notification
 * or a Redis call did.
 */
export async function evaluateVendorBilling(vendorId: string): Promise<vendor_billing_state | null> {
  try {
    // skipCache already refreshes and rewrites the cached value, so there is
    // nothing to invalidate first.
    const status = await getVendorBillingStatus(vendorId, { skipCache: true });

    const vendor = await prisma.vendors.findFirst({
      where: { id: vendorId },
      select: { id: true, user_id: true, billing_alert_state: true },
    });
    if (!vendor || vendor.billing_alert_state === status.state) return vendor?.billing_alert_state ?? null;

    // Compare-and-swap on the state we just read. Two triggers can land at once
    // (a bulk delivery while a settlement is paid); without the guard both see
    // the old state and both notify, which is exactly what this state machine
    // exists to prevent. Whoever loses the race changes nothing and stays quiet.
    const claimed = await prisma.vendors.updateMany({
      where: { id: vendorId, billing_alert_state: vendor.billing_alert_state },
      data: { billing_alert_state: status.state, billing_alert_at: new Date() },
    });
    if (claimed.count === 0) return status.state;

    const copy = ALERT_COPY[status.state];
    if (!copy) return status.state;

    // The owner account plus any enabled staff logins — a vendor whose staff do
    // the day-to-day order entry would otherwise never see the warning.
    const staff = await prisma.vendor_staff.findMany({
      where: { vendor_id: vendorId, deleted_at: null, enabled: true, user_id: { not: null } },
      select: { user_id: true },
    });
    const recipients = [vendor.user_id, ...staff.map((s) => s.user_id)].filter(
      (id): id is string => Boolean(id),
    );

    await Promise.all(
      recipients.map((userId) =>
        createNotification(userId, copy.title, copy.body(status), null, "billing", "/finance/billing"),
      ),
    );

    return status.state;
  } catch (error) {
    console.error("[Billing] Failed to evaluate vendor billing state:", error);
    return null;
  }
}

/** Fire-and-forget wrapper for the hot paths (delivery, settlement, payment). */
export function evaluateVendorBillingAsync(vendorId: string | null | undefined): void {
  if (!vendorId) return;
  void evaluateVendorBilling(vendorId);
}

/** Same, for a batch of parcels that may span several vendors. */
export function evaluateVendorsBillingAsync(vendorIds: (string | null | undefined)[]): void {
  const unique = [...new Set(vendorIds.filter((id): id is string => Boolean(id)))];
  unique.forEach(evaluateVendorBillingAsync);
}
