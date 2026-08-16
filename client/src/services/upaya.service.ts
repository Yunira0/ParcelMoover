import api from '../utils/api';

export interface UpayaHandoffResultItem {
  parcelId: string;
  trackingId: string;
  success: boolean;
  upayaOrderId?: string;
  alreadyHandedOff?: boolean;
  area?: string;
  error?: string;
}

export interface UpayaParcelInfo {
  handedOff: boolean;
  upayaOrderId?: string;
  lastStatus?: string;
}

// area_id and service_type_id are both auto-derived server-side per parcel
// (see matchUpayaArea / defaultUpayaServiceTypeId in upaya.service.ts) —
// same as NCM's handoff, which auto-matches a branch instead of taking one
// from the caller.
export const handoffParcelsToUpaya = async (
  parcelIds: string[],
): Promise<{ success: boolean; message: string; data: UpayaHandoffResultItem[] }> => {
  const response = await api.post('/upaya/handoff', { parcelIds });
  return response.data;
};

export const getUpayaParcelInfo = async (parcelId: string): Promise<{ success: boolean; data: UpayaParcelInfo }> => {
  const response = await api.get(`/upaya/parcels/${parcelId}`);
  return response.data;
};
