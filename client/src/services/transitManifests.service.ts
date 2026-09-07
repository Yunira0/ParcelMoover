import api from '../utils/api';

/**
 * Transit hand-over batch — the transit counterpart of the return manifest.
 *
 * Lifecycle: open (parcels are staged on it and stay in Transit, so they can
 * still be taken back off) → dispatched (the truck leaves: every member moves
 * oov → dispatched) → received (members move dispatched → arrived_at_branch as
 * the destination branch scans them in).
 */

export type TransitManifestStatus = 'open' | 'dispatched' | 'received';

/** Kept in sync with server/src/types/transitManifest.type.ts's ceiling. */
export const MAX_TRANSIT_MANIFEST_PARCELS = 200;

export const TRANSIT_MANIFEST_STATUS_LABELS: Record<TransitManifestStatus, string> = {
  open: 'Open',
  dispatched: 'In transit',
  received: 'Received',
};

export interface TransitManifest {
  id: string;
  manifestNo: string;
  status: TransitManifestStatus;
  fromHub: string;
  toHub: string;
  parcelCount: number;
  remarks: string;
  createdAt: string;
  updatedAt: string;
  /** Member parcel ids. Only sent for live (non-received) manifests by the list endpoint. */
  parcelIds?: string[];
}

export interface TransitManifestParcel {
  id: string;
  orderNumber: number;
  trackingId: string;
  status: string;
  receiverName: string;
  destination: string;
  codAmount: number;
}

export interface TransitManifestDetail extends TransitManifest {
  parcels: TransitManifestParcel[];
}

export interface RejectedTransitParcel {
  trackingId: string;
  reason: string;
}

/** Adding stages parcels; nothing moves until the manifest is dispatched. */
export interface TransitAddResult {
  added: number;
  alreadyOnManifest: number;
  rejected: RejectedTransitParcel[];
  manifest: TransitManifestDetail;
}

export interface TransitScanResult {
  updated: number;
  rejected: RejectedTransitParcel[];
  manifest: TransitManifestDetail;
}

export interface TransitDispatchResult {
  updated: number;
  skipped: { trackingId: string; status: string }[];
  manifest: TransitManifestDetail;
}

export const getTransitManifests = async (): Promise<{ success: boolean; data: TransitManifest[] }> => {
  const res = await api.get('/transit-manifests');
  return res.data;
};

export const getTransitManifest = async (
  id: string,
): Promise<{ success: boolean; data: TransitManifestDetail }> => {
  const res = await api.get(`/transit-manifests/${id}`);
  return res.data;
};

export const createTransitManifest = async (
  input: { fromHub?: string; toHub?: string; remarks?: string } = {},
): Promise<{ success: boolean; data: TransitManifest }> => {
  const res = await api.post('/transit-manifests', input);
  return res.data;
};

/**
 * Stage `oov` parcels onto an open manifest, by scan or by table selection.
 * They stay in Transit — dispatchTransitManifest is what puts them on the road.
 */
export const addParcelsToTransitManifest = async (
  id: string,
  input: { trackingIds?: string[]; parcelIds?: string[] },
): Promise<{ success: boolean; message: string; data: TransitAddResult }> => {
  const res = await api.post(`/transit-manifests/${id}/parcels`, input);
  return res.data;
};

export interface StageToBranchResult {
  added: number;
  alreadyOnManifest: number;
  rejected: RejectedTransitParcel[];
  manifestNos: string[];
}

/**
 * The "Via Manifest" action: pick a destination branch, not a manifest.
 * Reuses a free open manifest heading there (per origin hub) or opens one,
 * and rejects any order whose destination the branch doesn't cover.
 */
export const addOrdersToBranchManifest = async (
  parcelIds: string[],
  toBranchId: string,
): Promise<{ success: boolean; message: string; data: StageToBranchResult }> => {
  const res = await api.post('/transit-manifests/stage', { parcelIds, toBranchId });
  return res.data;
};

/** Delete an empty open manifest (opened by mistake). Refused once it holds
 *  orders or has ever left - remove its orders first if it still has any. */
export const deleteTransitManifest = async (
  id: string,
): Promise<{ success: boolean; message: string }> => {
  const res = await api.delete(`/transit-manifests/${id}`);
  return res.data;
};

/** Take one order back off an open manifest. Its status is untouched. */
export const removeParcelFromTransitManifest = async (
  id: string,
  parcelId: string,
): Promise<{ success: boolean; data: TransitManifestDetail }> => {
  const res = await api.delete(`/transit-manifests/${id}/parcels/${parcelId}`);
  return res.data;
};

/** The truck leaves: every member still in Transit moves to `dispatched`. */
export const dispatchTransitManifest = async (
  id: string,
): Promise<{ success: boolean; message: string; data: TransitDispatchResult }> => {
  const res = await api.post(`/transit-manifests/${id}/dispatch`, {});
  return res.data;
};

/** Branch: scan the manifest's parcels to receive them — they move to `arrived_at_branch`. */
export const receiveTransitManifestParcels = async (
  id: string,
  input: { trackingIds?: string[]; parcelIds?: string[] },
): Promise<{ success: boolean; message: string; data: TransitScanResult }> => {
  const res = await api.post(`/transit-manifests/${id}/receive`, input);
  return res.data;
};
