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
// several open manifests may accumulate for the same route - and scans arrive
// as tracking ids off a barcode scanner, not parcel ids off a table
// selection.
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
import {
  CreateTransitManifestInput,
  ListTransitManifestsParams,
  LIVE_TRANSIT_MANIFEST_STATUSES,
  MAX_TRANSIT_MANIFEST_PARCELS,
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

function mapManifest(row: ManifestRow) {
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

  return {
    data: rows.map((row) => mapManifest(row)),
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
    ...mapManifest(row),
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
    select: { id: true, tracking_id: true, status: true, current_location_id: true },
  });
  for (const row of rows) byTracking.set(row.tracking_id, row);

  const missing = ids.filter((id) => ![...byTracking.keys()].some((k) => k.toLowerCase() === id.toLowerCase()));
  const upperMissing = [...new Set(missing.map((id) => id.toUpperCase()))].filter(
    (upper) => ![...byTracking.keys()].includes(upper),
  );
  if (upperMissing.length) {
    const upperRows = await prisma.parcels.findMany({
      where: { tracking_id: { in: upperMissing }, deleted_at: null },
      select: { id: true, tracking_id: true, status: true, current_location_id: true },
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

export async function addParcelsToTransitManifest(
  actor: Actor,
  manifestId: string,
  input: TransitScanInput,
) {
  const manifest = await loadManifestOrThrow(manifestId);
  if (manifest.status === "received") {
    throw new AppError(
      409,
      `Manifest ${manifest.manifest_no} is already received and cannot take new parcels.`,
    );
  }

  const ids = normaliseTrackingIds(input.trackingIds);
  if (ids.length === 0) throw new AppError(400, "Scan at least one tracking id");

  const existing = await prisma.transit_manifest_parcels.findMany({
    where: { transit_manifest_id: manifestId },
    select: { parcel_id: true },
  });
  const alreadyLinked = new Set(existing.map((link) => link.parcel_id));

  const byTracking = await findParcelsByTrackingIds(ids);
  const byTrackingLower = new Map([...byTracking.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  const foundIds = [...byTracking.values()].map((p) => p.id);
  const membership = await liveMemberships(foundIds);

  // Rejections are itemised by tracking id on purpose. "One or more parcels
  // are invalid" tells an operator holding forty parcels nothing they can act
  // on.
  const rejected: { trackingId: string; reason: string }[] = [];
  const eligible: ScannedParcel[] = [];
  let alreadyOnManifest = 0;

  for (const id of ids) {
    const parcel =
      byTracking.get(id) ?? byTrackingLower.get(id.toLowerCase());
    if (!parcel) {
      rejected.push({ trackingId: id, reason: "Order not found" });
      continue;
    }
    const member = membership.get(parcel.id);
    const onThis = member?.manifestId === manifestId || alreadyLinked.has(parcel.id);
    if (onThis && parcel.status !== MANIFESTABLE_STATUS) {
      // Already dispatched on this manifest - rescanning it is a no-op, not
      // an error.
      alreadyOnManifest += 1;
    } else if (onThis) {
      // Linked but still oov: an earlier scan linked it without moving it.
      // Retry the move rather than stranding it.
      eligible.push(parcel);
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

  if (eligible.length === 0) {
    throw new AppError(
      400,
      rejected.length
        ? `No parcels could be dispatched. ${rejected.map((r) => `${r.trackingId}: ${r.reason}`).join("; ")}`
        : "Every scanned parcel is already on this manifest.",
    );
  }

  // Linked before the status moves so a crash between the two still leaves a
  // retryable member (see the onThis && oov branch above) rather than a
  // dispatched parcel nobody's manifest claims.
  const freshLinks = eligible.filter((p) => !alreadyLinked.has(p.id));
  if (freshLinks.length) {
    await prisma.transit_manifest_parcels.createMany({
      data: freshLinks.map((p) => ({ transit_manifest_id: manifestId, parcel_id: p.id })),
      skipDuplicates: true,
    });
  }

  await prisma.audit_logs.create({
    data: {
      actor_id: actor.id,
      entity_type: "transit_manifest",
      entity_id: manifestId,
      action: "ADD_PARCELS",
      new_data: { manifestNo: manifest.manifest_no, parcelIds: eligible.map((p) => p.id) },
    },
  });

  // bulkUpdateParcelStatus needs one shared origin per call when a
  // destination hub is set, so parcels staged at different hubs move in one
  // call each - each still opens its own dispatch row.
  const toLocationId = manifest.to_location_id;
  const groups = new Map<string, ScannedParcel[]>();
  for (const parcel of eligible) {
    const key = toLocationId ? parcel.current_location_id || "__none__" : "__all__";
    const list = groups.get(key);
    if (list) list.push(parcel);
    else groups.set(key, [parcel]);
  }

  for (const [key, group] of groups) {
    await bulkUpdateParcelStatus(
      { id: actor.id, roles: actor.roles },
      {
        ids: group.map((p) => p.id),
        status: "dispatched",
        ...(toLocationId && key !== "__none__" ? { toLocationId } : {}),
        transitManifestId: manifestId,
      },
    );
  }

  return {
    updated: eligible.length,
    alreadyOnManifest,
    rejected,
    manifest: await getTransitManifestById(actor, manifestId),
  };
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

  const ids = normaliseTrackingIds(input.trackingIds);
  if (ids.length === 0) throw new AppError(400, "Scan at least one tracking id");

  const memberLinks = await prisma.transit_manifest_parcels.findMany({
    where: { transit_manifest_id: manifestId },
    select: { parcel_id: true },
  });
  const members = new Set(memberLinks.map((link) => link.parcel_id));

  const byTracking = await findParcelsByTrackingIds(ids);
  const byTrackingLower = new Map([...byTracking.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  const foundIds = [...byTracking.values()].map((p) => p.id);
  const membership = await liveMemberships(foundIds);

  const rejected: { trackingId: string; reason: string }[] = [];
  const eligible: ScannedParcel[] = [];

  for (const id of ids) {
    const parcel =
      byTracking.get(id) ?? byTrackingLower.get(id.toLowerCase());
    if (!parcel) {
      rejected.push({ trackingId: id, reason: "Order not found" });
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
