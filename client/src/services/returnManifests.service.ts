import api from '../utils/api';

/**
 * A vendor's return (RTO) hand-over batch.
 *
 * `open` is the only state that accepts parcels, and a vendor may hold only one
 * at a time — returns for that vendor accumulate into it across days. `sent`
 * means a rider is carrying them (every member parcel is at sent_to_vendor);
 * `received` means the vendor signed for them (returned_to_vendor).
 */
export type ReturnManifestStatus = 'open' | 'sent' | 'received';

export const RETURN_MANIFEST_STATUS_LABELS: Record<ReturnManifestStatus, string> = {
  open: 'Open',
  sent: 'Sent to vendor',
  received: 'Received',
};

/** Manifests whose membership the parcel tables still badge. */
export const LIVE_RETURN_MANIFEST_STATUSES: ReturnManifestStatus[] = ['open', 'sent'];

/** Mirrors MAX_MANIFEST_PARCELS on the server — pinned to its bulk-status ceiling. */
export const MAX_MANIFEST_PARCELS = 200;

export interface ReturnManifest {
  id: string;
  manifestNo: string;
  vendorId: string;
  vendorName: string;
  vendorPhone: string;
  status: ReturnManifestStatus;
  riderId: string | null;
  riderName: string;
  riderPhone: string;
  riderVehicleNo: string;
  parcelCount: number;
  remarks: string;
  createdBy: string;
  sentBy: string;
  receivedBy: string;
  sentAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Member parcel ids. Only sent for `open`/`sent` manifests by the list endpoint. */
  parcelIds?: string[];
}

/** One member parcel, as the manifest detail lists it. */
export interface ReturnManifestParcel {
  id: string;
  orderNumber: number;
  trackingId: string;
  status: string;
  receiverName: string;
  receiverPhone: string;
  address: string;
  destination: string;
  pieces: number;
  weightKg?: number;
  codAmount: number;
  vendorName: string;
  /** Latest remark on the parcel, printed in the sheet's Remarks column. */
  remarks: string;
}

export interface ReturnManifestDetail extends ReturnManifest {
  parcels: ReturnManifestParcel[];
  totalCod: number;
}

/** Why a selected parcel could not join the manifest, named by tracking id. */
export interface RejectedManifestParcel {
  parcelId: string;
  trackingId: string;
  reason: string;
}

export interface AddManifestParcelsResult {
  added: number;
  alreadyOnManifest: number;
  rejected: RejectedManifestParcel[];
  manifest: ReturnManifestDetail;
}

/** A member left behind because its status had moved on since it was added. */
export interface SkippedManifestParcel {
  trackingId: string;
  status: string;
}

export interface AdvanceManifestResult {
  updatedCount: number;
  skipped: SkippedManifestParcel[];
  manifest: ReturnManifestDetail;
}

export interface ListReturnManifestsParams {
  status?: ReturnManifestStatus;
  vendorId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortDir?: 'asc' | 'desc';
}

export interface ReturnManifestsListResponse {
  success: boolean;
  data: ReturnManifest[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export const getReturnManifests = async (
  params?: ListReturnManifestsParams,
): Promise<ReturnManifestsListResponse> => {
  const query: Record<string, string> = {};
  if (params?.status) query.status = params.status;
  if (params?.vendorId) query.vendorId = params.vendorId;
  if (params?.search) query.search = params.search;
  if (params?.page) query.page = String(params.page);
  if (params?.pageSize) query.pageSize = String(params.pageSize);
  if (params?.sortDir) query.sortDir = params.sortDir;

  const response = await api.get('/return-manifests', { params: query });
  return response.data;
};

/** The vendor's open manifest, or null. Asked before offering to create one. */
export const getOpenReturnManifest = async (
  vendorId: string,
): Promise<{ success: boolean; data: ReturnManifest | null }> => {
  const response = await api.get('/return-manifests/open', { params: { vendorId } });
  return response.data;
};

export const getReturnManifest = async (
  id: string,
): Promise<{ success: boolean; data: ReturnManifestDetail }> => {
  const response = await api.get(`/return-manifests/${id}`);
  return response.data;
};

export const createReturnManifest = async (
  vendorId: string,
  remarks?: string,
): Promise<{ success: boolean; data: ReturnManifest }> => {
  const response = await api.post('/return-manifests', { vendorId, ...(remarks ? { remarks } : {}) });
  return response.data;
};

export const addParcelsToReturnManifest = async (
  manifestId: string,
  parcelIds: string[],
): Promise<{ success: boolean; message: string; data: AddManifestParcelsResult }> => {
  const response = await api.post(`/return-manifests/${manifestId}/parcels`, { parcelIds });
  return response.data;
};

export const removeParcelFromReturnManifest = async (
  manifestId: string,
  parcelId: string,
): Promise<{ success: boolean; data: ReturnManifestDetail }> => {
  const response = await api.delete(`/return-manifests/${manifestId}/parcels/${parcelId}`);
  return response.data;
};

export const sendReturnManifest = async (
  manifestId: string,
  riderId: string,
): Promise<{ success: boolean; data: AdvanceManifestResult }> => {
  const response = await api.post(`/return-manifests/${manifestId}/send`, { riderId });
  return response.data;
};

export const receiveReturnManifest = async (
  manifestId: string,
): Promise<{ success: boolean; data: AdvanceManifestResult }> => {
  const response = await api.post(`/return-manifests/${manifestId}/receive`, {});
  return response.data;
};
