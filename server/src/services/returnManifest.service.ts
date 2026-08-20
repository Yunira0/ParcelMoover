// Return manifests - the hand-over document for the RTO leg.
//
// The delivery leg has had one of these for a long time (`run_sheets`, opened by
// createRunSheet the moment a batch goes out with a rider). The return leg had
// nothing: parcels went back to a vendor one selection at a time and no row
// anywhere said which parcels travelled together.
//
// The shape differs from a run sheet in one way that drives this whole file. A
// run sheet is created complete, at the instant of hand-off. A return manifest
// is opened *empty* and filled over days, because a vendor's failed deliveries
// trickle in long before anyone comes to collect them. So the manifest is a
// first-class row with its own lifecycle (open → sent → received) rather than a
// side effect of a status change.
//
// What this file deliberately does NOT do is write parcel statuses. Send and
// receive both delegate to bulkUpdateParcelStatus, which owns the things that
// make a return correct and are easy to forget: re-pricing a plain RTO to the
// vendor's discounted return percent, stamping cod_collections.collected_at so
// the parcel earns its charge, tagging the collecting rider, status history,
// webhooks and cache invalidation. Reimplementing any of that here would be
// four money bugs in a trench coat.
import prisma from "../lib/prisma";
import { AppError } from "../utils/AppError";
import { generateReturnManifestNo } from "../utils/returnManifestNo";
import {
  bulkUpdateParcelStatus,
  mapHandoverParcel,
  HANDOVER_PARCEL_INCLUDE,
} from "./order.service";
import {
  AddManifestParcelsInput,
  CreateReturnManifestInput,
  ListReturnManifestsParams,
  LIVE_MANIFEST_STATUSES,
  MAX_MANIFEST_PARCELS,
  ReceiveReturnManifestInput,
  ReturnManifestStatus,
  SendReturnManifestInput,
} from "../types/returnManifest.type";
import { ParcelStatus } from "../types/order.type";

type Actor = { id: string; roles: string[] };

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;
const MAX_MANIFEST_NO_RETRIES = 5;

/** The only parcel status a manifest accepts. */
const MANIFESTABLE_STATUS = "ready_to_return";

const MANIFEST_INCLUDE = {
  vendors: { select: { id: true, client_name: true, business_name: true, phone: true } },
  riders: { select: { id: true, name: true, phone: true, vehicle_no: true } },
  created_by_user: { select: { full_name: true } },
  sent_by_user: { select: { full_name: true } },
  received_by_user: { select: { full_name: true } },
  _count: { select: { return_manifest_parcels: true } },
} as const;

type ManifestRow = {
  id: string;
  manifest_no: string;
  vendor_id: string;
  status: string;
  rider_id: string | null;
  sent_at: Date | null;
  received_at: Date | null;
  remarks: string | null;
  created_at: Date;
  updated_at: Date;
  vendors?: { id: string; client_name: string; business_name: string | null; phone: string } | null;
  riders?: { id: string; name: string; phone: string; vehicle_no: string | null } | null;
  created_by_user?: { full_name: string } | null;
  sent_by_user?: { full_name: string } | null;
  received_by_user?: { full_name: string } | null;
  _count?: { return_manifest_parcels: number };
};

function mapManifest(row: ManifestRow, parcelIds?: string[]) {
  return {
    id: row.id,
    manifestNo: row.manifest_no,
    vendorId: row.vendor_id,
    vendorName: row.vendors?.business_name || row.vendors?.client_name || "",
    vendorPhone: row.vendors?.phone || "",
    status: row.status,
    riderId: row.rider_id,
    riderName: row.riders?.name || "",
    riderPhone: row.riders?.phone || "",
    riderVehicleNo: row.riders?.vehicle_no || "",
    parcelCount: row._count?.return_manifest_parcels ?? 0,
    remarks: row.remarks || "",
    createdBy: row.created_by_user?.full_name || "",
    sentBy: row.sent_by_user?.full_name || "",
    receivedBy: row.received_by_user?.full_name || "",
    sentAt: row.sent_at ? row.sent_at.toISOString() : null,
    receivedAt: row.received_at ? row.received_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    // Only populated for live manifests by the list endpoint - see there.
    ...(parcelIds ? { parcelIds } : {}),
  };
}

async function generateUniqueManifestNo(retries = 0): Promise<string> {
  const manifestNo = generateReturnManifestNo();

  const existing = await prisma.return_manifests.findUnique({
    where: { manifest_no: manifestNo },
    select: { id: true },
  });

  if (!existing) return manifestNo;

  if (retries >= MAX_MANIFEST_NO_RETRIES) {
    throw new AppError(500, "Failed to generate unique return manifest number");
  }

  return generateUniqueManifestNo(retries + 1);
}

async function loadManifestOrThrow(id: string) {
  const row = await prisma.return_manifests.findUnique({ where: { id }, include: MANIFEST_INCLUDE });
  if (!row) throw new AppError(404, "Return manifest not found");
  return row;
}

/**
 * The vendor's open manifest, if they have one.
 *
 * Exposed for the same reason getLiveRequestForVendor is: the UI needs to know
 * before the operator commits to anything. Offering "create a manifest" and
 * then refusing on submit is a worse experience than showing them the manifest
 * that already exists.
 */
export async function getOpenManifestForVendor(vendorId: string) {
  const row = await prisma.return_manifests.findFirst({
    where: { vendor_id: vendorId, status: "open" },
    include: MANIFEST_INCLUDE,
    orderBy: { created_at: "desc" },
  });
  return row ? mapManifest(row) : null;
}

export async function listReturnManifests(_actor: Actor, params: ListReturnManifestsParams = {}) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE));

  const where: Record<string, unknown> = {};
  if (params.status) where.status = params.status;
  if (params.vendorId) where.vendor_id = params.vendorId;

  if (params.search?.trim()) {
    const search = params.search.trim();
    where.OR = [
      { manifest_no: { contains: search, mode: "insensitive" } },
      { vendors: { client_name: { contains: search, mode: "insensitive" } } },
      { vendors: { business_name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.return_manifests.findMany({
      where,
      include: MANIFEST_INCLUDE,
      orderBy: { created_at: params.sortDir === "asc" ? "asc" : "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.return_manifests.count({ where }),
  ]);

  // Membership ids for the live manifests only, so Return Operations can badge
  // each parcel row with the manifest it is on. Fetched separately rather than
  // included above because a 'received' manifest's membership is closed history
  // the client has no use for, and those are the rows that accumulate forever.
  const liveIds = rows
    .filter((row) => LIVE_MANIFEST_STATUSES.includes(row.status as ReturnManifestStatus))
    .map((row) => row.id);

  const membership = new Map<string, string[]>();
  if (liveIds.length) {
    const links = await prisma.return_manifest_parcels.findMany({
      where: { return_manifest_id: { in: liveIds } },
      select: { return_manifest_id: true, parcel_id: true },
    });
    for (const link of links) {
      const list = membership.get(link.return_manifest_id);
      if (list) list.push(link.parcel_id);
      else membership.set(link.return_manifest_id, [link.parcel_id]);
    }
  }

  return {
    data: rows.map((row) =>
      mapManifest(row, liveIds.includes(row.id) ? membership.get(row.id) ?? [] : undefined),
    ),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  };
}

export async function getReturnManifestById(_actor: Actor, id: string) {
  const row = await loadManifestOrThrow(id);

  const links = await prisma.return_manifest_parcels.findMany({
    where: { return_manifest_id: id },
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

export async function createReturnManifest(actor: Actor, input: CreateReturnManifestInput) {
  const vendor = await prisma.vendors.findFirst({
    where: { id: input.vendorId, deleted_at: null },
    select: { id: true },
  });
  if (!vendor) throw new AppError(404, "Vendor not found");

  // Checked here so the operator gets a sentence rather than a constraint name.
  // This is NOT what enforces the rule - see the catch below.
  const open = await getOpenManifestForVendor(vendor.id);
  if (open) {
    throw new AppError(
      409,
      `This vendor already has an open return manifest (${open.manifestNo}). ` +
        `Add the parcels to it, or send it before starting another.`,
    );
  }

  try {
    const created = await prisma.return_manifests.create({
      data: {
        manifest_no: await generateUniqueManifestNo(),
        vendor_id: vendor.id,
        status: "open",
        remarks: input.remarks?.trim() || null,
        created_by: actor.id,
      },
      include: MANIFEST_INCLUDE,
    });
    return mapManifest(created, []);
  } catch (error: unknown) {
    // Two operators clicking together both pass the check above; the database
    // is what actually decides. P2002 here is the one-open-per-vendor index -
    // a manifest_no collision is astronomically unlikely and would be a
    // different column - so it means the same thing as the check.
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002") {
      throw new AppError(409, "This vendor already has an open return manifest.");
    }
    throw error;
  }
}

export async function addParcelsToManifest(
  actor: Actor,
  manifestId: string,
  input: AddManifestParcelsInput,
) {
  const manifest = await loadManifestOrThrow(manifestId);
  if (manifest.status !== "open") {
    throw new AppError(409, `Manifest ${manifest.manifest_no} has already been sent and cannot take new parcels.`);
  }

  const parcelIds = Array.from(new Set(input.parcelIds));

  const existing = await prisma.return_manifest_parcels.findMany({
    where: { return_manifest_id: manifestId },
    select: { parcel_id: true },
  });
  const alreadyOn = new Set(existing.map((link) => link.parcel_id));
  const incoming = parcelIds.filter((id) => !alreadyOn.has(id));

  if (alreadyOn.size + incoming.length > MAX_MANIFEST_PARCELS) {
    throw new AppError(
      409,
      `Manifest ${manifest.manifest_no} holds ${alreadyOn.size} parcels and cannot exceed ${MAX_MANIFEST_PARCELS}. ` +
        `Send it and start a new one.`,
    );
  }

  const parcels = await prisma.parcels.findMany({
    where: { id: { in: incoming }, deleted_at: null },
    select: { id: true, tracking_id: true, status: true, vendor_id: true },
  });
  const found = new Map(parcels.map((p) => [p.id, p]));

  // Rejections are itemised by tracking id on purpose. "One or more parcels are
  // invalid" tells an operator holding forty parcels nothing they can act on.
  const rejected: { parcelId: string; trackingId: string; reason: string }[] = [];
  const eligible: string[] = [];

  for (const id of incoming) {
    const parcel = found.get(id);
    if (!parcel) {
      rejected.push({ parcelId: id, trackingId: "", reason: "Order not found" });
    } else if (!parcel.vendor_id) {
      rejected.push({
        parcelId: id,
        trackingId: parcel.tracking_id,
        reason: "This order has no vendor, so there is nobody to return it to",
      });
    } else if (parcel.vendor_id !== manifest.vendor_id) {
      rejected.push({
        parcelId: id,
        trackingId: parcel.tracking_id,
        reason: "Belongs to a different vendor - a manifest holds one vendor's parcels",
      });
    } else if (parcel.status !== MANIFESTABLE_STATUS) {
      rejected.push({
        parcelId: id,
        trackingId: parcel.tracking_id,
        reason: `Is "${parcel.status.replace(/_/g, " ")}", not ready to return`,
      });
    } else {
      eligible.push(id);
    }
  }

  if (eligible.length === 0) {
    throw new AppError(
      400,
      rejected.length
        ? `No parcels could be added. ${rejected.map((r) => `${r.trackingId || r.parcelId}: ${r.reason}`).join("; ")}`
        : "Every selected parcel is already on this manifest.",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.return_manifest_parcels.createMany({
      data: eligible.map((parcelId) => ({ return_manifest_id: manifestId, parcel_id: parcelId })),
      skipDuplicates: true,
    });
    await tx.audit_logs.create({
      data: {
        actor_id: actor.id,
        entity_type: "return_manifest",
        entity_id: manifestId,
        action: "ADD_PARCELS",
        new_data: { manifestNo: manifest.manifest_no, parcelIds: eligible },
      },
    });
  });

  return {
    added: eligible.length,
    alreadyOnManifest: parcelIds.length - incoming.length,
    rejected,
    manifest: await getReturnManifestById(actor, manifestId),
  };
}

export async function removeParcelFromManifest(actor: Actor, manifestId: string, parcelId: string) {
  const manifest = await loadManifestOrThrow(manifestId);
  if (manifest.status !== "open") {
    throw new AppError(
      409,
      `Manifest ${manifest.manifest_no} has already been sent - its contents are a record of what went out.`,
    );
  }

  const { count } = await prisma.return_manifest_parcels.deleteMany({
    where: { return_manifest_id: manifestId, parcel_id: parcelId },
  });
  if (count === 0) throw new AppError(404, "That order is not on this manifest");

  await prisma.audit_logs.create({
    data: {
      actor_id: actor.id,
      entity_type: "return_manifest",
      entity_id: manifestId,
      action: "REMOVE_PARCEL",
      old_data: { manifestNo: manifest.manifest_no, parcelId },
    },
  });

  return getReturnManifestById(actor, manifestId);
}

/**
 * Move a manifest to the next stage by moving its parcels.
 *
 * Members are filtered to those still at `from` and the rest are reported as
 * skipped, rather than refusing the whole manifest. That is not laxness: the
 * parcel path rejects an entire batch if any member has an invalid transition,
 * so one parcel a super_admin forced out of line would otherwise deadlock the
 * manifest permanently - and once a manifest leaves 'open' there is no remove
 * action left to dig it out.
 */
async function advanceManifest(
  actor: Actor,
  manifestId: string,
  opts: {
    requireStatus: "open" | "sent";
    from: string;
    to: ParcelStatus & ("sent_to_vendor" | "returned_to_vendor");
    riderId?: string | undefined;
    remarks?: string | undefined;
    verb: string;
  },
) {
  const manifest = await loadManifestOrThrow(manifestId);
  if (manifest.status !== opts.requireStatus) {
    throw new AppError(
      409,
      `Manifest ${manifest.manifest_no} is "${manifest.status}" and cannot be ${opts.verb}.`,
    );
  }

  const links = await prisma.return_manifest_parcels.findMany({
    where: { return_manifest_id: manifestId },
    select: { parcels: { select: { id: true, tracking_id: true, status: true } } },
  });

  const eligible = links.filter((link) => link.parcels.status === opts.from).map((link) => link.parcels);
  const skipped = links
    .filter((link) => link.parcels.status !== opts.from)
    .map((link) => ({ trackingId: link.parcels.tracking_id, status: link.parcels.status }));

  if (eligible.length === 0) {
    throw new AppError(
      409,
      links.length === 0
        ? `Manifest ${manifest.manifest_no} is empty - add parcels before sending it.`
        : `No parcel on manifest ${manifest.manifest_no} is still "${opts.from.replace(/_/g, " ")}".`,
    );
  }

  // The manifest row moves inside this same call's transaction, keyed off
  // returnManifestId - see the note on BulkUpdateParcelStatusInput.
  const result = await bulkUpdateParcelStatus(
    { id: actor.id, roles: actor.roles },
    {
      ids: eligible.map((p) => p.id),
      status: opts.to,
      ...(opts.riderId ? { riderId: opts.riderId } : {}),
      ...(opts.remarks?.trim() ? { remarks: opts.remarks.trim() } : {}),
      returnManifestId: manifestId,
    },
  );

  return {
    updatedCount: result.updatedCount,
    skipped,
    manifest: await getReturnManifestById(actor, manifestId),
  };
}

export async function sendReturnManifest(
  actor: Actor,
  manifestId: string,
  input: SendReturnManifestInput,
) {
  return advanceManifest(actor, manifestId, {
    requireStatus: "open",
    from: "ready_to_return",
    to: "sent_to_vendor",
    riderId: input.riderId,
    remarks: input.remarks,
    verb: "sent",
  });
}

export async function receiveReturnManifest(
  actor: Actor,
  manifestId: string,
  input: ReceiveReturnManifestInput = {},
) {
  return advanceManifest(actor, manifestId, {
    requireStatus: "sent",
    from: "sent_to_vendor",
    to: "returned_to_vendor",
    remarks: input.remarks,
    verb: "marked received",
  });
}
