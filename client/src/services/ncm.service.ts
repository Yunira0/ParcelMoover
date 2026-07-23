import api from '../utils/api';

// NCM (Nepal Can Move) — the 3PL that carries outside-valley parcels.

export interface NcmBranch {
  name: string;
  code?: string;
  district?: string;
  region?: string;
}

export interface NcmHandoffResult {
  parcelId: string;
  trackingId: string;
  success: boolean;
  ncmOrderId?: number;
  alreadyHandedOff?: boolean;
  branch?: string;
  error?: string;
}

export const handoffToNcm = async (
  parcelIds: string[],
): Promise<{ success: boolean; message: string; data: NcmHandoffResult[] }> => {
  const response = await api.post('/ncm/handoff', { parcelIds });
  return response.data;
};
