import api from '../utils/api';

export interface VendorVolumeSettings {
  highVolumeDailyParcels: number;
}

export const getVendorVolumeSettings = async (): Promise<{ success: boolean; data: VendorVolumeSettings }> => {
  const response = await api.get('/vendor-volume/settings');
  return response.data;
};

export const updateVendorVolumeSettings = async (highVolumeDailyParcels: number) => {
  const response = await api.put('/vendor-volume/settings', { highVolumeDailyParcels });
  return response.data;
};
