import api from '../utils/api';

/**
 * Transit hand-over batch — the transit counterpart of the return manifest.
 *
 * Frontend scaffold only: the /transit-manifests endpoints don't exist yet.
 * TODO(backend): transit_manifests + transit_manifest_parcels models, a
 * migration, routes/controllers/service, and the two status transitions:
 *   addParcels → members move  oov → dispatched          (admin scans out)
 *   receive    → members move  dispatched → arrived_at_branch (branch scans in)
 */

export type TransitManifestStatus = 'open' | 'dispatched' | 'received';

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

export interface TransitScanResult {
  updated: number;
  rejected: RejectedTransitParcel[];
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

/** Admin: scan `oov` parcels onto the manifest — they move to `dispatched`. */
export const addParcelsToTransitManifest = async (
  id: string,
  trackingIds: string[],
): Promise<{ success: boolean; message: string; data: TransitScanResult }> => {
  const res = await api.post(`/transit-manifests/${id}/parcels`, { trackingIds });
  return res.data;
};

/** Branch: scan the manifest's parcels to receive them — they move to `arrived_at_branch`. */
export const receiveTransitManifestParcels = async (
  id: string,
  trackingIds: string[],
): Promise<{ success: boolean; message: string; data: TransitScanResult }> => {
  const res = await api.post(`/transit-manifests/${id}/receive`, { trackingIds });
  return res.data;
};
