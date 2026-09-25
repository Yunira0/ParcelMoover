import { parcel_status, Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { generateTransitManifestNo } from "../../utils/transitManifestNo";
import { MAX_TRANSIT_MANIFEST_PARCELS } from "../../types/transitManifest.type";
import { BulkUpdateParcelStatusInput, ParcelStatus, STATUS_TRANSITIONS } from "../../types/order.type";
import { invalidateVendorFinanceCache, invalidateRiderFinanceCache } from "../finance.service";
import { evaluateVendorsBillingAsync, statusAffectsBalance } from "../billing.service";
import { createNotification } from "../notification.service";
import { emitWebhookEventsBatch } from "../webhookDispatch.service";
import { computeReturnCharge } from "./pricing";
import { invalidateOrderCaches } from "./cache";
import { withParcelStatusLocks } from "./statusLocks";
import {
  getActorScope, getAdminBranchScope, branchTouchesFilter, resolveActiveRider,
} from "./scope";
import {
  HUB_OPERATION_STATUSES, RETURN_WORKFLOW_STATUSES, OPS_RESTRICTED_STATUSES,
  RIDER_ASSIGNMENT_FIELD, destinationSkipsTransit, assertRiderOwnsLeg,
  DELIVERY_RIDER_HELD_STATUSES, TERMINAL_STATUSES,
  REASON_REQUIRED_STATUSES, releasesPickupRider,
  POST_PICKUP_STATUSES,
} from "./status-shared";
import { generateUniqueDispatchNo, createRunSheet } from "./orderHelpers";
import type { OrderActor } from "./types";

const MAX_BULK_IDS = 200;

export interface BulkUpdateResult {
  updatedCount: number;
  status: ParcelStatus;
  dispatch?: {
    id: string;
    dispatchNo: string;
    toLocationId: string;
  };
  // Parcels in the request that were already at `status` and were dropped
  // from the batch as a no-op rather than failing the whole request.
  alreadyUpToDate?: number;
}

/**
 * Bulk status transition for OOV/dispatch operations. Validates every parcel
 * up front, then performs all writes as batched queries inside a single
 * transaction instead of N individual round trips - this is what backs
 * the OOV page's multi-select "Action" bar.
 *
 * When the target status is "dispatched", this also opens a dispatch
 * manifest (dispatches + dispatch_parcels) grouping the selected parcels,
 * and closes it out (dispatches.arrived_at) once every parcel in it has
 * reached "arrived_at_branch".
 */
export async function bulkUpdateParcelStatus(
  actor: OrderActor,
  data: BulkUpdateParcelStatusInput,
): Promise<BulkUpdateResult> {
  const ids = Array.from(new Set(data.ids));
  if (ids.length === 0) {
    throw new AppError(400, "No parcel ids provided");
  }
  if (ids.length > MAX_BULK_IDS) {
    throw new AppError(400, `Cannot update more than ${MAX_BULK_IDS} parcels at once`);
  }

  return withParcelStatusLocks(ids, async () => {
    // A manifest scan already carries its own id, and a dispatch to a named
    // destination already opens a dispatches row - its number and driver are
    // what the timeline records. Only the transition that ends up with no
    // hand-over document at all gets one opened for it (see
    // resolveAutoTransitManifests).
    //
    // riderId without toLocationId is rejected downstream as a dispatch with
    // no destination; it's checked here too so an invalid request throws
    // before a manifest gets opened for it rather than after.
    if (
      data.status !== "dispatched" ||
      data.transitManifestId ||
      data.toLocationId ||
      data.riderId
    ) {
      return _bulkUpdateParcelStatusImpl(actor, ids, data);
    }

    const groups = await resolveAutoTransitManifests(actor, ids);
    if (groups.length === 0) return _bulkUpdateParcelStatusImpl(actor, ids, data);

    // One call per manifest, mirroring addParcelsToTransitManifest: each
    // group's parcels move under their own manifest id, so the timeline
    // remark, the membership links and the open → dispatched flip all land on
    // the right manifest. Anything no route could be resolved for - and
    // anything already past oov - dispatches on the plain path as before.
    const claimed = new Set(groups.flatMap((group) => group.parcelIds));
    const unclaimed = ids.filter((id) => !claimed.has(id));

    const results: BulkUpdateResult[] = [];
    for (const group of groups) {
      results.push(
        await _bulkUpdateParcelStatusImpl(actor, group.parcelIds, {
          ...data,
          transitManifestId: group.manifestId,
        }),
      );
    }
    if (unclaimed.length) {
      results.push(await _bulkUpdateParcelStatusImpl(actor, unclaimed, data));
    }

    const alreadyUpToDate = results.reduce((sum, r) => sum + (r.alreadyUpToDate ?? 0), 0);
    const dispatch = results.find((r) => r.dispatch)?.dispatch;
    return {
      updatedCount: results.reduce((sum, r) => sum + r.updatedCount, 0),
      status: data.status,
      ...(dispatch ? { dispatch } : {}),
      ...(alreadyUpToDate > 0 ? { alreadyUpToDate } : {}),
    };
  });
}

type HubRef = { id: string; name: string };

async function generateUniqueTransitManifestNo(retries = 0): Promise<string> {
  const manifestNo = generateTransitManifestNo();
  const clash = await prisma.transit_manifests.findUnique({
    where: { manifest_no: manifestNo },
    select: { id: true },
  });
  if (!clash) return manifestNo;
  if (retries >= 5) throw new AppError(500, "Failed to generate unique transit manifest number");
  return generateUniqueTransitManifestNo(retries + 1);
}

async function openOrReuseTransitManifest(
  actor: OrderActor,
  from: HubRef,
  to: HubRef,
  parcelIds: string[],
): Promise<string> {
  // Reuse an open manifest for this route only when nothing else is staged on
  // it. One that someone is still scanning parcels onto belongs to that shift:
  // dispatching it from here would flip it to 'dispatched' with its other
  // members still sitting at oov, stranding them as ghosts that its own
  // receive scan would then reject.
  const existing = await prisma.transit_manifests.findFirst({
    where: {
      status: "open",
      from_location_id: from.id,
      to_location_id: to.id,
      transit_manifest_parcels: {
        none: { parcel_id: { notIn: parcelIds }, parcels: { status: "oov" } },
      },
    },
    orderBy: { created_at: "desc" },
    select: { id: true, _count: { select: { transit_manifest_parcels: true } } },
  });
  if (existing && existing._count.transit_manifest_parcels + parcelIds.length <= MAX_TRANSIT_MANIFEST_PARCELS) {
    return existing.id;
  }

  const created = await prisma.transit_manifests.create({
    data: {
      manifest_no: await generateUniqueTransitManifestNo(),
      status: "open",
      from_location_id: from.id,
      to_location_id: to.id,
      from_hub: from.name,
      to_hub: to.name,
      created_by: actor.id,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Opens the transit manifest that a Transit → dispatched move outside the
 * scanning flow would otherwise never get.
 *
 * Dispatching from Transit Operations with "Via Manifest" selected - and every
 * other route into the transition that names no destination: a QuickActions
 * change, an order-detail force, the Partner API - took the plain status path,
 * so the parcels went on the road belonging to no manifest at all and nothing
 * recorded which truck carried them. The manifest tabs only ever showed
 * hand-overs that happened to be built by scanning.
 *
 * So the transition opens one itself. Parcels group by route (their current
 * location → the destination hub, resolved through a covered area's parent),
 * an open manifest for that route is reused when one is free and a fresh one
 * created when there isn't, and members are linked before the status moves -
 * the same order addParcelsToTransitManifest uses, so a crash between the two
 * leaves a retryable member rather than a dispatched parcel no manifest claims.
 */
async function resolveAutoTransitManifests(
  actor: OrderActor,
  ids: string[],
): Promise<{ manifestId: string; parcelIds: string[] }[]> {
  const parcels = await prisma.parcels.findMany({
    where: { id: { in: ids }, deleted_at: null, status: "oov" },
    select: { id: true, current_location_id: true, destination_location_id: true },
  });
  if (parcels.length === 0) return [];

  const locationIds = new Set<string>();
  for (const parcel of parcels) {
    if (parcel.current_location_id) locationIds.add(parcel.current_location_id);
    if (parcel.destination_location_id) locationIds.add(parcel.destination_location_id);
  }

  const locations = await prisma.locations.findMany({
    where: { id: { in: [...locationIds] } },
    select: { id: true, name: true, locations: { select: { id: true, name: true } } },
  });
  const self = new Map<string, HubRef>();
  const hub = new Map<string, HubRef>();
  for (const location of locations) {
    self.set(location.id, { id: location.id, name: location.name });
    hub.set(location.id, location.locations ?? { id: location.id, name: location.name });
  }

  // A parcel whose route can't be resolved - no current location, no
  // destination, or a destination hub it already sits at - gets no manifest and
  // still dispatches exactly as it did before.
  const routes = new Map<string, { from: HubRef; to: HubRef; parcelIds: string[] }>();
  for (const parcel of parcels) {
    const from = parcel.current_location_id ? self.get(parcel.current_location_id) : undefined;
    const to = parcel.destination_location_id
      ? hub.get(parcel.destination_location_id)
      : undefined;
    if (!from || !to || from.id === to.id) continue;
    const key = `${from.id}|${to.id}`;
    const route = routes.get(key);
    if (route) route.parcelIds.push(parcel.id);
    else routes.set(key, { from, to, parcelIds: [parcel.id] });
  }

  const groups: { manifestId: string; parcelIds: string[] }[] = [];
  for (const { from, to, parcelIds } of routes.values()) {
    const manifestId = await openOrReuseTransitManifest(actor, from, to, parcelIds);
    await prisma.transit_manifest_parcels.createMany({
      data: parcelIds.map((parcel_id) => ({ transit_manifest_id: manifestId, parcel_id })),
      skipDuplicates: true,
    });
    await prisma.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "transit_manifest",
        entity_id: manifestId,
        action: "AUTO_OPEN_ON_DISPATCH",
        new_data: { fromHub: from.name, toHub: to.name, parcelIds },
      },
    });
    groups.push({ manifestId, parcelIds });
  }
  return groups;
}

async function _bulkUpdateParcelStatusImpl(
  actor: OrderActor,
  ids: string[],
  data: BulkUpdateParcelStatusInput,
): Promise<BulkUpdateResult> {
  const newStatus = data.status;
  const isAdmin = actor.roles.some((r) => ["super_admin", "admin"].includes(r));
  // A super_admin may force any status from any status (including out of a
  // terminal state) - the transition map only constrains everyone else.
  const isSuperAdmin = actor.roles.includes("super_admin");
  const isVendorActor =
    actor.roles.includes("vendor") || actor.roles.includes("vendor_staff");
  const isRiderActor = actor.roles.includes("rider") && !isAdmin;

  // Hub operations (dispatch, OOV transitions) are admin-only.
  if (HUB_OPERATION_STATUSES.includes(newStatus as parcel_status) && !isAdmin) {
    throw new AppError(403, "Only admins can perform dispatch hub operations");
  }
  // The return-to-origin workflow is staff-only.
  if (RETURN_WORKFLOW_STATUSES.includes(newStatus as parcel_status) && !isAdmin) {
    throw new AppError(403, "Only admins can manage the return workflow");
  }
  // Hold / loss & damage are managed from the ops dashboard, not riders/vendors.
  if (OPS_RESTRICTED_STATUSES.includes(newStatus as parcel_status) && !isAdmin) {
    throw new AppError(403, "Only admins can manage hold / loss & damage status");
  }
  // Assigning a rider to a parcel is an admin/vendor operation done via the ops
  // dashboard's rider picker, never a rider self-service action.
  if (RIDER_ASSIGNMENT_FIELD[newStatus as parcel_status] && isRiderActor) {
    throw new AppError(403, "Assigning a rider to a parcel is an admin/vendor operation");
  }
  // Cancellation is allowed for admins and vendors (vendors may only cancel their own orders,
  // enforced by the vendor_id scope below).
  if (newStatus === "cancelled" && !isAdmin && !isVendorActor) {
    throw new AppError(403, "Only vendors or admins can cancel orders");
  }

  // Resolve vendor/rider/sales scope so non-admins can only act on their own
  // parcels. Sales (not currently routed here) are scoped to their vendors as
  // defence in depth via the vendorIds IN filter below.
  const isSalesActor = actor.roles.includes("sales") && !isAdmin;
  const { vendorId, vendorIds, riderId: actorRiderId } =
    isVendorActor || isRiderActor || isSalesActor
      ? await getActorScope(actor)
      : { vendorId: undefined, vendorIds: undefined, riderId: undefined };

  if (isRiderActor && !actorRiderId) {
    throw new AppError(403, "Rider profile not found or inactive");
  }

  // A branch-scoped admin (see getAdminBranchScope) - checked unconditionally
  // rather than gated on isVendorActor/isRiderActor/isSalesActor above, since
  // it applies specifically to an admin actor those never match.
  const adminBranchIds = await getAdminBranchScope(actor);

  // loss & damage is a head-office write-off classification - a branch-scoped
  // admin may release a hold back into the active flow but not write it off.
  if (newStatus === "loss_and_damage" && adminBranchIds) {
    throw new AppError(403, "Only head office can mark loss & damage");
  }

  let parcels = await prisma.parcels.findMany({
    where: {
      id: { in: ids },
      deleted_at: null,
      ...(vendorId ? { vendor_id: vendorId } : {}),
      ...(vendorIds ? { vendor_id: { in: vendorIds } } : {}),
      ...(adminBranchIds ? branchTouchesFilter(adminBranchIds) : {}),
    },
    include: { pickup_tasks: true, locations_parcels_destination_location_idTolocations: true, vendors: true },
  });

  if (parcels.length !== ids.length) {
    throw new AppError(404, "One or more parcels were not found or do not belong to your account");
  }

  // Idempotent no-op: a parcel already at the target status isn't a
  // transition at all - STATUS_TRANSITIONS uniformly disallows self-
  // transitions - so it can only mean the parcel got here between the client
  // rendering this batch and this request landing (another actor's request,
  // a reconcile sweep, or the caller's own resubmitted scan). Drop it from
  // the batch instead of 422ing the whole thing on 'X → X', same as if it
  // had never been selected. Terminal statuses are excluded from this skip -
  // those fall through to the terminal-state check below, unchanged, same as
  // the single-parcel path.
  const isNoOp = (p: (typeof parcels)[number]) =>
    p.status === newStatus && !TERMINAL_STATUSES.includes(p.status as parcel_status);
  let alreadyDoneCount = parcels.filter(isNoOp).length;
  parcels = parcels.filter((p) => !isNoOp(p));
  let idsToUpdate = parcels.map((p) => p.id);

  if (parcels.length === 0) {
    return { updatedCount: 0, status: newStatus, alreadyUpToDate: alreadyDoneCount };
  }

  for (const parcel of parcels) {
    const currentStatus = parcel.status as ParcelStatus;
    if (!isSuperAdmin && TERMINAL_STATUSES.includes(currentStatus as parcel_status)) {
      throw new AppError(
        409,
        `Parcel ${parcel.tracking_id} is already '${currentStatus}' (terminal state)`,
      );
    }
    if (!isSuperAdmin) {
      const allowed = STATUS_TRANSITIONS[
        currentStatus as keyof typeof STATUS_TRANSITIONS
      ] as readonly ParcelStatus[];
      if (!allowed || !allowed.includes(newStatus)) {
        throw new AppError(
          422,
          `Invalid status transition for ${parcel.tracking_id}: '${currentStatus}' → '${newStatus}'`,
        );
      }

      // From "arrived", destination decides whether the parcel skips Transit
      // (inside valley + fringe areas) or must go through it (everywhere else).
      if (currentStatus === "arrived" && (newStatus === "ready_to_deliver" || newStatus === "oov")) {
        const skipsTransit = destinationSkipsTransit(parcel.locations_parcels_destination_location_idTolocations);
        if (skipsTransit && newStatus === "oov") {
          throw new AppError(422, `Parcel ${parcel.tracking_id}: destination is inside the valley, must go to 'Ready to Deliver', not 'Transit'.`);
        }
        if (!skipsTransit && newStatus === "ready_to_deliver") {
          throw new AppError(422, `Parcel ${parcel.tracking_id}: destination is outside the valley, must go to 'Transit' first.`);
        }
      }
    }
    // Riders may only progress parcels they're actually assigned to, and only
    // for the leg (pickup vs delivery) they were assigned for.
    if (isRiderActor && actorRiderId) {
      assertRiderOwnsLeg(currentStatus as parcel_status, parcel, actorRiderId);
    }
  }

  // Parcels in this batch leaving a delivery state for something else.
  // newStatus is shared across the whole batch, so this is just a filter over
  // each parcel's current status. Split exactly as in the single-parcel path:
  // leaving the delivery leg releases the rider, but only retracting a
  // COMPLETED delivery reverses the money - a partial's collected cash is real
  // and survives the move to follow_up/ready_to_return.
  const leavingDeliveryIds = parcels
    .filter(
      (p) =>
        DELIVERY_RIDER_HELD_STATUSES.includes(p.status as parcel_status) &&
        !DELIVERY_RIDER_HELD_STATUSES.includes(newStatus as parcel_status),
    )
    .map((p) => p.id);
  const reversalParcels = parcels.filter(
    (p) => p.status === "delivered" && !["delivered", "partially_delivered"].includes(newStatus),
  );
  const undeliverIds = reversalParcels.map((p) => p.id);

  // Same guard as the single-parcel path: don't blow away a COD that's
  // already been swept into a settlement - paid, or still pending (whose
  // settlement_items row already froze this collection's amount).
  if (undeliverIds.length > 0) {
    const blockingCod = await prisma.cod_collections.findFirst({
      where: {
        parcel_id: { in: undeliverIds },
        OR: [{ rider_payment_status: "paid" }, { payment_status: "paid" }, { settlement_items: { some: {} } }],
      },
      include: {
        parcels: { select: { tracking_id: true } },
        settlement_items: { select: { settlements: { select: { statement_id: true, payee_type: true } } }, take: 1 },
      },
    });
    if (blockingCod) {
      const stmt = blockingCod.settlement_items[0]?.settlements;
      const reason = stmt ? `is part of ${stmt.payee_type} settlement ${stmt.statement_id}` : "has already been settled";
      throw new AppError(409, `Order ${blockingCod.parcels.tracking_id}'s COD ${reason} — resolve that before undelivering.`);
    }
  }

  let toLocationId: string | null = null;
  let originLocationId: string | null = null;
  let riderId: string | null = null;
  let riderName: string | null = null;

  if (newStatus === "dispatched") {
    // A manifest only exists when there's a destination to carry it to, so a
    // rider named without one would be validated and then silently dropped
    // along with the whole dispatch record. The ops UI already blocks this;
    // this stops the API doing it quietly.
    if (data.riderId && !data.toLocationId) {
      throw new AppError(422, "A destination hub is required to dispatch a manifest to a rider");
    }
    if (data.toLocationId) {
      const distinctOrigins = new Set(parcels.map((p) => p.current_location_id || ""));
      if (distinctOrigins.size !== 1 || distinctOrigins.has("")) {
        throw new AppError(
          422,
          "All selected parcels must share the same current location to be dispatched together",
        );
      }
      originLocationId = parcels[0]!.current_location_id;

      if (originLocationId === data.toLocationId) {
        throw new AppError(422, "Destination hub must differ from the current location");
      }

      const destination = await prisma.locations.findUnique({ where: { id: data.toLocationId } });
      if (!destination || !destination.is_active) {
        throw new AppError(400, "Destination location not found or inactive");
      }
      toLocationId = destination.id;

      if (data.riderId) {
        const rider = await prisma.riders.findFirst({
          where: { id: data.riderId, deleted_at: null, status: "active" },
        });
        if (!rider) {
          throw new AppError(400, "Rider not found or inactive");
        }
        riderId = rider.id;
        riderName = rider.name;
      }
    }
  }

  if (data.toLocationId && newStatus !== "dispatched") {
    const loc = await prisma.locations.findUnique({ where: { id: data.toLocationId } });
    if (!loc || !loc.is_active) {
      throw new AppError(400, "Location not found or inactive");
    }
  }

  // rider_assigned needs a pickup rider, sent_for_delivery needs a delivery rider
  // (rider actors are already rejected above, before reaching this point)
  const riderAssignmentField = RIDER_ASSIGNMENT_FIELD[newStatus as parcel_status];
  let parcelRiderId: string | null = null;
  if (riderAssignmentField) {
    if (!data.riderId) {
      throw new AppError(400, `riderId is required to transition to '${newStatus}'`);
    }
    const rider = await resolveActiveRider(data.riderId);
    parcelRiderId = rider.id;
  }

  // Validate partially_delivered requirements
  if (newStatus === "partially_delivered") {
    if (!data.remarks || data.remarks.trim().length === 0) {
      throw new AppError(400, "Remarks are required when status is partially_delivered");
    }
    if (data.codCollected === undefined || data.codCollected < 0) {
      throw new AppError(400, "COD collected is required and must be non-negative when status is partially_delivered");
    }
    // Validate codCollected doesn't exceed any parcel's total COD
    for (const parcel of parcels) {
      const totalCod = Number(parcel.cod_amount);
      if (data.codCollected > totalCod) {
        throw new AppError(400, `COD collected (${data.codCollected}) cannot exceed parcel ${parcel.tracking_id}'s total COD (${totalCod})`);
      }
    }
  }

  // Cancelling or failing an order requires a reason.
  if (REASON_REQUIRED_STATUSES.includes(newStatus as parcel_status)) {
    if (!data.remarks || data.remarks.trim().length === 0) {
      throw new AppError(400, "Remarks are required to cancel or fail an order");
    }
  }

  // Same re-pricing as the single-parcel path: a plain RTO bills the
  // discounted return-percent charge, not the full outbound delivery_charge.
  // Per-parcel (destination/weight/vendor can all differ within one batch),
  // so this can't be a single query - run in parallel since these are
  // independent reads done before the transaction starts.
  const rtoReturnCharges = new Map<string, number>();
  if (newStatus === "returned_to_vendor") {
    await Promise.all(
      parcels
        .filter((p) => p.order_type !== "return" && p.destination_location_id)
        .map(async (p) => {
          const charge = await computeReturnCharge(
            p.vendors,
            p.destination_location_id!,
            p.weight_kg === null ? null : Number(p.weight_kg),
            p.service_type,
            p.origin_location_id,
          );
          if (charge !== null) rtoReturnCharges.set(p.id, charge);
        }),
    );
  }

  // The return manifest driving this transition, if any. Read before the
  // transaction purely for its number, which goes onto every member parcel's
  // timeline - the manifest row itself is updated inside, next to the dispatch.
  const returnManifest = data.returnManifestId
    ? await prisma.return_manifests.findUnique({
        where: { id: data.returnManifestId },
        select: { id: true, manifest_no: true },
      })
    : null;

  // The transit manifest driving this transition, if any. Same shape as the
  // return manifest above: read before the transaction for its number (which
  // goes onto every member parcel's timeline), row updated inside.
  const transitManifest = data.transitManifestId
    ? await prisma.transit_manifests.findUnique({
        where: { id: data.transitManifestId },
        select: { id: true, manifest_no: true },
      })
    : null;

  const result = await prisma.$transaction(async (tx) => {
    // Everything above — the transition check, the no-op filter — ran against
    // a read taken before this transaction opened. Two requests carrying the
    // same parcel both passed it, so without a lock both write a history row
    // and one order goes to dispatched twice at the same moment. Lock the rows
    // and re-read, in id order so two batches that overlap can't deadlock.
    const locked = await tx.$queryRaw<Array<{ id: string; status: parcel_status }>>(Prisma.sql`
      SELECT id, status FROM parcels
      WHERE id = ANY(ARRAY[${Prisma.join(idsToUpdate)}]::uuid[])
      ORDER BY id
      FOR UPDATE
    `);
    const lockedStatus = new Map(locked.map((row) => [row.id, row.status]));

    // Whoever held the lock first already moved these. Drop them the same way
    // the pre-transaction no-op filter would have, rather than failing a batch
    // where every other parcel is still fine.
    // Only act on a row the lock actually returned: a live parcel always comes
    // back, so a missing id means the row is gone, not that it moved.
    const raced = parcels.filter((p) => {
      const current = lockedStatus.get(p.id);
      return current !== undefined && current !== p.status;
    });
    if (raced.length > 0) {
      const racedIds = new Set(raced.map((p) => p.id));
      parcels = parcels.filter((p) => !racedIds.has(p.id));
      idsToUpdate = parcels.map((p) => p.id);
      alreadyDoneCount += raced.length;
      if (parcels.length === 0) {
        return { updatedCount: 0, status: newStatus, alreadyUpToDate: alreadyDoneCount };
      }
    }

    let dispatch: { id: string; dispatch_no: string } | null = null;

    if (newStatus === "dispatched" && toLocationId && originLocationId) {
      const dispatchNo = await generateUniqueDispatchNo(tx);
      dispatch = await tx.dispatches.create({
        data: {
          dispatch_no: dispatchNo,
          from_location_id: originLocationId,
          to_location_id: toLocationId,
          delivery_rider_id: riderId,
          dispatched_by: actor.id,
        },
      });
      await tx.dispatch_parcels.createMany({
        data: parcels.map((p) => ({ dispatch_id: dispatch!.id, parcel_id: p.id })),
      });
    }

    // The manifest number and its driver are otherwise write-only: nothing in
    // the app has ever read dispatches.delivery_rider_id back, so ops picked a
    // "Rider / vehicle" and the choice vanished. Folding it into the status
    // history puts it on the order timeline, where ops already looks when a
    // parcel goes missing in transit - and it needs no new endpoint or screen.
    //
    // Deliberately the timeline and not the rider app: a transfer driver is
    // not the last-mile rider, holds no COD, and must not appear in anyone's
    // custody list. This records who drove it, nothing more.
    const dispatchRemark = dispatch
      ? `Manifest ${dispatch.dispatch_no}${riderName ? ` · carried by ${riderName}` : ""}`
      : null;

    // Same reasoning for the return leg: the manifest number is the only handle
    // anyone has on "which hand-over did this parcel go back on", so it belongs
    // on the timeline rather than only in the manifests list. Composed the same
    // way and folded into the same remarks field below.
    // Same reasoning for the transit leg: the manifest number is the only
    // handle anyone has on "which truck did this parcel leave on", so it
    // belongs on the timeline rather than only in the manifests list.
    // Composed the same way and folded into the same remarks field below.
    const transitRemark = transitManifest
      ? `Transit manifest ${transitManifest.manifest_no}`
      : null;

    const batchRemark = returnManifest
      ? `Manifest ${returnManifest.manifest_no}${riderName ? ` · carried by ${riderName}` : ""}`
      : transitRemark ?? dispatchRemark;

    const updateData: Prisma.parcelsUpdateInput = { status: newStatus as parcel_status };
    if (newStatus === "picked_up") {
      (updateData as any).picked_up_at = new Date();
    }
    if (newStatus === "delivered") {
      (updateData as any).delivered_at = new Date();
    }
    if (newStatus === "partially_delivered") {
      (updateData as any).delivered_at = new Date();
      (updateData as any).partial_delivery_remarks = data.remarks || null;
      (updateData as any).partial_cod_collected = data.codCollected ?? 0;
    }
    if (toLocationId) {
      (updateData as any).current_location_id = toLocationId;
    } else if (data.toLocationId) {
      (updateData as any).current_location_id = data.toLocationId;
    }
    if (riderAssignmentField && parcelRiderId) {
      (updateData as any)[riderAssignmentField] = parcelRiderId;
    }
    // Side-effect: every parcel in the batch is going back into the unassigned
    // pickup pool, so none of them keeps its old rider (see
    // releasesPickupRider). Unlike the delivery release below this needs no
    // per-parcel subset and no anti-clobber guard: the destination status is
    // the same for the whole batch, and pickup_ordered is not in
    // RIDER_ASSIGNMENT_FIELD, so nothing here is assigning a pickup rider.
    if (releasesPickupRider(newStatus as parcel_status)) {
      (updateData as any).pickup_rider_id = null;
    }
    // Each hand-off to a delivery rider counts as one delivery attempt.
    if (newStatus === "sent_for_delivery") {
      (updateData as any).attempt_count = { increment: 1 };
    }

    // A batch hand-off to a delivery rider opens one run sheet for the batch.
    if (newStatus === "sent_for_delivery" && parcelRiderId) {
      await createRunSheet(tx, parcelRiderId, idsToUpdate, actor.id);
    }

    await tx.parcels.updateMany({
      where: { id: { in: idsToUpdate } },
      data: updateData,
    });

    // Skip path, batch flavour: updateData above only stamps picked_up_at on
    // the real pickup transition, but a super_admin can force a batch straight
    // past it. Scoped to picked_up_at: null so it can never overwrite a genuine
    // pickup time - which also makes it a no-op on the normal flow. Separate
    // from the updateMany above because that single blob applies to the whole
    // batch, while this must skip the parcels that already carry a timestamp.
    //
    // idsToUpdate, not ids: the no-op filter above drops parcels already at
    // newStatus from the batch, and those are precisely the ones nothing is
    // happening to - stamping them would invent a pickup time for a parcel
    // this request never touched.
    if (newStatus !== "picked_up" && POST_PICKUP_STATUSES.includes(newStatus as parcel_status)) {
      await tx.parcels.updateMany({
        where: { id: { in: idsToUpdate }, picked_up_at: null },
        data: { picked_up_at: new Date() },
      });
    }

    // Side-effect: release the delivery rider on every parcel coming off the
    // delivery leg, plus every parcel whose delivery is being retracted - the
    // reversal nulls cod_collections.rider_id, so the parcel must not keep
    // pointing at a rider the money no longer does (delivered →
    // returned_to_vendor is not "leaving", since both are held). Mirrors the
    // single-parcel path. Scoped, not applied to `ids`, since not every parcel
    // in a mixed batch is necessarily leaving the delivery leg.
    //
    // Skipped when this same transition is assigning a delivery rider (a
    // super_admin forcing delivered → sent_for_delivery/sent_to_vendor):
    // unlike the single-parcel path, this runs AFTER updateData is applied, so
    // releasing here would clobber the assignment instead of losing to it.
    // Now that sent_to_vendor is itself held, only the undeliverIds half can
    // still collide - leavingDeliveryIds is empty whenever the new status
    // assigns a delivery rider - but the guard covers both and stays as is.
    const releaseRiderIds = Array.from(new Set([...leavingDeliveryIds, ...undeliverIds]));
    if (releaseRiderIds.length > 0 && !(riderAssignmentField === "delivery_rider_id" && parcelRiderId)) {
      await tx.parcels.updateMany({
        where: { id: { in: releaseRiderIds } },
        data: { delivery_rider_id: null },
      });
    }

    // Side-effect: retract the delivery itself, for the subset whose delivery
    // was completed (not partial) - the money reversal, mirroring the
    // single-parcel path.
    if (undeliverIds.length > 0) {
      await tx.parcels.updateMany({
        where: { id: { in: undeliverIds } },
        data: {
          delivered_at: null,
          partial_delivery_remarks: null,
          partial_cod_collected: null,
        },
      });
      await tx.cod_collections.updateMany({
        where: { parcel_id: { in: undeliverIds } },
        data: { collected_amount: 0, collected_at: null, rider_id: null },
      });
    }

    // Tag the COD record with whichever rider is now responsible for
    // collecting it, so rider-scoped COD/finance queries can find it -
    // nothing else in the app ever sets cod_collections.rider_id otherwise.
    if (riderAssignmentField === "delivery_rider_id" && parcelRiderId) {
      await tx.cod_collections.updateMany({
        where: { parcel_id: { in: idsToUpdate } },
        data: { rider_id: parcelRiderId },
      });
    }

    // Side-effect: record what was actually collected on delivery, so the COD
    // settlement ledger (cod_collections) reflects real cash in hand instead
    // of staying at its order-creation defaults forever. Not gated on a
    // delivery rider being on record - see the single-parcel path above.
    // Amounts can differ per parcel (full cod_amount vs the shared partial
    // codCollected), so this can't be a single updateMany.
    if (newStatus === "delivered" || newStatus === "partially_delivered") {
      const collectedAt = new Date();
      // Sequential, not Promise.all: tx is bound to a single Postgres
      // connection, so "concurrent" queries against it just pipeline on that
      // one client rather than running in parallel - pg itself now warns on
      // this ("client.query() called while already executing a query",
      // removed in pg@9). Awaiting one at a time is the same wall-clock cost
      // and avoids relying on deprecated client-side query queueing.
      for (const p of parcels) {
        const collectedAmount = newStatus === "delivered" ? Number(p.cod_amount) : (data.codCollected ?? 0);
        // No collectedAmount <= 0 skip here: a COD corrected down to 0 (or a
        // genuine zero-cash partial delivery) must still overwrite whatever
        // stale amount is sitting on the row - see the single-parcel path above.
        await tx.cod_collections.upsert({
          where: { parcel_id: p.id },
          create: {
            parcel_id: p.id,
            vendor_id: p.vendor_id,
            rider_id: p.delivery_rider_id,
            cod_amount: p.cod_amount,
            collected_amount: collectedAmount,
            collected_at: collectedAt,
          },
          update: {
            rider_id: p.delivery_rider_id,
            cod_amount: p.cod_amount,
            collected_amount: collectedAmount,
            collected_at: collectedAt,
          },
        });
      }
    }

    // Same rule as the single-parcel path: any parcel reaching the vendor -
    // genuine return leg or plain RTO alike - gets collected_at stamped so it
    // enters the settlement ledger and earns its delivery_charge (see
    // billing.service.ts's EARNED_CHARGE_SQL).
    if (newStatus === "returned_to_vendor") {
      await tx.cod_collections.updateMany({
        where: { parcel_id: { in: parcels.map((p) => p.id) } },
        data: { collected_at: new Date() },
      });
      // Re-price each plain RTO to its discounted return-percent charge
      // (computed above, before the transaction). Per-parcel amounts, so
      // this can't be a single updateMany - same reasoning as the
      // collected_amount loop above.
      for (const [parcelId, charge] of rtoReturnCharges) {
        await tx.parcels.update({ where: { id: parcelId }, data: { delivery_charge: charge } });
      }
    }

    const pickupSyncIds = parcels
      .filter((p) => p.pickup_tasks && ["pickup_ordered", "rider_assigned", "picked_up", "cancelled"].includes(newStatus))
      .map((p) => p.id);
    if (pickupSyncIds.length) {
      await tx.pickup_tasks.updateMany({
        where: { parcel_id: { in: pickupSyncIds } },
        data: { status: newStatus as parcel_status },
      });
    }

    await tx.parcel_status_history.createMany({
      data: parcels.map((p) => ({
        parcel_id: p.id,
        old_status: p.status,
        new_status: newStatus as parcel_status,
        location_id: toLocationId || data.toLocationId || p.current_location_id,
        changed_by: actor.id,
        remarks: batchRemark
          ? [batchRemark, data.remarks?.trim()].filter(Boolean).join(" — ")
          : data.remarks || null,
      })),
    });
    // See the single-update path for why this also needs to land in
    // parcel_remarks, not just parcel_status_history.
    if (data.remarks && data.remarks.trim().length > 0) {
      await tx.parcel_remarks.createMany({
        data: parcels.map((p) => ({
          parcel_id: p.id,
          user_id: actor.id,
          location_id: toLocationId || data.toLocationId || p.current_location_id,
          remark: `Marked ${(newStatus as string).replace(/_/g, " ")}: ${data.remarks!.trim()}`,
        })),
      });
    }

    await tx.audit_logs.createMany({
      data: parcels.map((p) => ({
        actor_id: actor.id,
        entity_type: "parcel",
        entity_id: p.id,
        action: "BULK_UPDATE_STATUS",
        old_data: { status: p.status },
        new_data: { status: newStatus, dispatchId: dispatch?.id || null, transitManifestId: data.transitManifestId || null },
      })),
    });

    // One webhook event per parcel — each has its own tracking ID even though
    // newStatus is shared across the whole batch. Batched into a single
    // endpoint lookup + single createMany instead of one round trip per
    // parcel (see emitWebhookEventsBatch).
    const changedAt = new Date().toISOString();
    await emitWebhookEventsBatch(
      tx,
      "order.status_changed",
      parcels
        .filter((p) => p.vendor_id)
        .map((p) => ({
          vendorId: p.vendor_id!,
          data: {
            trackingId: p.tracking_id,
            orderId: p.id,
            vendorId: p.vendor_id,
            oldStatus: p.status,
            newStatus,
            changedAt,
          },
        })),
    );

    // Close out manifests once none of their parcels are still "dispatched" -
    // one groupBy instead of a per-dispatch count()+updateMany() loop, since
    // the loop was issuing N sequential round trips while holding transaction locks.
    if (newStatus === "arrived_at_branch") {
      const links = await tx.dispatch_parcels.findMany({
        where: { parcel_id: { in: idsToUpdate } },
        select: { dispatch_id: true },
        distinct: ["dispatch_id"],
      });

      if (links.length) {
        const dispatchIds = links.map((link) => link.dispatch_id);
        const stillInTransit = await tx.dispatch_parcels.groupBy({
          by: ["dispatch_id"],
          where: { dispatch_id: { in: dispatchIds }, parcels: { status: "dispatched" } },
        });
        const inTransitIds = new Set(stillInTransit.map((row) => row.dispatch_id));
        const completedDispatchIds = dispatchIds.filter((id) => !inTransitIds.has(id));

        if (completedDispatchIds.length) {
          await tx.dispatches.updateMany({
            where: { id: { in: completedDispatchIds }, arrived_at: null },
            data: { arrived_at: new Date() },
          });
        }
      }
    }

    // The return manifest moves with its parcels, in this same transaction -
    // the same rule the dispatch manifest and the run sheet already follow.
    // Doing it as a second call after bulkUpdateParcelStatus returned would
    // leave a window where the parcels are sent_to_vendor but the manifest
    // still reads 'open', and the retry would then fail the transition check
    // with no way back short of SQL.
    if (returnManifest && newStatus === "sent_to_vendor") {
      await tx.return_manifests.update({
        where: { id: returnManifest.id },
        data: {
          status: "sent",
          rider_id: parcelRiderId,
          sent_at: new Date(),
          sent_by: actor.id,
        },
      });
    }
    if (returnManifest && newStatus === "returned_to_vendor") {
      await tx.return_manifests.update({
        where: { id: returnManifest.id },
        data: { status: "received", received_at: new Date(), received_by: actor.id },
      });
    }

    // The transit manifest moves with its parcels, in this same transaction,
    // for the same reason as the return manifest above. The first dispatch
    // takes an 'open' manifest to 'dispatched' (updateMany so repeat scans
    // onto an already-dispatched manifest don't re-stamp dispatched_at);
    // a receive takes it to 'received' once no member is still 'dispatched'.
    if (transitManifest && newStatus === "dispatched") {
      await tx.transit_manifests.updateMany({
        where: { id: transitManifest.id, status: "open" },
        data: { status: "dispatched", dispatched_at: new Date(), dispatched_by: actor.id },
      });
    }
    if (transitManifest && newStatus === "arrived_at_branch") {
      const stillDispatched = await tx.transit_manifest_parcels.count({
        where: {
          transit_manifest_id: transitManifest.id,
          parcels: { status: "dispatched" },
        },
      });
      if (stillDispatched === 0) {
        await tx.transit_manifests.update({
          where: { id: transitManifest.id },
          data: { status: "received", received_at: new Date(), received_by: actor.id },
        });
      }
    }

    // A parcel leaving ready_to_return by any route other than its own
    // manifest's send is no longer part of that hand-over, so drop it.
    //
    // This is not tidiness. bulkUpdateParcelStatus rejects the *whole* batch if
    // any member has an invalid transition, so a single parcel force-reverted
    // out of ready_to_return (super_admin, order detail, QuickActions) would
    // otherwise sit in the manifest as a ghost member and deadlock every later
    // attempt to send it - and there is no remove action reachable once a
    // manifest has left 'open'. Mirrored in _updateParcelStatusImpl.
    if (newStatus !== "sent_to_vendor") {
      const leavingReturnPool = parcels
        .filter((p) => p.status === "ready_to_return")
        .map((p) => p.id);
      if (leavingReturnPool.length) {
        await tx.return_manifest_parcels.deleteMany({
          where: {
            parcel_id: { in: leavingReturnPool },
            return_manifests: { status: "open" },
          },
        });
      }
    }

    // Same ghost-member rule for the transit leg. A parcel leaving oov by any
    // route other than its own manifest's dispatch (super_admin force, hold)
    // is no longer part of that hand-over, so drop it from open manifests -
    // otherwise it deadlocks later dispatches the same way a return ghost
    // would. Likewise a dispatched member that leaves the transit pool without
    // being received (e.g. dispatched → follow_up for an NCM return) drops
    // off its dispatched manifest. The manifest's own flows are excluded: a
    // dispatch keeps its oov links, a receive keeps its member history.
    if (newStatus !== "dispatched") {
      const leavingTransitPool = parcels
        .filter((p) => p.status === "oov")
        .map((p) => p.id);
      if (leavingTransitPool.length) {
        await tx.transit_manifest_parcels.deleteMany({
          where: {
            parcel_id: { in: leavingTransitPool },
            transit_manifests: { status: "open" },
          },
        });
      }
    }
    if (newStatus !== "arrived_at_branch") {
      const leavingRoadPool = parcels
        .filter((p) => p.status === "dispatched")
        .map((p) => p.id);
      if (leavingRoadPool.length) {
        await tx.transit_manifest_parcels.deleteMany({
          where: {
            parcel_id: { in: leavingRoadPool },
            transit_manifests: { status: "dispatched" },
          },
        });
      }
    }

    return {
      updatedCount: parcels.length,
      status: newStatus,
      ...(dispatch && toLocationId
        ? { dispatch: { id: dispatch.id, dispatchNo: dispatch.dispatch_no, toLocationId } }
        : {}),
      ...(alreadyDoneCount > 0 ? { alreadyUpToDate: alreadyDoneCount } : {}),
    };
  });

  await invalidateOrderCaches();

  // Same finance-cache invalidation as the single-update path (see its note):
  // a reversal rewrites cod_collections, which invalidateOrderCaches does not
  // cover. Deduped so a large batch costs one clear per affected vendor/rider.
  if (reversalParcels.length > 0) {
    const vendorIds = new Set(reversalParcels.map((p) => p.vendor_id).filter((id): id is string => !!id));
    const riderIds = new Set(
      reversalParcels.map((p) => p.delivery_rider_id).filter((id): id is string => !!id),
    );
    for (const id of vendorIds) {
      invalidateVendorFinanceCache(id).catch((err) =>
        console.error("[Redis] cache invalidation failed:", err),
      );
    }
    for (const id of riderIds) {
      invalidateRiderFinanceCache(id).catch((err) =>
        console.error("[Redis] cache invalidation failed:", err),
      );
    }
  }

  // Same balance re-check as the single-update path, deduped by vendor so a
  // 100-parcel batch costs one evaluation per affected vendor, not per parcel.
  if (statusAffectsBalance(newStatus)) {
    evaluateVendorsBillingAsync(parcels.map((p) => p.vendor_id));
  } else {
    evaluateVendorsBillingAsync(
      parcels.filter((p) => statusAffectsBalance(p.status)).map((p) => p.vendor_id),
    );
  }

  // No ledger postings here, and none anywhere else on this path: a parcel is
  // not a money event in the books. Delivering two hundred of them writes no
  // journal entries at all - the statement that settles them does, once. What
  // the vendor is owed in the meantime comes from cod_collections and
  // parcels.delivery_charge, via billing.service, exactly as the balance
  // re-check above uses.

  // Bulk status changes no longer notify vendors or admins (see the single
  // update path) - a batch would otherwise fire a ping per parcel. Failed/
  // cancelled is the one exception (mirrors the single-update path): one
  // notification per affected vendor, not per parcel, so a large batch still
  // can't flood the feed.
  if (REASON_REQUIRED_STATUSES.includes(newStatus as parcel_status)) {
    const vendorIds = [...new Set(parcels.map((p) => p.vendor_id).filter((id): id is string => !!id))];
    if (vendorIds.length > 0) {
      const vendorUsers = await prisma.vendors.findMany({
        where: { id: { in: vendorIds }, user_id: { not: null } },
        select: { id: true, user_id: true },
      });
      const label = (newStatus as string).replace(/_/g, " ");
      for (const vendor of vendorUsers) {
        if (!vendor.user_id || vendor.user_id === actor.id) continue;
        const vendorParcels = parcels.filter((p) => p.vendor_id === vendor.id);
        const single = vendorParcels.length === 1 ? vendorParcels[0] : null;
        createNotification(
          vendor.user_id,
          single ? `Order ${single.tracking_id} marked ${label}` : `${vendorParcels.length} orders marked ${label}`,
          data.remarks || null,
          single?.tracking_id ?? null,
          "status_change",
          single ? `/orders/track/${single.tracking_id}` : "/orders",
        ).catch(() => {});
      }
    }
  }

  return result;
}
