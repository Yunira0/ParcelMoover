// Transit manifests - the hand-over document for the hub-to-hub leg.
//
// The delivery leg has run_sheets and the return leg has return_manifests;
// the transit leg had nothing: parcels moved oov → dispatched →
// arrived_at_branch one selection at a time and no row anywhere said which
// parcels travelled together on one truck.
//
// The shape differs from a return manifest in one way that drives this whole
// file. A return manifest groups one vendor's parcels; a transit manifest
// groups one route's parcels (origin hub → destination hub) across many
// vendors, and fills over a shift. So there is no one-open-per-route rule -
// several open manifests may accumulate for the same route.
//
// Otherwise it follows the return manifest exactly, including the part that
// matters most to an operator: adding a parcel only *stages* it. It stays at
// oov, the manifest stays open, and it can be taken back off - because a
// truck is loaded over a shift and a parcel scanned onto the wrong route has
// to be recoverable. Nothing moves until someone dispatches the manifest,
// which is the moment the truck actually leaves.
//
// What this file deliberately does NOT do is write parcel statuses. Dispatch
// and receive both delegate to bulkUpdateParcelStatus (via transitManifestId),
// which owns the things that make a hand-over correct and are easy to
// forget: the dispatch rows, current_location moves, status history, webhooks
// and cache invalidation. Reimplementing any of that here would be four money
// bugs in a trench coat.
import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { generateTransitManifestNo } from "../utils/transitManifestNo";
import {
  bulkUpdateParcelStatus,
  mapHandoverParcel,
  HANDOVER_PARCEL_INCLUDE,
} from "./order.service";
import { resolveBranchLocationIds } from "./branch.service";
import {
  CreateTransitManifestInput,
  DispatchTransitManifestInput,
  ListTransitManifestsParams,
  LIVE_TRANSIT_MANIFEST_STATUSES,
  MAX_TRANSIT_MANIFEST_PARCELS,
  StageOrdersToBranchInput,
  TransitManifestStatus,
  TransitScanInput,
} from "../types/transitManifest.type";

type Actor = { id: string; roles: string[] };

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;
const MAX_MANIFEST_NO_RETRIES = 5;

/** The only parcel status a transit manifest accepts onto itself. */
const MANIFESTABLE_STATUS = "oov";
/** The only parcel status a manifest receives back from the road. */
const RECEIVABLE_STATUS = "dispatched";

const MANIFEST_INCLUDE = {
  from_location: { select: { id: true, name: true } },
  to_location: { select: { id: true, name: true } },
  created_by_user: { select: { full_name: true } },
  dispatched_by_user: { select: { full_name: true } },
  received_by_user: { select: { full_name: true } },
  _count: { select: { transit_manifest_parcels: true } },
} as const;

type ManifestRow = {
  id: string;
  manifest_no: string;
  status: string;
  from_location_id: string | null;
  to_location_id: string | null;
  from_hub: string;
  to_hub: string;
  created_by: string | null;
  dispatched_by: string | null;
  received_by: string | null;
  dispatched_at: Date | null;
  received_at: Date | null;
  remarks: string | null;
  created_at: Date;
  updated_at: Date;
  from_location?: { id: string; name: string } | null;
  to_location?: { id: string; name: string } | null;
  created_by_user?: { full_name: string } | null;
  dispatched_by_user?: { full_name: string } | null;
  received_by_user?: { full_name: string } | null;
  _count?: { transit_manifest_parcels: number };
};

function mapManifest(row: ManifestRow, parcelIds?: string[]) {
  return {
    id: row.id,
    manifestNo: row.manifest_no,
    status: row.status,
    fromLocationId: row.from_location_id,
    toLocationId: row.to_location_id,
    fromHub: row.from_hub,
    toHub: row.to_hub,
    parcelCount: row._count?.transit_manifest_parcels ?? 0,
    remarks: row.remarks || "",
    createdBy: row.created_by_user?.full_name || "",
    dispatchedBy: row.dispatched_by_user?.full_name || "",
    receivedBy: row.received_by_user?.full_name || "",
    dispatchedAt: row.dispatched_at ? row.dispatched_at.toISOString() : null,
    receivedAt: row.received_at ? row.received_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    // Only populated for live manifests by the list endpoint - see there.
    ...(parcelIds ? { parcelIds } : {}),
  };
}

async function generateUniqueManifestNo(retries = 0): Promise<string> {
  const manifestNo = generateTransitManifestNo();

  const existing = await prisma.transit_manifests.findUnique({
    where: { manifest_no: manifestNo },
    select: { id: true },
  });

  if (!existing) return manifestNo;

  if (retries >= MAX_MANIFEST_NO_RETRIES) {
    throw new AppError(500, "Failed to generate unique transit manifest number");
  }

  return generateUniqueManifestNo(retries + 1);
}

async function loadManifestOrThrow(id: string) {
  const row = await prisma.transit_manifests.findUnique({ where: { id }, include: MANIFEST_INCLUDE });
  if (!row) throw new AppError(404, "Transit manifest not found");
  return row;
}

/**
 * Best-effort location resolution for the hub names the dashboard sends
 * (branch display names, usually the location's own name). A manifest must
 * survive renames and removals, so an unresolvable name stores a null id and
 * the dispatch simply moves statuses without a dispatch row - never a 400.
 */
async function resolveLocationIds(fromHub: string, toHub: string) {
  const locations = await prisma.locations.findMany({
    where: { is_active: true },
    select: { id: true, name: true },
  });
  const match = (hub: string) => {
    const needle = hub.trim().toLowerCase();
    const needleHub = hub.split(" - ")[0]!.trim().toLowerCase();
    return (
      locations.find((l) => l.name === hub) ??
      locations.find((l) => l.name.toLowerCase() === needle) ??
      locations.find((l) => l.name.split(" - ")[0]!.trim().toLowerCase() === needleHub) ??
      null
    );
  };
  return {
    fromLocationId: match(fromHub)?.id ?? null,
    toLocationId: match(toHub)?.id ?? null,
  };
}

export async function listTransitManifests(_actor: Actor, params: ListTransitManifestsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));

  const where: Record<string, unknown> = {};
  if (params.status) where.status = params.status;

  if (params.search?.trim()) {
    const search = params.search.trim();
    where.OR = [
      { manifest_no: { contains: search, mode: "insensitive" } },
      { from_hub: { contains: search, mode: "insensitive" } },
      { to_hub: { contains: search, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.transit_manifests.findMany({
      where,
      include: MANIFEST_INCLUDE,
      orderBy: { created_at: params.sortDir === "asc" ? "asc" : "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.transit_manifests.count({ where }),
  ]);

  // Membership ids for the live manifests only, so Transit Operations can tell
  // which parcels are already staged on a hand-over without opening each one.
  // A received manifest's membership is closed history, and those are the rows
  // that accumulate forever.
  const liveIds = rows
    .filter((row) => LIVE_TRANSIT_MANIFEST_STATUSES.includes(row.status as TransitManifestStatus))
    .map((row) => row.id);

  const membership = new Map<string, string[]>();
  if (liveIds.length) {
    const links = await prisma.transit_manifest_parcels.findMany({
      where: { transit_manifest_id: { in: liveIds } },
      select: { transit_manifest_id: true, parcel_id: true },
    });
    for (const link of links) {
      const list = membership.get(link.transit_manifest_id);
      if (list) list.push(link.parcel_id);
      else membership.set(link.transit_manifest_id, [link.parcel_id]);
    }
  }

  return {
    data: rows.map((row) =>
      mapManifest(row, liveIds.includes(row.id) ? membership.get(row.id) ?? [] : undefined),
    ),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function getTransitManifestById(_actor: Actor, id: string) {
  const row = await loadManifestOrThrow(id);

  const links = await prisma.transit_manifest_parcels.findMany({
    where: { transit_manifest_id: id },
    include: { parcels: { include: HANDOVER_PARCEL_INCLUDE } },
    orderBy: { created_at: "asc" },
  });

  const parcels = links.map((link) => mapHandoverParcel(link.parcels));

  return {
    ...mapManifest(row, links.map((link) => link.parcel_id)),
    parcels,
    totalCod: parcels.reduce((sum, p) => sum + p.codAmount, 0),
  };
}

export async function createTransitManifest(actor: Actor, input: CreateTransitManifestInput) {
  const fromHub = input.fromHub.trim();
  const toHub = input.toHub.trim();
  if (!fromHub || !toHub) throw new AppError(400, "Pick both an origin and a destination branch");
  if (fromHub === toHub) throw new AppError(400, "Origin and destination must be different");

  const { fromLocationId, toLocationId } = await resolveLocationIds(fromHub, toHub);

  const created = await prisma.transit_manifests.create({
    data: {
      manifest_no: await generateUniqueManifestNo(),
      status: "open",
      from_location_id: fromLocationId,
      to_location_id: toLocationId,
      from_hub: fromHub,
      to_hub: toHub,
      remarks: input.remarks?.trim() || null,
      created_by: actor.id,
    },
    include: MANIFEST_INCLUDE,
  });
  return mapManifest(created);
}

type ScannedParcel = {
  id: string;
  tracking_id: string;
  status: string;
  current_location_id: string | null;
  destination_location_id: string | null;
};

/**
 * Scans arrive as tracking ids off a barcode scanner. Normalised to trimmed,
 * deduped strings; parcels are matched case-insensitively so a scanner that
 * lowercases its output still resolves.
 */
function normaliseTrackingIds(trackingIds: string[]) {
  return Array.from(new Set(trackingIds.map((t) => t.trim()).filter(Boolean)));
}

async function findParcelsByTrackingIds(ids: string[]) {
  const byTracking = new Map<string, ScannedParcel>();
  if (ids.length === 0) return byTracking;

  const rows = await prisma.parcels.findMany({
    where: { tracking_id: { in: ids }, deleted_at: null },
    select: { id: true, tracking_id: true, status: true, current_location_id: true, destination_location_id: true },
  });
  for (const row of rows) byTracking.set(row.tracking_id, row);

  const missing = ids.filter((id) => ![...byTracking.keys()].some((k) => k.toLowerCase() === id.toLowerCase()));
  const upperMissing = [...new Set(missing.map((id) => id.toUpperCase()))].filter(
    (upper) => ![...byTracking.keys()].includes(upper),
  );
  if (upperMissing.length) {
    const upperRows = await prisma.parcels.findMany({
      where: { tracking_id: { in: upperMissing }, deleted_at: null },
      select: { id: true, tracking_id: true, status: true, current_location_id: true, destination_location_id: true },
    });
    for (const row of upperRows) byTracking.set(row.tracking_id, row);
  }
  return byTracking;
}

type LiveMembership = { manifestId: string; manifestNo: string; status: string };

async function liveMemberships(parcelIds: string[]) {
  const membership = new Map<string, LiveMembership>();
  if (parcelIds.length === 0) return membership;

  const links = await prisma.transit_manifest_parcels.findMany({
    where: {
      parcel_id: { in: parcelIds },
      transit_manifests: { status: { in: [...LIVE_TRANSIT_MANIFEST_STATUSES] } },
    },
    select: {
      parcel_id: true,
      transit_manifest_id: true,
      transit_manifests: { select: { manifest_no: true, status: true } },
    },
  });
  for (const link of links) {
    if (!membership.has(link.parcel_id)) {
      membership.set(link.parcel_id, {
        manifestId: link.transit_manifest_id,
        manifestNo: link.transit_manifests.manifest_no,
        status: link.transit_manifests.status,
      });
    }
  }
  return membership;
}

const prettyStatus = (status: string) => `"${status.replace(/_/g, " ")}"`;

/**
 * Resolves whatever the operator picked - scanned tracking ids, ticked parcel
 * ids, or both - into parcels, keeping the label each one was named by so a
 * rejection reads back the way it was entered.
 */
async function resolveScanTargets(input: TransitScanInput) {
  const trackingIds = normaliseTrackingIds(input.trackingIds ?? []);
  const parcelIds = Array.from(new Set(input.parcelIds ?? []));

  const targets: { label: string; parcel: ScannedParcel | null }[] = [];

  if (trackingIds.length) {
    const byTracking = await findParcelsByTrackingIds(trackingIds);
    const byTrackingLower = new Map([...byTracking.entries()].map(([k, v]) => [k.toLowerCase(), v]));
    for (const id of trackingIds) {
      targets.push({ label: id, parcel: byTracking.get(id) ?? byTrackingLower.get(id.toLowerCase()) ?? null });
    }
  }

  if (parcelIds.length) {
    const rows = await prisma.parcels.findMany({
      where: { id: { in: parcelIds }, deleted_at: null },
      select: { id: true, tracking_id: true, status: true, current_location_id: true, destination_location_id: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of parcelIds) {
      const parcel = byId.get(id) ?? null;
      targets.push({ label: parcel?.tracking_id ?? id, parcel });
    }
  }

  // The same parcel can arrive by both routes (scanned and ticked); keep it once.
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = target.parcel?.id ?? target.label;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The set of destination location ids this manifest's branch actually covers
 * (itself plus its covered areas), or null when that can't be determined -
 * a manifest's to_location_id is nullable (best-effort text matching at
 * creation, see resolveLocationIds) and need not point at a hub row, so an
 * unresolvable one is treated as "can't verify" rather than rejecting every
 * scan against a manifest with no known branch.
 */
async function manifestCoverage(manifest: { to_location_id: string | null }): Promise<Set<string> | null> {
  if (!manifest.to_location_id) return null;
  try {
    return new Set(await resolveBranchLocationIds(manifest.to_location_id));
  } catch {
    return null;
  }
}

/**
 * Stages parcels onto an open manifest. Nothing moves: they stay at oov until
 * the manifest is dispatched, which is what makes removeParcelFromTransitManifest
 * meaningful and what stops a mis-scan from putting a parcel on the road.
 */
export async function addParcelsToTransitManifest(
  actor: Actor,
  manifestId: string,
  input: TransitScanInput,
) {
  const manifest = await loadManifestOrThrow(manifestId);
  if (manifest.status !== "open") {
    throw new AppError(
      409,
      `Manifest ${manifest.manifest_no} has already been dispatched and cannot take new parcels.`,
    );
  }

  const targets = await resolveScanTargets(input);
  if (targets.length === 0) throw new AppError(400, "Scan a tracking id or select at least one order");

  const coveredIds = await manifestCoverage(manifest);

  const existing = await prisma.transit_manifest_parcels.findMany({
    where: { transit_manifest_id: manifestId },
    select: { parcel_id: true },
  });
  const alreadyLinked = new Set(existing.map((link) => link.parcel_id));

  const foundIds = targets.flatMap((target) => (target.parcel ? [target.parcel.id] : []));
  const membership = await liveMemberships(foundIds);

  // Rejections are itemised by tracking id on purpose. "One or more parcels
  // are invalid" tells an operator holding forty parcels nothing they can act
  // on.
  const rejected: { trackingId: string; reason: string }[] = [];
  const eligible: ScannedParcel[] = [];
  let alreadyOnManifest = 0;

  for (const { label, parcel } of targets) {
    if (!parcel) {
      rejected.push({ trackingId: label, reason: "Order not found" });
      continue;
    }
    const member = membership.get(parcel.id);
    if (member?.manifestId === manifestId || alreadyLinked.has(parcel.id)) {
      // Rescanning something already on this manifest is a no-op, not an error
      // - an operator sweeping a shelf will scan the same parcel twice.
      alreadyOnManifest += 1;
    } else if (member) {
      rejected.push({
        trackingId: parcel.tracking_id,
        reason: `Already on manifest ${member.manifestNo}`,
      });
    } else if (parcel.status !== MANIFESTABLE_STATUS) {
      rejected.push({
        trackingId: parcel.tracking_id,
        reason: `Is ${prettyStatus(parcel.status)}, not in transit`,
      });
    } else if (coveredIds && (!parcel.destination_location_id || !coveredIds.has(parcel.destination_location_id))) {
      rejected.push({
        trackingId: parcel.tracking_id,
        reason: `Destination is not covered by ${manifest.to_hub}`,
      });
    } else {
      eligible.push(parcel);
    }
  }

  if (alreadyLinked.size + eligible.length > MAX_TRANSIT_MANIFEST_PARCELS) {
    throw new AppError(
      409,
      `Manifest ${manifest.manifest_no} holds ${alreadyLinked.size} parcels and cannot exceed ${MAX_TRANSIT_MANIFEST_PARCELS}. ` +
        `Dispatch it and start a new one.`,
    );
  }

  // Genuinely nothing to do only when nothing succeeded at all - a scan that
  // was entirely a rescan of already-linked parcels is a no-op (see the
  // alreadyOnManifest branch above), not an error, so it falls through to a
  // normal response instead of throwing here.
  if (eligible.length === 0 && alreadyOnManifest === 0) {
    throw new AppError(
      400,
      `No parcels could be added. ${rejected.map((r) => `${r.trackingId}: ${r.reason}`).join("; ")}`,
    );
  }

  if (eligible.length === 0) {
    return { added: 0, alreadyOnManifest, rejected, manifest: await getTransitManifestById(actor, manifestId) };
  }

  await prisma.$transaction(async (tx) => {
    await tx.transit_manifest_parcels.createMany({
      data: eligible.map((p) => ({ transit_manifest_id: manifestId, parcel_id: p.id })),
      skipDuplicates: true,
    });
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "transit_manifest",
        entity_id: manifestId,
        action: "ADD_PARCELS",
        new_data: { manifestNo: manifest.manifest_no, parcelIds: eligible.map((p) => p.id) },
      },
    });
  });

  return {
    added: eligible.length,
    alreadyOnManifest,
    rejected,
    manifest: await getTransitManifestById(actor, manifestId),
  };
}

/**
 * Deletes an empty open manifest - the cleanup for one opened by mistake (a
 * same-hub route, a route nothing ever got staged onto) rather than a hand-over
 * that actually happened. Scoped to open-and-empty on purpose: a manifest that
 * ever held parcels or ever left with a truck (dispatched/received) is a
 * record of real work, and stays one. Take the parcels off first (see
 * removeParcelFromTransitManifest) if it still holds any.
 */
export async function deleteTransitManifest(actor: Actor, manifestId: string) {
  const manifest = await loadManifestOrThrow(manifestId);
  if (manifest.status !== "open") {
    throw new AppError(
      409,
      `Manifest ${manifest.manifest_no} is "${manifest.status}" - only an open manifest can be deleted.`,
    );
  }
  const parcelCount = manifest._count?.transit_manifest_parcels ?? 0;
  if (parcelCount > 0) {
    throw new AppError(
      409,
      `Manifest ${manifest.manifest_no} still holds ${parcelCount} order${parcelCount === 1 ? "" : "s"} - remove them first.`,
    );
  }

  await prisma.transit_manifests.delete({ where: { id: manifestId } });
  await prisma.audit_logs.create({
    data: {
      actor_id: actor.id,
      entity_type: "transit_manifest",
      entity_id: manifestId,
      action: "DELETE",
      old_data: { manifestNo: manifest.manifest_no, fromHub: manifest.from_hub, toHub: manifest.to_hub },
    },
  });
}

/**
 * Takes a parcel back off an open manifest. It stays at oov, so it drops
 * straight back into the Transit tab ready to join another hand-over - this
 * only unpicks the grouping, it never touches a parcel's status.
 */
export async function removeParcelFromTransitManifest(
  actor: Actor,
  manifestId: string,
  parcelId: string,
) {
  const manifest = await loadManifestOrThrow(manifestId);
  if (manifest.status !== "open") {
    throw new AppError(
      409,
      `Manifest ${manifest.manifest_no} has already been dispatched - its contents are a record of what went out.`,
    );
  }

  const { count } = await prisma.transit_manifest_parcels.deleteMany({
    where: { transit_manifest_id: manifestId, parcel_id: parcelId },
  });
  if (count === 0) throw new AppError(404, "That order is not on this manifest");

  await prisma.audit_logs.create({
    data: {
      actor_id: actor.id,
      entity_type: "transit_manifest",
      entity_id: manifestId,
      action: "REMOVE_PARCEL",
      old_data: { manifestNo: manifest.manifest_no, parcelId },
    },
  });

  return getTransitManifestById(actor, manifestId);
}

/**
 * The truck leaves: every member still at oov moves to dispatched and the
 * manifest goes with them (bulkUpdateParcelStatus flips the row, keyed off
 * transitManifestId).
 *
 * Members that are no longer oov are reported as skipped rather than refusing
 * the whole manifest - the parcel path rejects an entire batch if any member
 * has an invalid transition, so one parcel a super_admin forced out of line
 * would otherwise deadlock the manifest permanently.
 */
export async function dispatchTransitManifest(
  actor: Actor,
  manifestId: string,
  _input: DispatchTransitManifestInput = {},
) {
  const manifest = await loadManifestOrThrow(manifestId);
  if (manifest.status !== "open") {
    throw new AppError(
      409,
      `Manifest ${manifest.manifest_no} is "${manifest.status}" and cannot be dispatched.`,
    );
  }

  const links = await prisma.transit_manifest_parcels.findMany({
    where: { transit_manifest_id: manifestId },
    select: {
      parcels: { select: { id: true, tracking_id: true, status: true, current_location_id: true } },
    },
  });

  const eligible = links
    .filter((link) => link.parcels.status === MANIFESTABLE_STATUS)
    .map((link) => link.parcels);
  const skipped = links
    .filter((link) => link.parcels.status !== MANIFESTABLE_STATUS)
    .map((link) => ({ trackingId: link.parcels.tracking_id, status: link.parcels.status }));

  if (eligible.length === 0) {
    throw new AppError(
      409,
      links.length === 0
        ? `Manifest ${manifest.manifest_no} is empty - add parcels before dispatching it.`
        : `No parcel on manifest ${manifest.manifest_no} is still in transit.`,
    );
  }

  // bulkUpdateParcelStatus needs one shared origin per call when a destination
  // hub is set, so parcels staged at different hubs move in one call each -
  // each still opens its own dispatch row. The first call flips the manifest.
  const toLocationId = manifest.to_location_id;
  const groups = new Map<string, typeof eligible>();
  for (const parcel of eligible) {
    const key = toLocationId ? parcel.current_location_id || "__none__" : "__all__";
    const group = groups.get(key);
    if (group) group.push(parcel);
    else groups.set(key, [parcel]);
  }

  let updated = 0;
  for (const [key, group] of groups) {
    const result = await bulkUpdateParcelStatus(
      { id: actor.id, roles: actor.roles },
      {
        ids: group.map((p) => p.id),
        status: "dispatched",
        ...(toLocationId && key !== "__none__" ? { toLocationId } : {}),
        transitManifestId: manifestId,
      },
    );
    updated += result.updatedCount;
  }

  await prisma.audit_logs.create({
    data: {
      actor_id: actor.id,
      entity_type: "transit_manifest",
      entity_id: manifestId,
      action: "DISPATCH",
      new_data: { manifestNo: manifest.manifest_no, parcelIds: eligible.map((p) => p.id) },
    },
  });

  return {
    updated,
    skipped,
    manifest: await getTransitManifestById(actor, manifestId),
  };
}

/**
 * Reuses any open manifest for this exact origin → destination pair that
 * still has room, or opens a fresh one - the same choice the manual manifest
 * picker offers, just made automatically. Mirrors openOrReuseTransitManifest
 * in order.service.ts (the fallback for a raw dispatch call naming no
 * manifest); this one exists because staging is a distinct action from
 * dispatching and lives in this file.
 */
async function openOrReuseManifestForRoute(
  actor: Actor,
  from: { id: string; name: string },
  to: { id: string; name: string },
  incomingCount: number,
): Promise<string> {
  // Defence in depth: the caller already filters out a parcel already at the
  // destination, so this should never actually fire - but a manifest with the
  // same branch on both ends can never be dispatched, so it must never be
  // created or joined.
  if (from.id === to.id) {
    throw new AppError(422, `${from.name} can't be both the origin and the destination`);
  }

  const existing = await prisma.transit_manifests.findFirst({
    where: { status: "open", from_location_id: from.id, to_location_id: to.id },
    orderBy: { created_at: "desc" },
    select: { id: true, _count: { select: { transit_manifest_parcels: true } } },
  });
  if (existing && existing._count.transit_manifest_parcels + incomingCount <= MAX_TRANSIT_MANIFEST_PARCELS) {
    return existing.id;
  }

  const created = await prisma.transit_manifests.create({
    data: {
      manifest_no: await generateUniqueManifestNo(),
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
 * Stages a selection of `oov` orders onto whichever manifest is headed for
 * `toBranchId` - the "Via Manifest" action on Transit Operations, where the
 * operator picks a destination branch rather than a manifest number.
 *
 * The destination is a deliberate choice, not read off the order, so it is
 * checked against reality: an order whose own destination isn't the branch
 * itself or one of its covered areas is rejected rather than silently routed
 * somewhere it was never headed. Origin can't be asked - it's wherever each
 * parcel physically already is - so parcels are grouped by current_location_id
 * and each origin gets its own manifest (reused if a free one already exists
 * for that pair, opened fresh otherwise).
 */
export async function stageOrdersToBranch(actor: Actor, input: StageOrdersToBranchInput) {
  const branch = await prisma.locations.findFirst({
    where: { id: input.toBranchId, parent_id: null, is_hub: true, is_active: true },
    select: { id: true, name: true },
  });
  if (!branch) throw new AppError(404, "Branch not found or inactive");
  const coveredIds = new Set(await resolveBranchLocationIds(branch.id));

  const parcelIds = Array.from(new Set(input.parcelIds));
  const parcels = await prisma.parcels.findMany({
    where: { id: { in: parcelIds }, deleted_at: null },
    select: {
      id: true,
      tracking_id: true,
      status: true,
      current_location_id: true,
      destination_location_id: true,
    },
  });
  const byId = new Map(parcels.map((p) => [p.id, p]));

  const rejected: { trackingId: string; reason: string }[] = [];
  const eligible: (typeof parcels)[number][] = [];

  for (const id of parcelIds) {
    const parcel = byId.get(id);
    if (!parcel) {
      rejected.push({ trackingId: id, reason: "Order not found" });
    } else if (parcel.status !== MANIFESTABLE_STATUS) {
      rejected.push({ trackingId: parcel.tracking_id, reason: `Is ${prettyStatus(parcel.status)}, not in transit` });
    } else if (!parcel.current_location_id) {
      rejected.push({ trackingId: parcel.tracking_id, reason: "Has no current hub to route from" });
    } else if (parcel.current_location_id === branch.id) {
      // Already there - a manifest is a hub-to-hub hand-over, and one whose
      // origin and destination are the same branch can never be dispatched
      // (bulkUpdateParcelStatus itself refuses that transition), so it would
      // just sit open forever with nothing to do.
      rejected.push({ trackingId: parcel.tracking_id, reason: `Already at ${branch.name} - nothing to transit` });
    } else if (!parcel.destination_location_id || !coveredIds.has(parcel.destination_location_id)) {
      rejected.push({ trackingId: parcel.tracking_id, reason: `Destination is not covered by ${branch.name}` });
    } else {
      eligible.push(parcel);
    }
  }

  if (eligible.length === 0) {
    throw new AppError(
      400,
      rejected.length
        ? `No orders could be added. ${rejected.map((r) => `${r.trackingId}: ${r.reason}`).join("; ")}`
        : "Select at least one order",
    );
  }

  const groups = new Map<string, (typeof parcels)[number][]>();
  for (const parcel of eligible) {
    const group = groups.get(parcel.current_location_id!);
    if (group) group.push(parcel);
    else groups.set(parcel.current_location_id!, [parcel]);
  }
  const origins = await prisma.locations.findMany({
    where: { id: { in: [...groups.keys()] } },
    select: { id: true, name: true },
  });
  const originById = new Map(origins.map((l) => [l.id, l]));

  let added = 0;
  let alreadyOnManifest = 0;
  const manifestNos: string[] = [];
  for (const [originId, group] of groups) {
    const origin = originById.get(originId);
    if (!origin) {
      for (const p of group) rejected.push({ trackingId: p.tracking_id, reason: "Current hub not found or inactive" });
      continue;
    }
    const manifestId = await openOrReuseManifestForRoute(actor, origin, branch, group.length);
    try {
      const result = await addParcelsToTransitManifest(actor, manifestId, { parcelIds: group.map((p) => p.id) });
      added += result.added;
      alreadyOnManifest += result.alreadyOnManifest;
      rejected.push(...result.rejected);
      manifestNos.push(result.manifest.manifestNo);
    } catch (error) {
      // One origin's whole group failing (e.g. every parcel in it turned out
      // to already be on that exact manifest) shouldn't take the other
      // origins down with it.
      const message = error instanceof AppError ? error.message : "Failed to add to the manifest";
      for (const p of group) rejected.push({ trackingId: p.tracking_id, reason: message });
    }
  }

  if (added === 0 && alreadyOnManifest === 0) {
    throw new AppError(400, `No orders could be added. ${rejected.map((r) => `${r.trackingId}: ${r.reason}`).join("; ")}`);
  }

  return { added, alreadyOnManifest, rejected, manifestNos: [...new Set(manifestNos)] };
}

export async function receiveTransitManifestParcels(
  actor: Actor,
  manifestId: string,
  input: TransitScanInput,
) {
  const manifest = await loadManifestOrThrow(manifestId);
  if (manifest.status === "open") {
    throw new AppError(
      409,
      `Manifest ${manifest.manifest_no} is still open - scan its parcels to dispatch them before receiving.`,
    );
  }
  if (manifest.status === "received") {
    throw new AppError(
      409,
      `Manifest ${manifest.manifest_no} is already received.`,
    );
  }

  const targets = await resolveScanTargets(input);
  if (targets.length === 0) throw new AppError(400, "Scan a tracking id or select at least one order");

  const memberLinks = await prisma.transit_manifest_parcels.findMany({
    where: { transit_manifest_id: manifestId },
    select: { parcel_id: true },
  });
  const members = new Set(memberLinks.map((link) => link.parcel_id));

  const foundIds = targets.flatMap((target) => (target.parcel ? [target.parcel.id] : []));
  const membership = await liveMemberships(foundIds);

  const rejected: { trackingId: string; reason: string }[] = [];
  const eligible: ScannedParcel[] = [];

  for (const { label, parcel } of targets) {
    if (!parcel) {
      rejected.push({ trackingId: label, reason: "Order not found" });
      continue;
    }
    if (!members.has(parcel.id)) {
      const member = membership.get(parcel.id);
      rejected.push({
        trackingId: parcel.tracking_id,
        reason: member
          ? `On manifest ${member.manifestNo} instead`
          : `Not on manifest ${manifest.manifest_no}`,
      });
      continue;
    }
    if (parcel.status === RECEIVABLE_STATUS) {
      eligible.push(parcel);
    } else if (parcel.status === MANIFESTABLE_STATUS) {
      rejected.push({
        trackingId: parcel.tracking_id,
        reason: "Not dispatched yet - still waiting at the origin hub",
      });
    } else {
      rejected.push({
        trackingId: parcel.tracking_id,
        reason: `Is ${prettyStatus(parcel.status)}, not in transit`,
      });
    }
  }

  if (eligible.length === 0) {
    throw new AppError(
      400,
      rejected.length
        ? `No parcels could be received. ${rejected.map((r) => `${r.trackingId}: ${r.reason}`).join("; ")}`
        : "Every scanned parcel is already received on this manifest.",
    );
  }

  await bulkUpdateParcelStatus(
    { id: actor.id, roles: actor.roles },
    {
      ids: eligible.map((p) => p.id),
      status: "arrived_at_branch",
      transitManifestId: manifestId,
    },
  );

  await prisma.audit_logs.create({
    data: {
      actor_id: actor.id,
      entity_type: "transit_manifest",
      entity_id: manifestId,
      action: "RECEIVE_PARCELS",
      new_data: { manifestNo: manifest.manifest_no, parcelIds: eligible.map((p) => p.id) },
    },
  });

  return {
    updated: eligible.length,
    rejected,
    manifest: await getTransitManifestById(actor, manifestId),
  };
}
