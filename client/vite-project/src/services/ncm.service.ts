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
  error?: string;
}

export const getNcmBranches = async (): Promise<{ success: boolean; data: NcmBranch[] }> => {
  const response = await api.get('/ncm/branches');
  return response.data;
};

export const handoffToNcm = async (
  parcelIds: string[],
  branch: string,
): Promise<{ success: boolean; message: string; data: NcmHandoffResult[] }> => {
  const response = await api.post('/ncm/handoff', { parcelIds, branch });
  return response.data;
};
