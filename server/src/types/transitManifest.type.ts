/**
 * A hub-to-hub (transit) hand-over batch.
 *
 * `open` accumulates oov parcels; the first successful scan dispatches the
 * manifest (every member parcel moves to dispatched). `dispatched` keeps
 * accepting scans while the truck is being loaded. `received` is terminal:
 * no member is still dispatched because the destination branch scanned them
 * all in to arrived_at_branch.
 *
 * Unlike the return leg this groups by route (origin hub → destination hub),
 * not by vendor - one truck carries many vendors' parcels - so several open
 * manifests may exist for the same route at once.
 */
export type TransitManifestStatus = "open" | "dispatched" | "received";

/**
 * Manifests the Transit Operations tabs still care about. `received` is
 * excluded deliberately: that set only ever grows, and a closed hand-over is
 * history.
 */
export const LIVE_TRANSIT_MANIFEST_STATUSES: TransitManifestStatus[] = ["open", "dispatched"];

/**
 * Ceiling on manifest membership, pinned to MAX_BULK_IDS in order.service.
 *
 * Dispatch and receive fan out into bulkUpdateParcelStatus calls so the
 * parcels and the manifest row move together. Letting a manifest grow past
 * that cap would mean chunking, and a chunked dispatch that fails halfway
 * leaves a manifest neither open nor dispatched with no state to describe it.
 * Two manifests for one busy shift is the cheaper answer.
 */
export const MAX_TRANSIT_MANIFEST_PARCELS = 200;

export interface CreateTransitManifestInput {
  fromHub: string;
  toHub: string;
  remarks?: string;
}

export interface TransitScanInput {
  trackingIds: string[];
}

export interface ListTransitManifestsParams {
  status?: TransitManifestStatus;
  search?: string;
  page?: number;
  pageSize?: number;
  sortDir?: "asc" | "desc";
}
