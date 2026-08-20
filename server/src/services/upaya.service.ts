import { order_type as PmOrderType, parcel_status } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import redis from "../lib/redis";
import { upayaFetch, isUpayaConfigured } from "../lib/upayaClient";
import { AppError } from "../utils/AppError";
import {
  applyExternalCarrierFollowUp,
  applyExternalCarrierStatus,
  invalidateOrderCaches,
} from "./order.service";
import {
  CARRIER_AUTHOR_LABEL,
  UPAYA_HANDOFF_REMARK_PREFIX,
  UPAYA_STAFF_PREFIX,
} from "../utils/carrierRemark";

/**
 * Upaya — our second outside-valley 3PL, used alongside NCM (see
 * ncm.service.ts for the pattern this mirrors). Deliberately schema-free for
 * the parcel<->order link, same idiom as NCM: a closed parcel_remarks row on
 * handoff is the durable audit trail + reconciliation source; Redis only
 * caches lookups.
 *
 * area_id (see matchUpayaArea) is auto-matched per parcel from Upaya's own
 * ~5,759-area network (GET /client/locations, Redis-cached), same intent as
 * NCM's live branch match but at much finer granularity. One more gap NCM
 * doesn't have: no webhook-registration API (the webhook URL is pasted into
 * Upaya's merchant portal by hand). Several of Upaya's documented request/
 * response shapes also turned out to be wrong or incomplete once tested
 * against the real API (see docs/upaya-integration-plan.md for the list) -
 * response parsing below reflects what was actually confirmed, not the PDF.
 */

// Branded, and deliberately still so: this is the durable parcel -> Upaya
// order mapping (see carrierRemark.ts). It is neutralised for display, not in
// the database, because rewriting it would orphan in-flight parcels.
export const HANDOFF_REMARK_PREFIX = UPAYA_HANDOFF_REMARK_PREFIX;
const HANDOFF_REMARK_ORDER_RE = /Parcel dispatched via Upaya[^#]*#(\S+)/;

const ORDER_PARCEL_CACHE_PREFIX = "upaya:order-parcel:"; // upaya order id -> parcel id
const MAPPING_TTL_SECONDS = 60 * 24 * 60 * 60; // 60 days, refreshed on access

const LOCATIONS_CACHE_KEY = "upaya:locations";
const LOCATIONS_TTL_SECONDS = 60 * 60;

const MAX_HANDOFF_BATCH = 100;
// No bulk status endpoint is documented for Upaya (unlike NCM's
// /orders/statuses), so reconciliation polls Track Order per order. Bounded
// so one sweep can't run unboundedly long; the next sweep picks up the rest.
const RECONCILE_BATCH = 50;
const RECONCILE_INTER_REQUEST_DELAY_MS = 150;

// Upaya's Add Order order_type values map 1:1 to ours.
const PM_TO_UPAYA_ORDER_TYPE: Record<PmOrderType, "delivery_order" | "return_order" | "exchange_order"> = {
  delivery: "delivery_order",
  return: "return_order",
  exchange: "exchange_order",
};

// ── Status mapping (webhook/reconcile `status` -> our parcel_status) ────────

// Forward carrier leg (applyExternalCarrierStatus enforces the monotonic
// oov -> dispatched -> arrived_at_branch -> sent_for_delivery -> delivered
// order on its own, so pre-pickup/in-transit statuses mapped to "dispatched"
// here are no-ops once the parcel is already there — same as NCM).
const UPAYA_FORWARD_STATUS_MAP: Record<string, parcel_status> = {
  "unassigned-pickup": "dispatched",
  "assigned-pickup": "dispatched",
  "picked-up-by-rider": "dispatched",
  "failed-pickup": "dispatched",
  "inbound-at-warehouse": "dispatched",
  "midmile-sortation": "dispatched",
  "prepared-for-transit": "dispatched",
  "in-transit-to-hub": "dispatched",
  "in-transit": "dispatched",
  "received-at-hub": "arrived_at_branch",
  "ready-for-dispatch": "arrived_at_branch",
  "dispatched-with-rider": "sent_for_delivery",
  delivered: "delivered",
};

// One-way exit into our own ops-driven Return-to-Origin ladder (same verb
// NCM's "Sent to Vendor" uses) - from here on, further Upaya "return"
// webhooks are informational only (see UPAYA_LOGGED_ONLY_STATUSES), not
// carrier-driven, because a real internal rider takes it from follow_up.
const UPAYA_FOLLOWUP_STATUSES = new Set(["on-field-failed-delivery", "followup-for-return"]);

// Never auto-applied to parcel_status - surfaced as an open parcel_remarks
// row instead so a human decides (matching the caution already documented
// for carrier-only status updates: these are the ones with real
// consequences - hold, loss/damage, and cancellation - that shouldn't be
// silently driven by an unauthenticated-by-signature webhook).
const UPAYA_REVIEW_FLAGGED_STATUSES = new Set(["hold", "loss-and-damage", "cancelled"]);

// Everything else: logged as a closed (non-queue) parcel_remarks row purely
// for the Upaya-side audit trail - either the parcel already exited onto our
// own RTO ladder (the return sub-steps below) or the event isn't otherwise
// actionable (redirected/dispose).
const UPAYA_LOGGED_ONLY_STATUSES = new Set([
  "confirmed-for-return",
  "out-for-return",
  "return-processed-from-hub",
  "return-received-at-central-facility",
  "on-field-failed-return",
  "returned-to-vendor",
  "redirected",
  "dispose",
]);

const INBOUND_COMMENT_PREFIX = UPAYA_STAFF_PREFIX;

// The PDF documented { locationId, locationName, address } - the real
// response is a completely different shape: an envelope { meta, data: [...] }
// where each location is one of Upaya's ~800 serviceable localities
// nationwide (own hub/area network, not "our own registered location"),
// each carrying its own nested `areas` array. An area's own numeric `id` is
// exactly the `area_id` Add Order wants - so unlike what the doc implied,
// there IS a live lookup for it, just not where the doc said.
export type UpayaDeliveryArea = {
  id: number;
  name: string;
  locationId: number;
  locationName: string;
  hubName?: string | undefined;
  isActive?: boolean | undefined;
  deliveryService?: boolean | undefined;
  codService?: boolean | undefined;
};

type UpayaLocationWithAreas = {
  id: number;
  name: string;
  hubName?: string;
  areas?: Array<{
    id: number;
    name: string;
    locationId?: number;
    locationName?: string;
    isActive?: boolean;
    deliveryService?: boolean;
    codService?: boolean;
  }>;
};

// ── Locations + delivery areas (Upaya's full serviceable network) ───────────

async function fetchUpayaLocations(): Promise<UpayaLocationWithAreas[]> {
  try {
    const cached = await redis.get(LOCATIONS_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (error) {
    console.error("[Upaya] locations cache read failed:", error);
  }

  const response = await upayaFetch<{ data: UpayaLocationWithAreas[] }>("/api/v1/client/locations");
  const locations = response?.data ?? [];
  try {
    await redis.set(LOCATIONS_CACHE_KEY, JSON.stringify(locations), "EX", LOCATIONS_TTL_SECONDS);
  } catch (error) {
    console.error("[Upaya] locations cache write failed:", error);
  }
  return locations;
}

export async function listUpayaLocations(): Promise<UpayaLocationWithAreas[]> {
  return fetchUpayaLocations();
}

/** Flattened, searchable list of every delivery area across Upaya's network - this is what the OOV handoff area picker searches. */
export async function listUpayaDeliveryAreas(): Promise<UpayaDeliveryArea[]> {
  const locations = await fetchUpayaLocations();
  return locations.flatMap((loc) =>
    (loc.areas ?? []).map((area) => ({
      id: area.id,
      name: area.name,
      locationId: area.locationId ?? loc.id,
      locationName: area.locationName ?? loc.name,
      hubName: loc.hubName,
      isActive: area.isActive,
      deliveryService: area.deliveryService,
      codService: area.codService,
    })),
  );
}

// ── Order rates (optional quote helper) ──────────────────────────────────────

export type UpayaOrderRateInput = {
  initialWeight: number;
  orderType: string;
  serviceTypeId: number;
  locationId: number;
  length?: number;
  breadth?: number;
  height?: number;
};

export async function getUpayaOrderRate(input: UpayaOrderRateInput): Promise<unknown> {
  return upayaFetch("/api/v1/client/order-rates", {
    method: "POST",
    body: {
      initial_weight: input.initialWeight,
      order_type: input.orderType,
      service_type_id: input.serviceTypeId,
      location_id: input.locationId,
      length: input.length ?? null,
      breadth: input.breadth ?? null,
      height: input.height ?? null,
    },
  });
}

// ── Handoff (order creation) ─────────────────────────────────────────────────

type HandoffActor = { id: string; roles: string[] };

export type UpayaHandoffResultItem = {
  parcelId: string;
  trackingId: string;
  success: boolean;
  upayaOrderId?: string;
  alreadyHandedOff?: boolean;
  area?: string;
  error?: string;
};

function normalizePhone(phone: string | null | undefined): string {
  return (phone ?? "").replace(/\D/g, "");
}

// Upaya's service_type_id reference: 3 Door To Door, 4 Door To Branch,
// 5 Branch To Branch, 6 Activation, 7 Bulk. Derived from our own
// parcel.service_type the same way NCM's defaultDeliveryType is - driven by
// data we already control, not an address guess, so this is safe to
// auto-apply per parcel rather than asking ops to pick it every time.
function defaultUpayaServiceTypeId(serviceType: string): number {
  return serviceType === "branch_delivery" ? 4 : 3;
}

// Confirmed against the real API (not just the doc): order_reference_id
// rejects our tracking id's hyphens ("format is invalid"). Stripped to
// alphanumeric-only on the way out; resolveParcelIdByUpayaOrder matches
// parcels the same way on the way back in, since the webhook echoes this
// exact stripped value, not the original tracking_id.
function sanitizeOrderReferenceId(trackingId: string): string {
  return trackingId.replace(/[^a-zA-Z0-9]/g, "");
}

function handoffRemark(upayaOrderId: string, areaName: string): string {
  return `${HANDOFF_REMARK_PREFIX} — order #${upayaOrderId} → ${areaName}`;
}

// Our own destination hub names embed their district as "PLACE - DISTRICT"
// (see [[project_location_names_include_district]]) - split that off so the
// specific place name (the useful, comparatively unique matching key) isn't
// diluted by a district suffix that's shared by hundreds of other places.
function upayaMatchPlaceName(destinationName: string): string {
  const dashIndex = destinationName.indexOf(" - ");
  return (dashIndex === -1 ? destinationName : destinationName.slice(0, dashIndex)).trim();
}

// Auto-matches a parcel's own destination hub to a specific Upaya delivery
// area — same intent as NCM's matchNcmBranch, adapted for Upaya's much finer
// granularity (~5,759 areas vs. NCM's few dozen branches, and no district
// field on the area object to key off directly). Two tiers, most confident
// first; a destination that can't be matched confidently returns undefined
// rather than guessing, so the caller skips it instead of risking a
// misroute to the wrong part of a city:
//   1. The destination's own place name (district suffix stripped) equals a
//      specific area's own name exactly - e.g. our "Dhulikhel -
//      Kavrepalanchok" hub exactly matches the area literally named
//      "Dhulikhel", even though Upaya splits that same location into 16
//      other more specific ward-level areas alongside it.
//   2. Destination matches the parent hub Upaya groups areas under
//      (hubName, roughly NCM-branch-level granularity) - only safe to
//      auto-pick when that hub has exactly one area; more than one is
//      genuinely ambiguous without finer address data than we track.
// Deliberately NOT a loose substring match: matching on district/city
// containment is unsafe in practice - e.g. our "Chakarghatti - Sunsari"
// hub's district "Sunsari" is a substring of the unrelated area name
// "RajabasSunsari" (a different place entirely, just also in Sunsari
// district), which a naive contains-match would wrongly pick.
function matchUpayaArea(
  destination: { name: string; district: string | null; city: string | null } | null | undefined,
  areas: UpayaDeliveryArea[],
): UpayaDeliveryArea | undefined {
  if (!destination) return undefined;

  const placeName = upayaMatchPlaceName(destination.name).toUpperCase();
  if (placeName) {
    const exact = areas.find((a) => a.name.trim().toUpperCase() === placeName);
    if (exact) return exact;
  }

  const hubTargets = [destination.district, destination.city]
    .filter((v): v is string => Boolean(v && v.trim()))
    .map((v) => v.trim().toUpperCase());
  for (const target of hubTargets) {
    const hubMatches = areas.filter((a) => (a.hubName ?? "").trim().toUpperCase() === target);
    if (hubMatches.length === 1) return hubMatches[0];
    if (hubMatches.length > 1) return undefined; // ambiguous - don't guess
  }
  return undefined;
}

// Confirmed against the real API (the PDF's schema was cut off): Add Order's
// response is { meta, data: { message, data: [{ trackingCode,
// orderReferenceId }] } } — there is no numeric/opaque order id at all, only
// a tracking code. That tracking code is also what Track Order's :orderid
// path segment actually expects (their doc's own path-variable example,
// "WRL2408001AZSN", is a tracking code, not a number) - so it doubles as our
// order identifier everywhere below despite the "OrderId" naming.
function extractUpayaOrderId(response: any): string | null {
  const candidate =
    response?.data?.data?.[0]?.trackingCode ?? response?.data?.[0]?.trackingCode ?? response?.trackingCode;
  return candidate !== undefined && candidate !== null ? String(candidate) : null;
}

/**
 * Hands parcels currently at `oov` to Upaya: auto-matches each parcel's own
 * destination hub to a specific Upaya delivery area (see `matchUpayaArea` —
 * a parcel whose destination doesn't match any area confidently is skipped,
 * not guessed, same caution NCM's handoff uses) and derives its
 * service_type_id from our own service_type (see `defaultUpayaServiceTypeId`),
 * builds one Add Order request per matched parcel, records the handoff as a
 * closed parcel remark, caches the order->parcel mapping, and immediately
 * moves the parcel to `dispatched` (same as NCM and our own "Via Manifest"
 * dispatch, so it shows under OOV's "In Transit" tab right away rather than
 * waiting on a webhook). Idempotent per parcel.
 */
export async function handoffParcelsToUpaya(
  actor: HandoffActor,
  parcelIds: string[],
  serviceTypeIdOverride?: number,
  orderTypeOverride?: PmOrderType,
): Promise<UpayaHandoffResultItem[]> {
  if (!isUpayaConfigured()) {
    throw new AppError(503, "Upaya integration is not configured");
  }
  const ids = Array.from(new Set(parcelIds));
  if (ids.length === 0) throw new AppError(400, "No parcel ids provided");
  if (ids.length > MAX_HANDOFF_BATCH) {
    throw new AppError(400, `Cannot hand off more than ${MAX_HANDOFF_BATCH} parcels at once`);
  }

  const defaultCategoryId = Number(process.env.UPAYA_DEFAULT_PRODUCT_CATEGORY_ID);
  if (!process.env.UPAYA_DEFAULT_PRODUCT_CATEGORY_ID || Number.isNaN(defaultCategoryId)) {
    throw new AppError(503, "UPAYA_DEFAULT_PRODUCT_CATEGORY_ID is not configured");
  }

  const areas = await listUpayaDeliveryAreas();

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

  const results: UpayaHandoffResultItem[] = [];
  const dispatched: string[] = [];
  for (const parcel of parcels) {
    const base = { parcelId: parcel.id, trackingId: parcel.tracking_id };

    const existing = parcel.parcel_remarks[0];
    if (existing) {
      const match = existing.remark.match(HANDOFF_REMARK_ORDER_RE);
      results.push({
        ...base,
        success: true,
        alreadyHandedOff: true,
        ...(match ? { upayaOrderId: match[1] } : {}),
      });
      continue;
    }

    if (parcel.status !== "oov") {
      results.push({ ...base, success: false, error: `Parcel is '${parcel.status}', expected 'oov'` });
      continue;
    }

    const destination = parcel.locations_parcels_destination_location_idTolocations;
    const area = matchUpayaArea(destination, areas);
    if (!area) {
      results.push({
        ...base,
        success: false,
        error: destination
          ? `No confident Upaya area match for destination '${destination.name}'`
          : "Parcel has no destination hub set",
      });
      continue;
    }

    const receiver = parcel.parties_parcels_receiver_idToparties;
    const phone = normalizePhone(receiver.phone);
    if (!phone) {
      results.push({ ...base, success: false, error: `Receiver phone '${receiver.phone}' is invalid` });
      continue;
    }
    if (!receiver.address) {
      results.push({ ...base, success: false, error: "Receiver has no address" });
      continue;
    }

    const orderType = PM_TO_UPAYA_ORDER_TYPE[orderTypeOverride ?? parcel.order_type];
    const serviceTypeId = serviceTypeIdOverride ?? defaultUpayaServiceTypeId(parcel.service_type);

    try {
      const created = await upayaFetch<any>("/api/v1/client/add-order", {
        method: "POST",
        retryOnce: false,
        body: {
          orders: [
            {
              receiver_name: receiver.name,
              receiver_contact: phone,
              receiver_alternate_number: normalizePhone(receiver.alternate_phone) || undefined,
              area_id: area.id,
              // Upaya rejects product_price < 1 - floor it rather than
              // sending an unset/zero item_value straight through.
              product_price: Math.max(1, Number(parcel.item_value ?? 0)),
              cod_amount: Number(parcel.cod_amount ?? 0),
              remarks: parcel.delivery_instruction || undefined,
              receiver_address: receiver.address,
              order_reference_id: sanitizeOrderReferenceId(parcel.tracking_id),
              // Confirmed against the real API: the field is "weight", not
              // "initial_weight" (the doc's Add Order body list is wrong/
              // inconsistent on this - two of its three sample orders use
              // "initial_weight", the field Upaya's server actually requires
              // is "weight").
              weight: parcel.weight_kg && Number(parcel.weight_kg) > 0 ? Number(parcel.weight_kg) : 0.5,
              service_type_id: serviceTypeId,
              product_description: parcel.package_type || "Parcel",
              product_category_id: defaultCategoryId,
              order_type: orderType,
              client_note: `ParcelMoover handoff — ${parcel.tracking_id}`,
            },
          ],
        },
      });

      const upayaOrderId = extractUpayaOrderId(created);
      if (!upayaOrderId) {
        throw new AppError(502, "Upaya did not return a recognizable order id (see Add Order response shape)");
      }

      await prisma.$transaction([
        prisma.parcels.update({ where: { id: parcel.id }, data: { status: "dispatched" } }),
        prisma.parcel_status_history.create({
          data: {
            parcel_id: parcel.id,
            old_status: "oov",
            new_status: "dispatched",
            location_id: parcel.current_location_id,
            changed_by: actor.id,
            remarks: handoffRemark(upayaOrderId, area.name),
          },
        }),
        prisma.parcel_remarks.create({
          data: {
            parcel_id: parcel.id,
            user_id: actor.id,
            remark: handoffRemark(upayaOrderId, area.name),
            workflow_status: "closed",
          },
        }),
        prisma.audit_logs.create({
          data: {
            actor_id: actor.id,
            entity_type: "parcel",
            entity_id: parcel.id,
            action: "UPAYA_HANDOFF",
            new_data: { upayaOrderId, area: area.name, serviceTypeId },
          },
        }),
      ]);
      await cacheOrderParcelMapping(upayaOrderId, parcel.id);
      dispatched.push(parcel.id);

      results.push({ ...base, success: true, upayaOrderId, area: area.name });
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

// ── Order -> parcel resolution ───────────────────────────────────────────────

async function cacheOrderParcelMapping(upayaOrderId: string, parcelId: string): Promise<void> {
  try {
    await redis.set(`${ORDER_PARCEL_CACHE_PREFIX}${upayaOrderId}`, parcelId, "EX", MAPPING_TTL_SECONDS);
  } catch (error) {
    console.error("[Upaya] mapping cache write failed:", error);
  }
}

/**
 * Resolves which parcel a webhook/reconcile event belongs to. Unlike NCM,
 * Upaya's webhook payload always echoes `order_reference_id` (our
 * tracking_id) directly, so that's tried first; the Redis order-id cache is
 * the fallback (used by reconciliation, which only has the order id).
 */
async function resolveParcelIdByUpayaOrder(
  upayaOrderId: string | number,
  orderReferenceId?: string | null,
): Promise<string | null> {
  if (orderReferenceId) {
    // order_reference_id is tracking_id with non-alphanumeric characters
    // stripped (see sanitizeOrderReferenceId) - matched the same way here
    // rather than by exact equality, since Upaya echoes back the stripped
    // form, not the original.
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM parcels
      WHERE deleted_at IS NULL
        AND REGEXP_REPLACE(tracking_id, '[^a-zA-Z0-9]', '', 'g') = ${orderReferenceId}
      LIMIT 1
    `;
    const parcel = rows[0];
    if (parcel) {
      await cacheOrderParcelMapping(String(upayaOrderId), parcel.id);
      return parcel.id;
    }
  }

  const key = `${ORDER_PARCEL_CACHE_PREFIX}${upayaOrderId}`;
  try {
    const cached = await redis.get(key);
    if (cached) return cached;
  } catch (error) {
    console.error("[Upaya] mapping cache read failed:", error);
  }
  return null;
}

// ── Webhook processing ───────────────────────────────────────────────────────

export type UpayaWebhookPayload = {
  update_type?: "order_status" | "comment";
  order_id?: string | number;
  order_reference_id?: string;
  status?: string;
  comment?: string;
  commented_by?: string;
  commented_at?: string;
};

// Same reasoning as NCM's retry wrapper: back-to-back status webhooks for the
// same parcel can collide on the per-parcel status lock (409); the loser
// retries briefly rather than being dropped until the next reconcile sweep.
async function applyStatusWithRetry(
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

async function applyUpayaStatus(parcelId: string, status: string, suffix: string): Promise<boolean> {
  // Neutral label, matching ncm.service - a vendor reading the timeline should
  // not be told which 3PL we handed their parcel to.
  const remark = `${CARRIER_AUTHOR_LABEL}: ${status}${suffix}`;

  if (UPAYA_FOLLOWUP_STATUSES.has(status)) {
    const result = await applyExternalCarrierFollowUp(parcelId, remark);
    if (!result.applied) console.log(`[Upaya] ${status} skipped for parcel ${parcelId}: ${result.reason}`);
    return result.applied;
  }

  const targetStatus = UPAYA_FORWARD_STATUS_MAP[status];
  if (targetStatus) {
    const result = await applyStatusWithRetry(parcelId, targetStatus, remark);
    if (!result.applied) console.log(`[Upaya] ${status} -> '${targetStatus}' skipped for parcel ${parcelId}: ${result.reason}`);
    return result.applied;
  }

  if (UPAYA_REVIEW_FLAGGED_STATUSES.has(status)) {
    await prisma.parcel_remarks.create({
      data: { parcel_id: parcelId, user_id: null, remark: `${INBOUND_COMMENT_PREFIX} ${remark} — needs review` },
    });
    return false;
  }

  if (UPAYA_LOGGED_ONLY_STATUSES.has(status)) {
    await prisma.parcel_remarks.create({
      data: { parcel_id: parcelId, user_id: null, remark: `${INBOUND_COMMENT_PREFIX} ${remark}`, workflow_status: "closed" },
    });
    return false;
  }

  console.log(`[Upaya] webhook status '${status}' has no handling — ignored`);
  return false;
}

/**
 * Applies one webhook payload — either an order_status update or a comment.
 * Idempotent: replays/out-of-order status events are skipped by the
 * monotonic carrier-leg check inside applyExternalCarrierStatus.
 */
export async function processUpayaWebhook(payload: UpayaWebhookPayload): Promise<void> {
  if (!payload.order_id && !payload.order_reference_id) return;

  const parcelId = await resolveParcelIdByUpayaOrder(payload.order_id ?? "", payload.order_reference_id);
  if (!parcelId) {
    console.warn(`[Upaya] webhook for unknown order ${payload.order_id ?? payload.order_reference_id} — ignored`);
    return;
  }

  try {
    if (payload.update_type === "comment") {
      if (!payload.comment) return;
      const by = payload.commented_by ? ` (${payload.commented_by})` : "";
      await prisma.parcel_remarks.create({
        data: { parcel_id: parcelId, user_id: null, remark: `${INBOUND_COMMENT_PREFIX}${by} ${payload.comment}` },
      });
      return;
    }

    if (!payload.status) return;
    await applyUpayaStatus(parcelId, payload.status, "");
  } catch (error) {
    console.error(`[Upaya] webhook processing failed for order ${payload.order_id}:`, error);
  }
}

// ── Reconciliation (Upaya webhooks may be missed; no bulk status endpoint) ──

async function findHandoffOrderId(remark: string): Promise<string | null> {
  const match = remark.match(HANDOFF_REMARK_ORDER_RE);
  return match?.[1] ?? null;
}

export async function trackUpayaOrder(upayaOrderId: string): Promise<{ status?: string; raw: unknown }> {
  const raw = await upayaFetch<any>(`/api/v1/client/track-order/${encodeURIComponent(upayaOrderId)}`);
  // Response shape is unconfirmed (the source doc's schema is cut off) - try
  // the field names that would make sense next to the webhook's "status".
  const status = raw?.status ?? raw?.order_status ?? raw?.data?.status;
  return { status, raw };
}

/**
 * Finds every in-flight Upaya-handled parcel from the durable handoff
 * remarks and polls Track Order per order (no bulk endpoint is documented),
 * applying anything a lost webhook missed. Bounded batch per sweep; safe to
 * run repeatedly.
 */
export async function reconcileUpayaStatuses(): Promise<{ checked: number; applied: number }> {
  if (!isUpayaConfigured()) return { checked: 0, applied: 0 };

  const inFlight = await prisma.parcel_remarks.findMany({
    where: {
      remark: { startsWith: HANDOFF_REMARK_PREFIX },
      parcels: {
        deleted_at: null,
        status: { in: ["oov", "dispatched", "arrived_at_branch", "sent_for_delivery"] },
      },
    },
    select: { parcel_id: true, remark: true },
    take: RECONCILE_BATCH,
  });

  let applied = 0;
  let checked = 0;
  for (const row of inFlight) {
    const orderId = await findHandoffOrderId(row.remark);
    if (!orderId) continue;
    checked += 1;
    try {
      const { status } = await trackUpayaOrder(orderId);
      if (status && (await applyUpayaStatus(row.parcel_id, status, " (reconciled)"))) {
        applied += 1;
      }
    } catch (error) {
      console.error(`[Upaya] reconciliation failed for order ${orderId}:`, error);
    }
    await new Promise((r) => setTimeout(r, RECONCILE_INTER_REQUEST_DELAY_MS));
  }

  return { checked, applied };
}

// ── Per-parcel info (for the ops UI) ─────────────────────────────────────────

export type UpayaParcelInfo = { handedOff: boolean; upayaOrderId?: string; lastStatus?: string };

export async function getUpayaInfoForParcel(parcelId: string): Promise<UpayaParcelInfo> {
  const remark = await prisma.parcel_remarks.findFirst({
    where: { parcel_id: parcelId, remark: { startsWith: HANDOFF_REMARK_PREFIX } },
    select: { remark: true },
  });
  const upayaOrderId = remark ? await findHandoffOrderId(remark.remark) : null;
  if (!upayaOrderId) return { handedOff: false };

  try {
    const { status } = await trackUpayaOrder(upayaOrderId);
    return { handedOff: true, upayaOrderId, ...(status ? { lastStatus: status } : {}) };
  } catch (error) {
    console.error(`[Upaya] order detail lookup failed for ${upayaOrderId}:`, error);
    return { handedOff: true, upayaOrderId };
  }
}
