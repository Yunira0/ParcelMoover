import { createHash } from "crypto";
import { parcel_status } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import redis from "../lib/redis";
import { ncmFetch, isNcmConfigured } from "../lib/ncmClient";
import { AppError } from "../utils/AppError";
import { applyExternalCarrierStatus, invalidateOrderCaches } from "./order.service";

/**
 * NCM (Nepal Can Move) — the 3PL that carries our outside-valley leg.
 *
 * Deliberately schema-free: no NCM tables or columns. The durable link
 * between a parcel and its NCM order is a parcel_remarks row written on
 * handoff ("[NCM] Handed off — order #123 → BRANCH (Type)"), which doubles
 * as the user-visible audit trail. Redis only caches lookups; if it's cold,
 * mappings are rebuilt from the remarks (parcel → order) or from NCM's label
 * endpoint, whose vendor_orderid echoes our vref_id — the last 15 chars of
 * our tracking id, NCM's vref_id field cap (order → parcel).
 */

const HANDOFF_REMARK_PREFIX = "[NCM] Handed off";
const HANDOFF_REMARK_ORDER_RE = /\[NCM\] Handed off[^#]*#(\d+)/;

const ORDER_PARCEL_CACHE_PREFIX = "ncm:order-parcel:"; // ncm order id -> parcel id
const MAPPING_TTL_SECONDS = 60 * 24 * 60 * 60; // 60 days, refreshed on access

const BRANCHES_CACHE_KEY = "ncm:branches";
const BRANCHES_TTL_SECONDS = 60 * 60;

// NCM allows 1,000 order creations/day; refuse before we hit the wall so the
// failure is a clear message instead of an opaque NCM 4xx.
const DAILY_CREATE_LIMIT = 950;
const DAILY_CREATE_COUNTER_PREFIX = "ncm:creates:";

const MAX_HANDOFF_BATCH = 100;
const STATUS_SYNC_BATCH = 100;

// Comment sync retries inline through NCM's own throttle window (its 429s
// tell us exactly how long to wait), then falls back to a durable Redis
// queue drained by the same periodic sweep that reconciles statuses — so a
// remark reaches NCM eventually even across a restart, without ever making
// the caller (addOrderRemark) wait on it.
const PENDING_COMMENTS_KEY = "ncm:pending-comments";
const INLINE_RETRY_ATTEMPTS = 2; // + the first attempt = 3 tries before queuing
const INLINE_RETRY_CAP_SECONDS = 65;
const MAX_QUEUE_ATTEMPTS = 20; // ~ spans many sweep cycles before giving up for good

// Inbound direction (NCM -> us): NCM has no webhook event for comments, only
// status changes, so this side has to poll. getbulkcomments is one call for
// the last 25 comments across every order, cheap enough to run every sweep;
// each comment is deduped by a Redis key (no stable id on NCM's side to key
// on) so re-polling the same window is safe.
const COMMENT_SEEN_KEY_PREFIX = "ncm:comment-seen:";
const COMMENT_SEEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const INBOUND_COMMENT_PREFIX = "[NCM Staff]";

export const NCM_DELIVERY_TYPES = [
  "Door2Door",
  "Branch2Door",
  "Branch2Branch",
  "Door2Branch",
] as const;
export type NcmDeliveryType = (typeof NCM_DELIVERY_TYPES)[number];

// NCM statuses that advance our parcel along the carrier leg. handoffParcelsToNcm
// already moves the parcel oov -> dispatched at handoff time (same as our own
// "Via Manifest" dispatch, so it shows under the OOV page's "In Transit" tab
// immediately rather than waiting on NCM's pickup webhook) - so "Pickup
// Complete"/"Dispatched" below are effectively no-ops, caught by the monotonic
// check in applyExternalCarrierStatus. Pre-pickup statuses ("Pickup Order
// Created", "Sent for Pickup") and return-flow statuses ("Sent to Vendor")
// don't map to an automatic transition.
const NCM_STATUS_TO_PARCEL_STATUS: Record<string, parcel_status> = {
  "Pickup Complete": "dispatched",
  Dispatched: "dispatched",
  Arrived: "arrived_at_branch",
  "Sent for Delivery": "sent_for_delivery",
  Delivered: "delivered",
};

export type NcmBranch = {
  name: string;
  code?: string;
  district?: string;
  region?: string;
  phone?: string;
  covered_areas?: string;
};

// ── Branches ─────────────────────────────────────────────────────────────────

export async function listNcmBranches(): Promise<NcmBranch[]> {
  try {
    const cached = await redis.get(BRANCHES_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (error) {
    console.error("[NCM] branches cache read failed:", error);
  }

  const branches = await ncmFetch<NcmBranch[]>("/api/v2/branches");
  try {
    await redis.set(BRANCHES_CACHE_KEY, JSON.stringify(branches), "EX", BRANCHES_TTL_SECONDS);
  } catch (error) {
    console.error("[NCM] branches cache write failed:", error);
  }
  return branches;
}

// ── Handoff (order creation) ─────────────────────────────────────────────────

type HandoffActor = { id: string; roles: string[] };

export type HandoffResultItem = {
  parcelId: string;
  trackingId: string;
  success: boolean;
  ncmOrderId?: number;
  alreadyHandedOff?: boolean;
  branch?: string;
  error?: string;
};

// NCM validates phone as 9-10 digits; ours may carry +977/separators.
function normalizePhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// NCM caps vref_id at 15 characters (confirmed against the real API — it
// silently isn't enforced by our mock), but our tracking ids are 25
// (PM-YYMMDD-<13-char random>-<check digit>). The last 15 chars are exactly
// `<random>-<check digit>`, already unique on their own, so we send that
// slice and resolve order → parcel by suffix instead of exact match.
function ncmVrefId(trackingId: string): string {
  return trackingId.slice(-15);
}

// The NCM leg starts at their origin branch (we carry parcels to it), so the
// NCM delivery type follows the *receiving* half of our service type.
function defaultDeliveryType(serviceType: string): NcmDeliveryType {
  return serviceType === "branch_delivery" ? "Branch2Branch" : "Branch2Door";
}

function handoffRemark(ncmOrderId: number, branch: string, deliveryType: string): string {
  return `${HANDOFF_REMARK_PREFIX} — order #${ncmOrderId} → ${branch} (${deliveryType})`;
}

// Auto-matches a parcel's own destination hub to an NCM branch — district
// first (both `locations` and NCM branches carry an explicit district field,
// the more reliable key), falling back to a name/city match since NCM branch
// names are city labels (e.g. POKHARA, BIRATNAGAR) that sometimes appear
// inside our own hub names (e.g. "Pokhara Branch"). No match => the caller
// skips the parcel rather than guessing a branch.
function matchNcmBranch(
  destination: { name: string; district: string | null } | null | undefined,
  branches: NcmBranch[],
): NcmBranch | undefined {
  if (!destination) return undefined;
  const district = destination.district?.trim().toUpperCase();
  if (district) {
    const byDistrict = branches.find((b) => b.district?.trim().toUpperCase() === district);
    if (byDistrict) return byDistrict;
  }
  const name = destination.name.trim().toUpperCase();
  return branches.find((b) => {
    const branchName = b.name.trim().toUpperCase();
    return name === branchName || name.includes(branchName);
  });
}

async function guardDailyCreateLimit(count: number): Promise<void> {
  const key = `${DAILY_CREATE_COUNTER_PREFIX}${new Date().toISOString().slice(0, 10)}`;
  try {
    const used = Number((await redis.get(key)) ?? 0);
    if (used + count > DAILY_CREATE_LIMIT) {
      throw new AppError(429, `NCM daily order-creation limit reached (${used}/${DAILY_CREATE_LIMIT} used today)`);
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("[NCM] daily-limit check failed (Redis), proceeding:", error);
  }
}

async function bumpDailyCreateCounter(): Promise<void> {
  const key = `${DAILY_CREATE_COUNTER_PREFIX}${new Date().toISOString().slice(0, 10)}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 2 * 24 * 60 * 60);
  } catch (error) {
    console.error("[NCM] daily-limit counter bump failed:", error);
  }
}

// The mock's webhook registration lives in that process's memory and is lost
// every time it restarts (a real NCM registration would normally be a one-time
// setup, but re-asserting it before every handoff costs one cheap idempotent
// call and guarantees status webhooks keep flowing without a manual step).
// Never blocks a handoff — if NCM/the mock is briefly unreachable, orders
// still get created and reconciliation catches up later.
function resolveWebhookBaseUrl(): string {
  return process.env.NCM_WEBHOOK_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
}

async function ensureWebhookRegistered(): Promise<void> {
  try {
    await registerNcmWebhook(resolveWebhookBaseUrl());
  } catch (error) {
    console.error("[NCM] auto webhook registration failed (continuing with handoff):", error);
  }
}

/**
 * Hands parcels currently at `oov` to NCM: (re-)registers our webhook URL,
 * auto-matches each parcel's own destination hub to an NCM branch (see
 * `matchNcmBranch` — district first, then a name/city fallback; a parcel
 * whose destination doesn't match any NCM branch is skipped, not guessed),
 * creates one NCM order per matched parcel (vref_id = last 15 chars of our
 * tracking id, NCM's field cap — see `ncmVrefId`), records the handoff as a
 * closed parcel remark, caches the order→parcel mapping, and immediately
 * moves the parcel to `dispatched` — same as our own "Via Manifest" dispatch,
 * so it shows under the OOV page's "In Transit" tab right away rather than
 * waiting on NCM's pickup webhook. Idempotent per parcel — a parcel with an
 * existing handoff remark is reported, not re-created.
 */
export async function handoffParcelsToNcm(
  actor: HandoffActor,
  parcelIds: string[],
  deliveryTypeOverride?: NcmDeliveryType,
): Promise<HandoffResultItem[]> {
  if (!isNcmConfigured()) {
    throw new AppError(503, "NCM integration is not configured");
  }
  const ids = Array.from(new Set(parcelIds));
  if (ids.length === 0) throw new AppError(400, "No parcel ids provided");
  if (ids.length > MAX_HANDOFF_BATCH) {
    throw new AppError(400, `Cannot hand off more than ${MAX_HANDOFF_BATCH} parcels at once`);
  }
  if (deliveryTypeOverride && !NCM_DELIVERY_TYPES.includes(deliveryTypeOverride)) {
    throw new AppError(400, `Invalid delivery type '${deliveryTypeOverride}'`);
  }

  const fromBranch = process.env.NCM_FROM_BRANCH;
  if (!fromBranch) {
    throw new AppError(503, "NCM_FROM_BRANCH is not configured (our hub's branch in NCM's system)");
  }

  const branches = await listNcmBranches();

  const parcels = await prisma.parcels.findMany({
    where: { id: { in: ids }, deleted_at: null },
    include: {
      parties_parcels_receiver_idToparties: true,
      locations_parcels_destination_location_idTolocations: true,
      parcel_remarks: {
        where: { remark: { startsWith: HANDOFF_REMARK_PREFIX } },
        take: 1,
      },
    },
  });
  if (parcels.length !== ids.length) {
    throw new AppError(404, "One or more parcels were not found");
  }

  const parcelsNeedingHandoff = parcels.filter((p) => p.parcel_remarks.length === 0);
  await guardDailyCreateLimit(parcelsNeedingHandoff.length);
  if (parcelsNeedingHandoff.length > 0) {
    await ensureWebhookRegistered();
  }

  const results: HandoffResultItem[] = [];
  const dispatched: { parcelId: string; trackingId: string; vendorId: string | null }[] = [];
  for (const parcel of parcels) {
    const base = { parcelId: parcel.id, trackingId: parcel.tracking_id };

    const existing = parcel.parcel_remarks[0];
    if (existing) {
      const match = existing.remark.match(HANDOFF_REMARK_ORDER_RE);
      results.push({
        ...base,
        success: true,
        alreadyHandedOff: true,
        ...(match ? { ncmOrderId: Number(match[1]) } : {}),
      });
      continue;
    }

    if (parcel.status !== "oov") {
      results.push({ ...base, success: false, error: `Parcel is '${parcel.status}', expected 'oov'` });
      continue;
    }

    const destination = parcel.locations_parcels_destination_location_idTolocations;
    const branch = matchNcmBranch(destination, branches);
    if (!branch) {
      results.push({
        ...base,
        success: false,
        error: destination
          ? `No matching NCM branch for destination '${destination.name}'`
          : "Parcel has no destination hub set",
      });
      continue;
    }

    const receiver = parcel.parties_parcels_receiver_idToparties;
    const phone = normalizePhone(receiver.phone);
    if (!/^\d{9,10}$/.test(phone)) {
      results.push({ ...base, success: false, error: `Receiver phone '${receiver.phone}' is not a valid 9-10 digit number` });
      continue;
    }
    if (!receiver.address) {
      results.push({ ...base, success: false, error: "Receiver has no address" });
      continue;
    }

    const deliveryType = deliveryTypeOverride ?? defaultDeliveryType(parcel.service_type);

    try {
      const created = await ncmFetch<{ Message: string; orderid: number }>("/api/v1/order/create", {
        method: "POST",
        body: {
          name: receiver.name,
          phone,
          phone2: normalizePhone(receiver.alternate_phone) || undefined,
          // NCM's cod_charge is the full amount collected from the receiver,
          // delivery charge included — same meaning as our cod_amount.
          cod_charge: Number(parcel.cod_amount).toFixed(2),
          address: receiver.address,
          fbranch: fromBranch,
          branch: branch.name,
          package: parcel.package_type || undefined,
          vref_id: ncmVrefId(parcel.tracking_id),
          instruction: parcel.delivery_instruction || undefined,
          delivery_type: deliveryType,
          weight: parcel.weight_kg ? String(parcel.weight_kg) : undefined,
        },
      });
      await bumpDailyCreateCounter();

      await prisma.$transaction([
        prisma.parcels.update({
          where: { id: parcel.id },
          data: { status: "dispatched" },
        }),
        prisma.parcel_status_history.create({
          data: {
            parcel_id: parcel.id,
            old_status: "oov",
            new_status: "dispatched",
            location_id: parcel.current_location_id,
            changed_by: actor.id,
            remarks: `Handed off to NCM — order #${created.orderid} → ${branch.name}`,
          },
        }),
        prisma.parcel_remarks.create({
          data: {
            parcel_id: parcel.id,
            user_id: actor.id,
            remark: handoffRemark(created.orderid, branch.name, deliveryType),
            workflow_status: "closed",
          },
        }),
        prisma.audit_logs.create({
          data: {
            actor_id: actor.id,
            entity_type: "parcel",
            entity_id: parcel.id,
            action: "NCM_HANDOFF",
            new_data: { ncmOrderId: created.orderid, branch: branch.name, deliveryType },
          },
        }),
      ]);
      await cacheOrderParcelMapping(created.orderid, parcel.id);
      dispatched.push({ parcelId: parcel.id, trackingId: parcel.tracking_id, vendorId: parcel.vendor_id });

      results.push({ ...base, success: true, ncmOrderId: created.orderid, branch: branch.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ ...base, success: false, error: message });
    }
  }

  if (dispatched.length > 0) {
    await invalidateOrderCaches();
  }

  return results;
}

// ── Order → parcel resolution ────────────────────────────────────────────────

async function cacheOrderParcelMapping(ncmOrderId: number, parcelId: string): Promise<void> {
  try {
    await redis.set(`${ORDER_PARCEL_CACHE_PREFIX}${ncmOrderId}`, parcelId, "EX", MAPPING_TTL_SECONDS);
  } catch (error) {
    console.error("[NCM] mapping cache write failed:", error);
  }
}

/**
 * Resolves which parcel an NCM order id belongs to: Redis cache first, then
 * NCM's label endpoint, whose description.vendor_orderid echoes the vref_id
 * (our tracking id) we sent on create.
 */
export async function resolveParcelIdByNcmOrder(ncmOrderId: number | string): Promise<string | null> {
  const key = `${ORDER_PARCEL_CACHE_PREFIX}${ncmOrderId}`;
  try {
    const cached = await redis.get(key);
    if (cached) return cached;
  } catch (error) {
    console.error("[NCM] mapping cache read failed:", error);
  }

  let vrefId: string | null = null;
  try {
    const label = await ncmFetch<{ description?: { vendor_orderid?: string | null } }>(
      `/api/v2/vendor/order/label/${ncmOrderId}`,
    );
    vrefId = label?.description?.vendor_orderid ?? null;
  } catch (error) {
    console.error(`[NCM] label lookup failed for order ${ncmOrderId}:`, error);
    return null;
  }
  if (!vrefId) return null;

  const parcel = await prisma.parcels.findFirst({
    where: { tracking_id: { endsWith: vrefId } },
    select: { id: true },
  });
  if (!parcel) return null;

  await cacheOrderParcelMapping(Number(ncmOrderId), parcel.id);
  return parcel.id;
}

// ── Webhook processing ───────────────────────────────────────────────────────

export type NcmWebhookPayload = {
  event?: string;
  status?: string;
  timestamp?: string;
  order_id?: string;
  order_ids?: string[];
  test?: boolean;
};

// NCM fires webhooks for consecutive statuses back to back, so two updates
// for the same parcel can collide on the per-parcel status lock (409). The
// loser is retried briefly rather than dropped — otherwise a parcel could sit
// one status behind until the next reconciliation sweep.
async function applyCarrierStatusWithRetry(
  parcelId: string,
  targetStatus: parcel_status,
  remark: string,
): Promise<{ applied: boolean; reason?: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await applyExternalCarrierStatus(parcelId, targetStatus, remark);
    } catch (error) {
      const isLockConflict = error instanceof AppError && error.statusCode === 409;
      if (!isLockConflict || attempt >= 2) throw error;
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
}

/**
 * Applies one webhook payload (single or bulk shape). Idempotent — replays
 * and out-of-order deliveries are skipped by the monotonic carrier-leg check
 * in applyExternalCarrierStatus.
 */
export async function processNcmWebhook(payload: NcmWebhookPayload): Promise<void> {
  if (payload.test) return;
  const status = payload.status;
  if (!status) return;

  const orderIds = payload.order_ids ?? (payload.order_id ? [payload.order_id] : []);
  const targetStatus = NCM_STATUS_TO_PARCEL_STATUS[status];
  if (!targetStatus) {
    console.log(`[NCM] webhook status '${status}' has no parcel mapping — ignored`);
    return;
  }

  for (const orderId of orderIds) {
    try {
      const parcelId = await resolveParcelIdByNcmOrder(orderId);
      if (!parcelId) {
        console.warn(`[NCM] webhook for unknown order ${orderId} — ignored`);
        continue;
      }
      const result = await applyCarrierStatusWithRetry(parcelId, targetStatus, `NCM: ${status}`);
      if (!result.applied) {
        console.log(`[NCM] webhook order ${orderId} → '${targetStatus}' skipped: ${result.reason}`);
      }
    } catch (error) {
      // One bad order must not block the rest of a bulk payload.
      console.error(`[NCM] webhook processing failed for order ${orderId}:`, error);
    }
  }
}

// ── Reconciliation (NCM webhooks have no retries) ────────────────────────────

/**
 * Finds every in-flight NCM-handled parcel from the durable handoff remarks
 * and bulk-polls NCM for current statuses, applying anything a lost webhook
 * missed. Safe to run repeatedly.
 */
export async function reconcileNcmStatuses(): Promise<{ checked: number; applied: number }> {
  if (!isNcmConfigured()) return { checked: 0, applied: 0 };

  const inFlight = await prisma.parcel_remarks.findMany({
    where: {
      remark: { startsWith: HANDOFF_REMARK_PREFIX },
      parcels: {
        deleted_at: null,
        status: { in: ["oov", "dispatched", "arrived_at_branch", "sent_for_delivery"] },
      },
    },
    select: { parcel_id: true, remark: true },
  });

  const orderToParcel = new Map<string, string>();
  for (const row of inFlight) {
    const match = row.remark.match(HANDOFF_REMARK_ORDER_RE);
    if (match?.[1]) orderToParcel.set(match[1], row.parcel_id);
  }
  if (orderToParcel.size === 0) return { checked: 0, applied: 0 };

  let applied = 0;
  const orderIds = Array.from(orderToParcel.keys());
  for (let i = 0; i < orderIds.length; i += STATUS_SYNC_BATCH) {
    const batch = orderIds.slice(i, i + STATUS_SYNC_BATCH);
    const response = await ncmFetch<{ result: Record<string, string>; errors: string[] }>(
      "/api/v1/orders/statuses",
      { method: "POST", body: { orders: batch.map(Number) }, retryOnce: true },
    );

    for (const [orderId, ncmStatus] of Object.entries(response.result ?? {})) {
      const parcelId = orderToParcel.get(orderId);
      const targetStatus = NCM_STATUS_TO_PARCEL_STATUS[ncmStatus];
      if (!parcelId || !targetStatus) continue;
      try {
        const result = await applyCarrierStatusWithRetry(parcelId, targetStatus, `NCM: ${ncmStatus} (reconciled)`);
        if (result.applied) applied += 1;
      } catch (error) {
        console.error(`[NCM] reconciliation failed for order ${orderId}:`, error);
      }
    }
    if (response.errors?.length) {
      console.warn(`[NCM] reconciliation: NCM did not recognize orders [${response.errors.join(", ")}]`);
    }
  }

  return { checked: orderToParcel.size, applied };
}

// Shared by getNcmInfoForParcel and syncRemarkToNcm — both need "does this
// parcel have an NCM order, and if so which one" from the same durable
// handoff remark.
async function findNcmOrderIdForParcel(parcelId: string): Promise<number | null> {
  const remark = await prisma.parcel_remarks.findFirst({
    where: { parcel_id: parcelId, remark: { startsWith: HANDOFF_REMARK_PREFIX } },
    select: { remark: true },
  });
  const match = remark?.remark.match(HANDOFF_REMARK_ORDER_RE);
  return match?.[1] ? Number(match[1]) : null;
}

type PendingComment = { ncmOrderId: number; comment: string; attempts: number };

async function enqueuePendingComment(ncmOrderId: number, comment: string, attempts = 0): Promise<void> {
  try {
    await redis.rpush(PENDING_COMMENTS_KEY, JSON.stringify({ ncmOrderId, comment, attempts }));
  } catch (error) {
    // Redis is also down — nothing left to fall back to; the comment is lost.
    console.error(`[NCM] failed to queue pending comment for order ${ncmOrderId} (dropped):`, error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postNcmComment(ncmOrderId: number, comment: string): Promise<void> {
  await ncmFetch("/api/v1/comment", {
    method: "POST",
    body: { orderid: ncmOrderId, comments: comment },
    retryOnce: false,
  });
}

// Shared by the live path (syncRemarkToNcm) and the queue-drain path
// (flushPendingNcmComments) — both need the same "wait out NCM's own quoted
// throttle window, then retry" behavior, not just a single attempt before
// giving up. A queued item that bails on its first 429 without waiting would
// nearly always re-queue itself for the next sweep instead of landing.
async function postNcmCommentWithBackoff(ncmOrderId: number, comment: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await postNcmComment(ncmOrderId, comment);
      return;
    } catch (error) {
      const retryAfter = error instanceof AppError ? error.retryAfterSeconds : undefined;
      if (retryAfter !== undefined && attempt < INLINE_RETRY_ATTEMPTS) {
        await sleep(Math.min(retryAfter, INLINE_RETRY_CAP_SECONDS) * 1000);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Pushes a remark added on our side to the matching NCM order as a comment
 * (POST /api/v1/comment), so ops staff checking the NCM portal see the same
 * context we do. No-ops if the parcel was never handed off to NCM. The
 * caller (addOrderRemark) fires this without awaiting it, so retrying here —
 * including sleeping out NCM's own throttle window on a 429 — never delays
 * the remark response. Whatever doesn't land after inline retries is queued
 * durably and picked up by the reconciliation sweep, so it still reaches NCM
 * even if the process restarts before delivery.
 */
export async function syncRemarkToNcm(parcelId: string, comment: string): Promise<void> {
  if (!isNcmConfigured()) return;
  const ncmOrderId = await findNcmOrderIdForParcel(parcelId);
  if (!ncmOrderId) return;

  try {
    await postNcmCommentWithBackoff(ncmOrderId, comment);
  } catch (error) {
    console.error(`[NCM] remark sync failed for parcel ${parcelId}, queuing for retry:`, error);
    await enqueuePendingComment(ncmOrderId, comment);
  }
}

/**
 * Drains `PENDING_COMMENTS_KEY`: comments that didn't make it to NCM even
 * after `syncRemarkToNcm`'s inline retries (sustained throttling, NCM down,
 * or the process restarting mid-retry). Called from the same periodic sweep
 * as `reconcileNcmStatuses`. Only drains what's queued at call time — a
 * failure re-queued here lands after this LLEN snapshot and is retried on
 * the next sweep, not spun on immediately. A small pacing gap between items
 * keeps a multi-item flush from bursting requests fast enough to trip NCM's
 * own throttle itself.
 */
export async function flushPendingNcmComments(): Promise<{ attempted: number; delivered: number }> {
  if (!isNcmConfigured()) return { attempted: 0, delivered: 0 };

  let attempted = 0;
  let delivered = 0;
  const count = await redis.llen(PENDING_COMMENTS_KEY).catch(() => 0);
  for (let i = 0; i < count; i++) {
    const raw = await redis.lpop(PENDING_COMMENTS_KEY).catch(() => null);
    if (!raw) break;

    let entry: PendingComment;
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }

    if (i > 0) await sleep(300);
    attempted += 1;
    try {
      await postNcmCommentWithBackoff(entry.ncmOrderId, entry.comment);
      delivered += 1;
    } catch (error) {
      const attempts = entry.attempts + 1;
      if (attempts >= MAX_QUEUE_ATTEMPTS) {
        console.error(
          `[NCM] giving up on queued comment for order ${entry.ncmOrderId} after ${attempts} attempts:`,
          error,
        );
      } else {
        await enqueuePendingComment(entry.ncmOrderId, entry.comment, attempts);
      }
    }
  }
  return { attempted, delivered };
}

// ── Inbound comment sync (NCM -> us) ─────────────────────────────────────────

type NcmCommentItem = {
  orderid: string | number;
  comments: string;
  addedBy?: "NCM Staff" | "Vendor" | string;
  added_time?: string;
};

function commentSeenKey(orderId: string, addedTime: string, comment: string): string {
  const hash = createHash("sha1").update(`${addedTime}|${comment}`).digest("hex").slice(0, 16);
  return `${COMMENT_SEEN_KEY_PREFIX}${orderId}:${hash}`;
}

// Redis errors resolve to `null` (unknown) rather than `false` (not seen) so
// a flaky cache fails toward skipping a comment for one cycle, not toward
// inserting it twice.
async function hasSeenComment(orderId: string, addedTime: string, comment: string): Promise<boolean | null> {
  try {
    return Boolean(await redis.get(commentSeenKey(orderId, addedTime, comment)));
  } catch (error) {
    console.error("[NCM] comment-dedup cache read failed:", error);
    return null;
  }
}

async function markCommentSeen(orderId: string, addedTime: string, comment: string): Promise<void> {
  try {
    await redis.set(commentSeenKey(orderId, addedTime, comment), "1", "EX", COMMENT_SEEN_TTL_SECONDS);
  } catch (error) {
    console.error("[NCM] comment-dedup cache write failed:", error);
  }
}

/**
 * Pulls NCM-side comments into our parcel remarks — the other half of
 * syncRemarkToNcm. NCM has no webhook for comments, so this polls
 * getbulkcomments (last 25 across all orders) from the same periodic sweep
 * that reconciles statuses. Only "NCM Staff" comments are ingested — "Vendor"
 * comments are ones posted through the vendor API (i.e. our own
 * syncRemarkToNcm writes echoed back), and ingesting those would loop them
 * back onto the parcel as a duplicate. Written directly with prisma (not
 * through addOrderRemark) so this inbound path never re-triggers the
 * outbound sync.
 */
export async function syncNcmCommentsToParcels(): Promise<{ checked: number; ingested: number }> {
  if (!isNcmConfigured()) return { checked: 0, ingested: 0 };

  let raw: unknown;
  try {
    raw = await ncmFetch<unknown>("/api/v1/order/getbulkcomments");
  } catch (error) {
    console.error("[NCM] fetching bulk comments failed:", error);
    return { checked: 0, ingested: 0 };
  }

  const items: NcmCommentItem[] = Array.isArray(raw)
    ? raw
    : ((raw as any)?.comments ?? (raw as any)?.results ?? (raw as any)?.data ?? []);

  let ingested = 0;
  for (const item of items) {
    if (item.addedBy !== "NCM Staff" || !item.comments) continue;

    const orderId = String(item.orderid);
    const addedTime = item.added_time ?? "";
    const seen = await hasSeenComment(orderId, addedTime, item.comments);
    if (seen !== false) continue; // true = already ingested, null = dedup cache unavailable — skip either way

    const parcelId = await resolveParcelIdByNcmOrder(orderId);
    if (!parcelId) {
      console.warn(`[NCM] inbound comment for unknown order ${orderId} — ignored`);
      continue;
    }

    try {
      await prisma.parcel_remarks.create({
        data: {
          parcel_id: parcelId,
          user_id: null,
          remark: `${INBOUND_COMMENT_PREFIX} ${item.comments}`,
        },
      });
      await markCommentSeen(orderId, addedTime, item.comments);
      ingested += 1;
    } catch (error) {
      console.error(`[NCM] failed to store inbound comment for order ${orderId}:`, error);
    }
  }

  return { checked: items.length, ingested };
}

// ── Per-parcel info (for the ops UI) ─────────────────────────────────────────

export type NcmParcelInfo = {
  handedOff: boolean;
  ncmOrderId?: number;
  lastStatus?: string;
  paymentStatus?: string;
  deliveryCharge?: string;
};

export async function getNcmInfoForParcel(parcelId: string): Promise<NcmParcelInfo> {
  const ncmOrderId = await findNcmOrderIdForParcel(parcelId);
  if (!ncmOrderId) return { handedOff: false };

  try {
    const order = await ncmFetch<{
      last_delivery_status?: string;
      payment_status?: string;
      delivery_charge?: string;
    }>("/api/v1/order", { query: { id: ncmOrderId } });
    return {
      handedOff: true,
      ncmOrderId,
      ...(order.last_delivery_status !== undefined ? { lastStatus: order.last_delivery_status } : {}),
      ...(order.payment_status !== undefined ? { paymentStatus: order.payment_status } : {}),
      ...(order.delivery_charge !== undefined ? { deliveryCharge: order.delivery_charge } : {}),
    };
  } catch (error) {
    console.error(`[NCM] order detail lookup failed for ${ncmOrderId}:`, error);
    return { handedOff: true, ncmOrderId };
  }
}

// ── Webhook registration ─────────────────────────────────────────────────────

/**
 * Registers our receiver URL with NCM. The URL embeds NCM_WEBHOOK_SECRET as a
 * path segment because NCM signs nothing — the secret path *is* the auth.
 */
export async function registerNcmWebhook(publicBaseUrl: string): Promise<{ url: string; ncmResponse: unknown }> {
  const secret = process.env.NCM_WEBHOOK_SECRET;
  if (!secret) throw new AppError(503, "NCM_WEBHOOK_SECRET is not configured");
  if (!/^https?:\/\//.test(publicBaseUrl)) {
    throw new AppError(400, "publicBaseUrl must be an absolute http(s) URL");
  }

  const url = `${publicBaseUrl.replace(/\/$/, "")}/api/ncm/webhook/${secret}`;
  const ncmResponse = await ncmFetch("/api/v2/vendor/webhook", {
    method: "POST",
    body: { webhook_url: url },
    retryOnce: false,
  });
  return { url, ncmResponse };
}
