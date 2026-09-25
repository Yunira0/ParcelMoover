import { parcel_status, Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import redis from "../../lib/redis";
import { AppError } from "../../utils/AppError";
import type { ListOrdersQuery, OrderSortField, ParcelStatus } from "../../types/order.type";
import { formatNepalDate as formatDate, NEPAL_UTC_OFFSET_MS } from "../../utils/nepalTime";
import { getVendorStatusLabel } from "../../utils/orderStatusLabel";
import { stripCarrierStaffTag } from "../../utils/carrierRemark";
import { resolveLabelSize } from "../vendorPrintSettings.service";
import { buildOrdersWhere } from "./where";
import {
  PICKUP_LEG_STATUSES,
  getActorScope,
  getAdminBranchScope,
} from "./scope";
import {
  ORDERS_LIST_TTL_SECONDS,
  ordersListCacheKey,
} from "./cache";
import type { OrderActor } from "./types";

// Match the existing list defaults and location/money formatting.
const MAX_PAGE_SIZE = 500;
const DEFAULT_PAGE_SIZE = 10;

export const locationName = (location?: { name: string; city: string | null; district: string | null } | null) => {
  // Location names already contain the district, so don't append it again.
  return location?.name ?? "";
};

export interface OrderFilterOptions {
  // Keyed by location id, not just a name string: two different hubs (e.g. a
  // top-level "Imadol" hub and an unrelated "Imadol" covered area filed under
  // a different destination) can share a display name, and the list page
  // needs to filter by the exact location the user picked, not by whichever
  // same-named location the string happens to also match.
  origins: { id: string; name: string }[];
  destinations: { id: string; name: string }[];
  riders: string[];
}

// Lightweight sibling to listOrders, purely for populating the tab-scoped
// origin/rider/destination filter dropdowns on the orders list page. Selects
// only the handful of columns those dropdowns need instead of the full
// ORDERS_INCLUDE (both parties, both locations, vendor, both riders, remarks,
// status history+users+roles) that the page previously reused here just to
// read three strings per row - doubling the backend cost of every non-"All"
// tab view for no reason.
//
// Each dimension runs its own `distinct` query on its FK column (all four are
// indexed) rather than pulling one arbitrary `take: 200` slice of parcels and
// hoping every hub/rider shows up in it: in a system with more than ~200
// in-scope parcels, an unordered sample silently drops whichever origins,
// destinations or riders didn't happen to land in that slice - previously
// hiding valid filter options (and any hub with only a handful of orders)
// with no indication anything was missing.
export async function getOrderFilterOptions(
  actor: OrderActor,
  status?: ListOrdersQuery["status"],
): Promise<OrderFilterOptions> {
  const { vendorId, vendorIds, riderId, branchLocationIds } = await getActorScope(actor);
  const where = buildOrdersWhere({ vendorId, vendorIds, riderId, branchLocationIds }, status?.length ? { status } : {});

  const [originRows, destinationRows, deliveryRiderRows, pickupRiderRows] = await Promise.all([
    prisma.parcels.findMany({
      where,
      distinct: ["origin_location_id"],
      select: {
        origin_location_id: true,
        locations_parcels_origin_location_idTolocations: { select: { name: true } },
      },
    }),
    prisma.parcels.findMany({
      where,
      distinct: ["destination_location_id"],
      select: {
        destination_location_id: true,
        locations_parcels_destination_location_idTolocations: { select: { name: true } },
      },
    }),
    prisma.parcels.findMany({
      where: { ...where, delivery_rider_id: { not: null } },
      distinct: ["delivery_rider_id"],
      select: { riders_parcels_delivery_rider_idToriders: { select: { name: true } } },
    }),
    prisma.parcels.findMany({
      where: { ...where, pickup_rider_id: { not: null } },
      distinct: ["pickup_rider_id"],
      select: { riders_parcels_pickup_rider_idToriders: { select: { name: true } } },
    }),
  ]);

  // Keyed by id (a Map, not a Set of names) so two locations that happen to
  // share a display name still surface as two distinct, individually
  // filterable options.
  const origins = new Map<string, string>();
  for (const row of originRows) {
    const name = row.locations_parcels_origin_location_idTolocations?.name;
    // A legacy/free-text order with no linked origin location has nothing to
    // filter by here (there's no id) - excluded rather than shown unusable.
    if (row.origin_location_id && name) origins.set(row.origin_location_id, name);
  }

  const destinations = new Map<string, string>();
  for (const row of destinationRows) {
    const name = row.locations_parcels_destination_location_idTolocations?.name;
    if (row.destination_location_id && name) destinations.set(row.destination_location_id, name);
  }

  // Same "who's this filter for" duality as mapOrder's rider column: a
  // delivery rider and a pickup-only rider are both valid filter values.
  const riders = new Set<string>();
  for (const row of deliveryRiderRows) {
    const name = row.riders_parcels_delivery_rider_idToriders?.name;
    if (name) riders.add(name);
  }
  for (const row of pickupRiderRows) {
    const name = row.riders_parcels_pickup_rider_idToriders?.name;
    if (name) riders.add(name);
  }

  return {
    origins: Array.from(origins, ([id, name]) => ({ id, name })),
    destinations: Array.from(destinations, ([id, name]) => ({ id, name })),
    riders: Array.from(riders),
  };
}

/** Per-status totals for the orders list page's tab badges. */
export type OrderCountsByStatus = Record<ParcelStatus, number>;

// Every list filter except `status`, each also accepting an explicit
// `undefined` — the controller forwards a parsed query object wholesale, and
// under exactOptionalPropertyTypes a plain `Omit<ListOrdersQuery, "status">`
// would reject the absent-but-present keys that produces.
export type OrderCountsByStatusFilters = {
  [K in keyof Omit<ListOrdersQuery, "status">]?: ListOrdersQuery[K] | undefined;
};

// Counts every status in one grouped query rather than one COUNT per tab.
// The list page's tabs are overlapping status groups (failed_delivery is in
// both Inprogress and Failed; Return process is a subset of RTV), so summing
// per-status numbers on the caller's side is both cheaper and the only way to
// get those overlaps right — a per-tab COUNT would double-count nothing but
// would need one round trip per tab to say so.
export async function getOrderCountsByStatus(
  actor: OrderActor,
  query: OrderCountsByStatusFilters = {},
): Promise<OrderCountsByStatus> {
  const { vendorId, vendorIds, riderId, branchLocationIds } = await getActorScope(actor);
  // `status` is deliberately left out: the group-by supplies it per row.
  const where = buildOrdersWhere({ vendorId, vendorIds, riderId, branchLocationIds }, query as ListOrdersQuery);

  const rows = await prisma.parcels.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });

  // Seed every status at 0 so a tab with no orders renders "0" instead of
  // dropping its badge the moment the last order leaves that status. Seeded
  // from the Prisma enum so a status added to the schema can't be missed here.
  const counts = Object.fromEntries(
    Object.values(parcel_status).map((status) => [status, 0]),
  ) as OrderCountsByStatus;
  for (const row of rows) {
    counts[row.status as ParcelStatus] = row._count._all;
  }
  return counts;
}

const ORDERS_INCLUDE = {
  parties_parcels_sender_idToparties: true,
  parties_parcels_receiver_idToparties: true,
  locations_parcels_origin_location_idTolocations: true,
  locations_parcels_destination_location_idTolocations: true,
  vendors: true,
  riders_parcels_pickup_rider_idToriders: true,
  riders_parcels_delivery_rider_idToriders: true,
  parcel_remarks: {
    orderBy: { created_at: "desc" as const },
    take: 1,
  },
  parcel_status_history: {
    orderBy: { created_at: "desc" as const },
    take: 1,
    include: { users: { include: { user_roles: { include: { roles: true } } } } },
  },
  // One column, not the whole row. cod_collections.parcel_id is unique, so this
  // is a single indexed join per parcel - but this include is already the
  // expensive part of every list query (see the note above getOrderFilterOptions),
  // so it takes only the figure the finance column actually renders.
  cod_collections: { select: { collected_amount: true } },
} satisfies Prisma.parcelsInclude;

// Role tag appended to "last updated by" so staff can tell at a glance which
// side of the system touched the parcel. Ordered by precedence: a user with
// several roles gets the most privileged tag.
const LAST_UPDATED_BY_ROLE_TAGS: [string, string][] = [
  ["super_admin", "Super Admin"],
  ["admin", "Staff"],
  ["sales", "Sales"],
  ["rider", "Rider"],
  ["vendor", "Vendor"],
  ["vendor_staff", "Vendor Staff"],
];

export interface ListOrdersResult {
  data: ReturnType<typeof mapOrder>[];
  meta?: {
    // Display hint only under keyset pagination - the client tracks its own
    // page counter; the server just clamps it into [1, totalPages].
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    // Set when the caller didn't ask for pagination and the result was capped -
    // lets the UI show "showing 200 of N" instead of silently looking complete.
    truncated?: boolean;
    // Keyset navigation - present on paginated queries.
    hasNextPage?: boolean;
    hasPrevPage?: boolean;
    nextCursor?: string | null;
    prevCursor?: string | null;
  };
}

export function mapOrder(
  parcel: Prisma.parcelsGetPayload<{ include: typeof ORDERS_INCLUDE }>,
  isStaff: boolean,
  // True only when the caller *is* the vendor that owns these parcels (vendor
  // or vendor_staff) - i.e. getActorScope resolved an own-vendor id.
  isOwnVendorViewer: boolean,
  // Only populated for exports, where the caller batch-fetches the moment each
  // parcel first entered every status it has held (see fetchStatusTimestampMap).
  statusTimestampsByParcelId?: StatusTimestampMap,
) {
  const latestHistory = parcel.parcel_status_history[0];
  // The delivery rider is who this column is about; the pickup rider only
  // stands in while the parcel is still on the pickup leg. Past that, falling
  // back to them labelled whoever collected the parcel as its delivery rider -
  // so a 3PL-carried order (no delivery rider at all) showed up in ops looking
  // like it had been assigned to a rider who never saw it again.
  const rider =
    parcel.riders_parcels_delivery_rider_idToriders ||
    (PICKUP_LEG_STATUSES.includes(parcel.status) || parcel.status === "arrived"
      ? parcel.riders_parcels_pickup_rider_idToriders
      : null);
  const vendorName = parcel.vendors?.business_name || parcel.vendors?.client_name || "";
  // A vendor's label-size override describes the sticker stock loaded in
  // *their own* printer, so it only applies when the vendor is the one
  // printing. Ops/admin screens print the same parcel on branch stock, which
  // is always the standard 100x75mm - so they get the app default regardless
  // of what the vendor configured for themselves.
  const labelSize = resolveLabelSize(isOwnVendorViewer ? parcel.vendors : null);

  // Staff see who (which user) last changed the status; vendors/riders only
  // see which branch/company made the change - never an internal staff name
  // (matches the redaction already applied to getOrderByTrackingId's
  // statusHistory[].changedBy).
  let lastUpdatedBy = "";
  if (isStaff) {
    const historyUser = latestHistory?.users;
    if (historyUser) {
      const roleCodes = new Set(historyUser.user_roles.map(ur => ur.roles.code));
      const roleTag = LAST_UPDATED_BY_ROLE_TAGS.find(([code]) => roleCodes.has(code))?.[1];
      // A vendor account's user name is often just the login contact - the
      // business name is what staff recognise.
      const displayName = roleCodes.has("vendor") && vendorName ? vendorName : historyUser.full_name;
      lastUpdatedBy = roleTag ? `${displayName} (${roleTag})` : displayName;
    }
  } else {
    lastUpdatedBy =
      locationName(parcel.locations_parcels_origin_location_idTolocations) || vendorName || "Branch";
  }

  return {
    id: parcel.id,
    orderNumber: parcel.order_number,
    trackingId: parcel.tracking_id,
    status: parcel.status,
    statusLabel: getVendorStatusLabel(parcel.status),
    orderType: parcel.order_type,
    serviceType: parcel.service_type,
    senderName: parcel.parties_parcels_sender_idToparties.name,
    senderPhone: parcel.parties_parcels_sender_idToparties.phone,
    senderAddress: parcel.parties_parcels_sender_idToparties.address || "",
    receiverName: parcel.parties_parcels_receiver_idToparties.name,
    receiverPhone: parcel.parties_parcels_receiver_idToparties.phone,
    receiverAlternatePhone: parcel.parties_parcels_receiver_idToparties.alternate_phone || "",
    receiverAddress: parcel.parties_parcels_receiver_idToparties.address || "",
    originLocationId: parcel.origin_location_id,
    destinationLocationId: parcel.destination_location_id,
    origin:
      locationName(parcel.locations_parcels_origin_location_idTolocations) ||
      parcel.parties_parcels_sender_idToparties.address ||
      "",
    destination:
      locationName(parcel.locations_parcels_destination_location_idTolocations) ||
      parcel.parties_parcels_receiver_idToparties.address ||
      "",
    // Raw destination hub name - shipping labels print this.
    destinationName:
      parcel.locations_parcels_destination_location_idTolocations?.name ||
      parcel.parties_parcels_receiver_idToparties.address ||
      "",
    destinationValley: parcel.locations_parcels_destination_location_idTolocations?.valley ?? null,
    pieces: parcel.pieces,
    weightKg: parcel.weight_kg === null ? undefined : Number(parcel.weight_kg),
    attemptCount: parcel.attempt_count,
    codAmount: Number(parcel.cod_amount),
    itemValue: Number(parcel.item_value),
    deliveryCharge: Number(parcel.delivery_charge),
    grossDeliveryCharge: Number(parcel.gross_delivery_charge),
    discountAmount: Number(parcel.discount_amount),
    // Cash actually taken from the receiver, as opposed to cod_amount, which is
    // what was meant to be taken. The two differ on a partial delivery, and
    // collected stays 0 until someone marks the parcel delivered. This is the
    // same figure finance settles on and the ledger posts from.
    collectedAmount: Number(parcel.cod_collections?.collected_amount ?? 0),
    packageType: parcel.package_type || "",
    deliveryInstruction: parcel.delivery_instruction || "",
    vendorId: parcel.vendor_id,
    vendorName,
    vendorLocation: parcel.vendors?.pickup_landmark || "",
    // Resolved sticker print size (vendor's own override, or the app
    // default) - see printLabels.ts on the client.
    labelWidthMm: labelSize.widthMm,
    labelHeightMm: labelSize.heightMm,
    riderName: rider?.name || "",
    remarks: stripCarrierStaffTag(parcel.parcel_remarks[0]?.remark || "").text,
    // The stage the parcel was in right before it was cancelled - only
    // meaningful when that's what the latest history row actually records
    // (a still-cancelled parcel's newest entry is always its cancellation,
    // since restoring or advancing it would write a newer one over it).
    cancelledFromStatus:
      parcel.status === "cancelled" && latestHistory?.new_status === "cancelled"
        ? latestHistory.old_status
        : undefined,
    // Vendor-declared eligibility at creation, plus the actual outcome once a
    // rider/admin marks the parcel partially_delivered (both null/false until then).
    allowPartialDelivery: parcel.allow_partial_delivery,
    partialDeliveryRemarks: parcel.partial_delivery_remarks || null,
    partialCodCollected:
      parcel.partial_cod_collected === null ? null : Number(parcel.partial_cod_collected),
    // Set only on an auto-created return leg — points back at the exchange
    // order it was generated from (see order_type "exchange" + exchangeReturnReceived).
    sourceOrderId: parcel.source_order_id,
    lastUpdatedBy,
    // Full timestamp (not just the day) so the UI can show the time alongside
    // the date; date-only consumers still render fine via toBsDate().
    lastUpdatedAt: (latestHistory?.created_at || parcel.updated_at).toISOString(),
    createdAt: formatDate(parcel.created_at),
    createdAtRaw: parcel.created_at.toISOString(),
    // Kept as its own field: the export column predates statusTimestamps and
    // several sheets reference it directly.
    arrivedAtOrigin: statusTimestampsByParcelId?.get(parcel.id)?.arrived ?? "",
    // Every stage this parcel has reached, keyed by status. Empty object rather
    // than undefined for export callers so a column lookup never has to guard.
    ...(statusTimestampsByParcelId
      ? { statusTimestamps: statusTimestampsByParcelId.get(parcel.id) ?? {} }
      : {}),
    deliveredAt: parcel.delivered_at ? formatDate(parcel.delivered_at) : "",
  };
}

/** parcel id → { status: ISO timestamp it first entered that status }. */
export type StatusTimestampMap = Map<string, Record<string, string>>;

// Batch-fetches, for each parcel, the moment it entered every status it has
// ever held - one indexed query for the whole page. Used only by the export
// path so the regular list/table queries stay lean.
//
// Timestamps are full ISO, not formatDate's Nepal-local day: the export renders
// them through toBsDateTime, which can only show a time if one survives the
// trip. Read solely by export columns, so no date-only consumer breaks.
//
// A status can repeat (a redelivery re-enters sent_for_delivery, a second
// attempt re-enters failed_delivery). The *first* entry is recorded, matching
// how the arrival column has always behaved - "when did this parcel reach that
// stage", not "when did it last bounce off it".
async function fetchStatusTimestampMap(parcelIds: string[]): Promise<StatusTimestampMap> {
  const map: StatusTimestampMap = new Map();
  if (parcelIds.length === 0) return map;
  const rows = await prisma.parcel_status_history.findMany({
    where: { parcel_id: { in: parcelIds } },
    select: { parcel_id: true, new_status: true, created_at: true },
    orderBy: { created_at: "asc" },
  });
  // asc order → the first row seen for a (parcel, status) pair is its earliest.
  for (const row of rows) {
    if (!row.new_status) continue;
    let byStatus = map.get(row.parcel_id);
    if (!byStatus) {
      byStatus = {};
      map.set(row.parcel_id, byStatus);
    }
    if (!byStatus[row.new_status]) byStatus[row.new_status] = row.created_at.toISOString();
  }
  return map;
}

// Allow-listed so a client can only sort by a column that's actually indexed
// or cheap to sort, never an arbitrary/unindexed field.
// "createdAt" maps to order_number, not created_at: the column is
// timestamptz(6) but JS Dates only carry milliseconds, so a created_at keyset
// cursor would be lossy and could skip rows sharing a millisecond. The
// autoincrement order_number has identical ordering semantics and round-trips
// exactly through a cursor.
const ORDER_SORT_COLUMNS = {
  createdAt: "order_number",
  codAmount: "cod_amount",
  deliveryCharge: "delivery_charge",
  trackingId: "tracking_id",
  status: "status",
} as const satisfies Record<OrderSortField, keyof Prisma.parcelsOrderByWithRelationInput>;

type OrderSortColumn = (typeof ORDER_SORT_COLUMNS)[OrderSortField];
type SortDirection = "asc" | "desc";

function resolveSortColumn(query: ListOrdersQuery): OrderSortColumn {
  return query.sortBy ? ORDER_SORT_COLUMNS[query.sortBy] : "order_number";
}

// The id tiebreaker makes the sort total, so keyset cursors are unambiguous
// even when the sort column has duplicate values.
function buildOrdersOrderBy(
  column: OrderSortColumn,
  direction: SortDirection,
): Prisma.parcelsOrderByWithRelationInput[] {
  // Cast: TS widens a computed union key to an index signature, but column is
  // allow-listed via ORDER_SORT_COLUMNS so the shape is guaranteed valid.
  return [{ [column]: direction } as Prisma.parcelsOrderByWithRelationInput, { id: direction }];
}

// ── Keyset (cursor) pagination ───────────────────────────────────────────────
// OFFSET pagination reads and discards every skipped row (page 500 scans 5 000
// rows) and skips/duplicates rows when data shifts between requests. A keyset
// cursor instead pins the boundary row's (sort value, id) and each page seeks
// straight to it through the index.

interface OrdersCursor {
  // Sort-column value serialized as a string (exact for ints, decimals,
  // strings and enum labels - see ORDER_SORT_COLUMNS for why timestamps are
  // never used here).
  v: string;
  id: string;
}

function encodeOrdersCursor(cursor: OrdersCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

// Malformed or tampered cursors degrade to "no cursor" (first page), never a 500.
function decodeOrdersCursor(raw: string | undefined): OrdersCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (parsed && typeof parsed.v === "string" && typeof parsed.id === "string") {
      return { v: parsed.v, id: parsed.id };
    }
  } catch {
    // fall through
  }
  return null;
}

function serializeSortValue(
  parcel: { order_number: number; cod_amount: Prisma.Decimal; delivery_charge: Prisma.Decimal; tracking_id: string; status: parcel_status },
  column: OrderSortColumn,
): string {
  switch (column) {
    case "order_number":
      return String(parcel.order_number);
    case "cod_amount":
      return parcel.cod_amount.toString();
    case "delivery_charge":
      return parcel.delivery_charge.toString();
    case "tracking_id":
      return parcel.tracking_id;
    case "status":
      return parcel.status;
  }
}

// Postgres orders enum columns by their definition order, which the generated
// parcel_status object preserves - so "values after X" is a slice of this list.
const STATUS_ENUM_ORDER = Object.values(parcel_status);

// Row-value comparison expanded for Prisma: (col, id) > (v, id) becomes
// col > v OR (col = v AND id > id). Returns null when the cursor value can't
// be interpreted for this column (e.g. sort changed since it was issued).
function buildKeysetCondition(
  column: OrderSortColumn,
  direction: SortDirection,
  cursor: OrdersCursor,
): Prisma.parcelsWhereInput | null {
  const idTie: Prisma.parcelsWhereInput =
    direction === "asc" ? { id: { gt: cursor.id } } : { id: { lt: cursor.id } };

  if (column === "status") {
    const index = STATUS_ENUM_ORDER.indexOf(cursor.v as parcel_status);
    if (index === -1) return null;
    const beyond =
      direction === "asc"
        ? STATUS_ENUM_ORDER.slice(index + 1)
        : STATUS_ENUM_ORDER.slice(0, index);
    return {
      OR: [
        ...(beyond.length ? [{ status: { in: beyond } }] : []),
        { AND: [{ status: cursor.v as parcel_status }, idTie] },
      ],
    };
  }

  let value: number | string;
  if (column === "order_number") {
    value = Number(cursor.v);
    if (!Number.isSafeInteger(value)) return null;
  } else if (column === "cod_amount" || column === "delivery_charge") {
    // Decimal columns accept their exact string form, but reject anything
    // non-numeric (e.g. a stale cursor issued under a different sort).
    if (!/^-?\d+(\.\d+)?$/.test(cursor.v)) return null;
    value = cursor.v;
  } else {
    value = cursor.v;
  }

  // Casts: TS widens computed union keys to index signatures; column is
  // allow-listed via ORDER_SORT_COLUMNS so the shapes are guaranteed valid.
  const strict = {
    [column]: direction === "asc" ? { gt: value } : { lt: value },
  } as Prisma.parcelsWhereInput;
  const equal = { [column]: value } as Prisma.parcelsWhereInput;

  return {
    OR: [strict, { AND: [equal, idTie] }],
  };
}

export async function listOrders(
  actor: OrderActor,
  query: ListOrdersQuery = {},
): Promise<ListOrdersResult> {
  const { vendorId, vendorIds, riderId, branchLocationIds } = await getActorScope(actor);
  const isStaff = actor.roles.includes("super_admin") || actor.roles.includes("admin");
  // Own-vendor scope is set only for vendor / vendor_staff actors - never for
  // staff, sales or riders viewing the same parcels.
  const isOwnVendorViewer = !!vendorId;
  const where = buildOrdersWhere({ vendorId, vendorIds, riderId, branchLocationIds }, query);
  const sortColumn = resolveSortColumn(query);
  const sortDirection: SortDirection = query.sortDir === "asc" ? "asc" : "desc";
  const orderBy = buildOrdersOrderBy(sortColumn, sortDirection);

  // Pagination only kicks in when the caller explicitly asks for it, so
  // existing callers that expect a flat array keep working unchanged.
  const paginated =
    query.page !== undefined || query.pageSize !== undefined ||
    query.cursor !== undefined || query.dir !== undefined;

  // Most pages (OrderManagement, DispatchOperations, PickupOperations, ...)
  // call listOrders() with no filters at all and reload on every status-change
  // event - that's the only shape worth caching, since filtered/paginated
  // queries have too many distinct combinations to get useful hit rates.
  // Sales scope (vendorIds) is per-account and would collide with the shared
  // global cache key, so those queries skip the cache. A custom sort isn't
  // encoded in the cache key either, so it also has to skip the cache.
  // `trashed` is excluded too: it isn't part of the cache key, so without this
  // a trash listing would both read and overwrite the live orders cache.
  const isDefaultUnfilteredQuery =
    !paginated && !query.status?.length && !query.orderType && !query.search &&
    !query.vendorId?.length && !query.salesUserId && !query.deliveryRiderId &&
    !query.sortBy && !query.deliveredToday && !query.trashed && !query.settlement &&
    !query.originLocationIds?.length && !query.destinationLocationIds?.length &&
    !query.branchSettlement && vendorIds === undefined && branchLocationIds === undefined;
  // Export requests (withArrival) skip the shared cache so the enriched rows
  // never pollute the lean list cache and vice-versa.
  const cacheKey =
    isDefaultUnfilteredQuery && !query.withArrival ? ordersListCacheKey(vendorId, riderId) : null;

  if (cacheKey) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error("[Redis] Failed to read orders list cache:", error);
    }
  }

  if (!paginated) {
    const DEFAULT_LIST_CAP = 200;
    const [total, parcels] = await Promise.all([
      prisma.parcels.count({ where }),
      prisma.parcels.findMany({
        where,
        include: ORDERS_INCLUDE,
        orderBy,
        take: DEFAULT_LIST_CAP,
      }),
    ]);
    const statusTimestamps = query.withArrival
      ? await fetchStatusTimestampMap(parcels.map((p) => p.id))
      : undefined;
    const result: ListOrdersResult = {
      data: parcels.map((p) => mapOrder(p, isStaff, isOwnVendorViewer, statusTimestamps)),
      meta: {
        page: 1,
        pageSize: DEFAULT_LIST_CAP,
        total,
        totalPages: Math.max(1, Math.ceil(total / DEFAULT_LIST_CAP)),
        truncated: total > DEFAULT_LIST_CAP,
      },
    };

    if (cacheKey) {
      try {
        await redis.setex(cacheKey, ORDERS_LIST_TTL_SECONDS, JSON.stringify(result));
      } catch (error) {
        console.error("[Redis] Failed to write orders list cache:", error);
      }
    }

    return result;
  }

  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize || DEFAULT_PAGE_SIZE));
  const dir: "next" | "prev" = query.dir === "prev" ? "prev" : "next";
  const cursor = decodeOrdersCursor(query.cursor);

  // Walking backwards ("prev") flips the sort for the fetch and un-flips the
  // rows afterwards; "prev with no cursor" means jump to the last page.
  const fetchDirection: SortDirection =
    dir === "prev" ? (sortDirection === "asc" ? "desc" : "asc") : sortDirection;
  const fetchOrderBy = buildOrdersOrderBy(sortColumn, fetchDirection);

  const keysetCondition = cursor
    ? buildKeysetCondition(sortColumn, fetchDirection, cursor)
    : null;
  const effectiveCursor = keysetCondition ? cursor : null;
  const keysetWhere: Prisma.parcelsWhereInput = keysetCondition
    ? { AND: [where, keysetCondition] }
    : where;

  let total: number;
  let parcels: Prisma.parcelsGetPayload<{ include: typeof ORDERS_INCLUDE }>[];
  let hasMore: boolean;

  if (dir === "prev" && !effectiveCursor) {
    // Last-page jump: fetch from the end, sized so page boundaries stay
    // aligned with forward navigation (needs the count first).
    total = await prisma.parcels.count({ where });
    const lastPageSize = total % pageSize || pageSize;
    parcels = await prisma.parcels.findMany({
      where: keysetWhere,
      include: ORDERS_INCLUDE,
      orderBy: fetchOrderBy,
      take: lastPageSize,
    });
    hasMore = total > parcels.length;
  } else {
    // Fetch one extra row purely to learn whether another page exists.
    [total, parcels] = await Promise.all([
      prisma.parcels.count({ where }),
      prisma.parcels.findMany({
        where: keysetWhere,
        include: ORDERS_INCLUDE,
        orderBy: fetchOrderBy,
        take: pageSize + 1,
      }),
    ]);
    hasMore = parcels.length > pageSize;
    if (hasMore) parcels = parcels.slice(0, pageSize);
  }

  if (fetchDirection !== sortDirection) parcels.reverse();

  const hasNextPage = dir === "next" ? hasMore : effectiveCursor !== null;
  const hasPrevPage = dir === "prev" ? hasMore : effectiveCursor !== null;

  const firstRow = parcels[0];
  const lastRow = parcels[parcels.length - 1];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageHint =
    dir === "prev" && !effectiveCursor
      ? totalPages
      : Math.min(totalPages, Math.max(1, query.page || 1));

  // Same enrichment the unpaginated branch does. Without it `withArrival` was
  // silently ignored on every paginated request - which is all of them from
  // the overview export - and "Arrived at Origin" came back empty for rows
  // that had plainly arrived.
  const keysetStatusTimestamps = query.withArrival
    ? await fetchStatusTimestampMap(parcels.map((p) => p.id))
    : undefined;

  return {
    data: parcels.map((p) => mapOrder(p, isStaff, isOwnVendorViewer, keysetStatusTimestamps)),
    meta: {
      page: pageHint,
      pageSize,
      total,
      totalPages,
      hasNextPage,
      hasPrevPage,
      nextCursor:
        hasNextPage && lastRow
          ? encodeOrdersCursor({ v: serializeSortValue(lastRow, sortColumn), id: lastRow.id })
          : null,
      prevCursor:
        hasPrevPage && firstRow
          ? encodeOrdersCursor({ v: serializeSortValue(firstRow, sortColumn), id: firstRow.id })
          : null,
    },
  };
}

// ── Rider run sheet ───────────────────────────────────────────────────────────
// Run sheets are persisted hand-off records (see createRunSheet): one sheet per
// batch of parcels sent out for delivery with a rider. This lists the sheets
// for one Nepal-local day, with delivery progress read off the member parcels.

// The parcel shape every hand-off document needs: who it goes to, where, how
// heavy, how much cash. Shared by the run sheet (delivery leg) and the return
// manifest (RTO leg) - both list the same columns for the same reason, so they
// read the same rows rather than each growing their own near-copy.
export const HANDOVER_PARCEL_INCLUDE = {
  parties_parcels_receiver_idToparties: true,
  locations_parcels_destination_location_idTolocations: true,
  vendors: true,
  // Newest remark only. The hand-over sheet prints it in the Remarks column, so
  // whoever signs for the parcel reads the same note the ops list shows - see
  // mapOrder, which takes the latest the same way.
  parcel_remarks: {
    orderBy: { created_at: "desc" as const },
    take: 1,
  },
} satisfies Prisma.parcelsInclude;

type HandoverParcel = Prisma.parcelsGetPayload<{ include: typeof HANDOVER_PARCEL_INCLUDE }>;

export function mapHandoverParcel(parcel: HandoverParcel) {
  const receiver = parcel.parties_parcels_receiver_idToparties;
  return {
    id: parcel.id,
    orderNumber: parcel.order_number,
    trackingId: parcel.tracking_id,
    status: parcel.status,
    receiverName: receiver.name,
    receiverPhone: receiver.phone,
    address:
      receiver.address ||
      locationName(parcel.locations_parcels_destination_location_idTolocations) ||
      "",
    destination:
      locationName(parcel.locations_parcels_destination_location_idTolocations) ||
      receiver.address ||
      "",
    pieces: parcel.pieces,
    weightKg: parcel.weight_kg === null ? undefined : Number(parcel.weight_kg),
    codAmount: Number(parcel.cod_amount),
    vendorName: parcel.vendors?.business_name || parcel.vendors?.client_name || "",
    // The carrier-staff tag is internal bookkeeping (see utils/carrierRemark):
    // it marks an inbound comment's origin and must never reach a printed sheet.
    remarks: stripCarrierStaffTag(parcel.parcel_remarks[0]?.remark || "").text,
    deliveryInstruction: parcel.delivery_instruction || "",
    deliveredAt: parcel.delivered_at ? parcel.delivered_at.toISOString() : null,
  };
}

export type HandoverParcelDto = ReturnType<typeof mapHandoverParcel>;

const DAY_MS = 24 * 60 * 60 * 1000;

// Today's calendar date in Nepal local time (YYYY-MM-DD).
function nepalToday(): string {
  return new Date(Date.now() + NEPAL_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

// UTC instant range covering one Nepal-local calendar day.
function nepalDayWindow(date: string) {
  const start = new Date(Date.parse(`${date}T00:00:00Z`) - NEPAL_UTC_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export async function getRiderRunSheet(
  actor: OrderActor,
  query: { riderId?: string; date?: string } = {},
) {
  const date = query.date || nepalToday();
  const { start, end } = nepalDayWindow(date);
  if (Number.isNaN(start.getTime())) {
    throw new AppError(400, "Invalid date");
  }

  const adminBranchIds = await getAdminBranchScope(actor);

  const sheets = await prisma.run_sheets.findMany({
    where: {
      created_at: { gte: start, lt: end },
      ...(query.riderId ? { rider_id: query.riderId } : {}),
      ...(adminBranchIds ? { riders: { location_id: { in: adminBranchIds } } } : {}),
    },
    include: {
      riders: { include: { locations: true } },
      run_sheet_parcels: {
        include: { parcels: { include: HANDOVER_PARCEL_INCLUDE } },
        orderBy: { created_at: "asc" },
      },
    },
    orderBy: { created_at: "desc" },
    // Safety valve only - one day of hand-offs is inherently small.
    take: 500,
  });

  const mapped = sheets.map((sheet) => {
    const parcels = sheet.run_sheet_parcels.map((link) => mapHandoverParcel(link.parcels));
    const delivered = parcels.filter((p) => p.status === "delivered" || p.status === "partially_delivered");
    // Latest movement on the sheet = the newest status change among its parcels.
    const lastParcelUpdate = sheet.run_sheet_parcels.reduce<Date | null>(
      (latest, link) =>
        !latest || link.parcels.updated_at > latest ? link.parcels.updated_at : latest,
      null,
    );

    return {
      id: sheet.id,
      sheetNo: sheet.sheet_no,
      rider: {
        id: sheet.riders.id,
        name: sheet.riders.name,
        phone: sheet.riders.phone,
        vehicleNo: sheet.riders.vehicle_no || "",
        hub: sheet.riders.locations?.name || sheet.riders.rider_location || "",
      },
      createdAt: sheet.created_at.toISOString(),
      updatedAt: (lastParcelUpdate && lastParcelUpdate > sheet.created_at
        ? lastParcelUpdate
        : sheet.created_at
      ).toISOString(),
      totalItems: parcels.length,
      deliveredItems: delivered.length,
      failedItems: parcels.filter((p) => p.status === "failed_delivery").length,
      outItems: parcels.filter((p) => p.status === "sent_for_delivery").length,
      totalCod: parcels.reduce((sum, p) => sum + p.codAmount, 0),
      codCollected: delivered.reduce((sum, p) => sum + p.codAmount, 0),
      parcels,
    };
  });

  return {
    date,
    summary: {
      totalSheets: mapped.length,
      totalItems: mapped.reduce((sum, s) => sum + s.totalItems, 0),
      deliveredItems: mapped.reduce((sum, s) => sum + s.deliveredItems, 0),
      outItems: mapped.reduce((sum, s) => sum + s.outItems, 0),
      totalCod: mapped.reduce((sum, s) => sum + s.totalCod, 0),
    },
    sheets: mapped,
  };
}
