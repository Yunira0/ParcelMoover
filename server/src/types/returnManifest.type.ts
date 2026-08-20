/**
 * A vendor's return (RTO) hand-over batch.
 *
 * `open` accumulates parcels; `sent` means the rider has them and every member
 * parcel is at sent_to_vendor; `received` means the vendor signed for them and
 * every member is at returned_to_vendor. Only `open` accepts additions, and a
 * vendor may hold only one `open` manifest at a time - see the partial unique
 * index in 20260819120000_add_return_manifests.
 */
export type ReturnManifestStatus = "open" | "sent" | "received";

/**
 * Statuses whose membership the client still cares about, so the parcel rows on
 * Return Operations can show which manifest they are on. `received` is excluded
 * deliberately: that set only ever grows, and a closed hand-over is history.
 */
export const LIVE_MANIFEST_STATUSES: ReturnManifestStatus[] = ["open", "sent"];

/**
 * Ceiling on manifest membership, pinned to MAX_BULK_IDS in order.service.
 *
 * Send and receive fan out into a single bulkUpdateParcelStatus call so the
 * parcels and the manifest row move in one transaction. Letting a manifest grow
 * past that cap would mean chunking, and a chunked send that fails halfway
 * leaves a manifest neither open nor sent with no state to describe it. Two
 * manifests for one busy vendor-day is the cheaper answer.
 */
export const MAX_MANIFEST_PARCELS = 200;

export interface CreateReturnManifestInput {
  vendorId: string;
  remarks?: string;
}

export interface AddManifestParcelsInput {
  parcelIds: string[];
}

export interface SendReturnManifestInput {
  riderId: string;
  remarks?: string;
}

export interface ReceiveReturnManifestInput {
  remarks?: string;
}

export interface ListReturnManifestsParams {
  status?: ReturnManifestStatus;
  vendorId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortDir?: "asc" | "desc";
}
