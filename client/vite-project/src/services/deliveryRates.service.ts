import api from '../utils/api';

export interface DeliveryRate {
  id: string;
  originLocationId: string;
  originLocationName: string;
  destinationLocationId: string;
  destinationLocationName: string;
  baseCharge: number;
  extraWeightPercent: number;
  freeWeightKg: number;
  isActive: boolean;
  createdAt: string;
}

export interface UpsertDeliveryRateInput {
  originLocationId: string;
  destinationLocationId: string;
  baseCharge: number;
  extraWeightPercent?: number;
  freeWeightKg?: number;
}

export interface DeliveryQuote {
  baseCharge: number;
  weightSurcharge: number;
  totalPayable: number;
  freeWeightKg: number;
  extraWeightPercent: number;
}

export const listDeliveryRates = async (): Promise<{ success: boolean; data: DeliveryRate[] }> => {
  const response = await api.get('/delivery-rates');
  return response.data;
};

export const upsertDeliveryRate = async (data: UpsertDeliveryRateInput) => {
  const response = await api.post('/delivery-rates', data);
  return response.data;
};

export const setDeliveryRateActive = async (id: string, isActive: boolean) => {
  const response = await api.patch(`/delivery-rates/${id}/active`, { isActive });
  return response.data;
};

export const getDeliveryQuote = async (
  originLocationId: string,
  destinationLocationId: string,
  weightKg: number,
): Promise<{ success: boolean; data: DeliveryQuote }> => {
  const response = await api.get('/delivery-rates/quote', {
    params: { originLocationId, destinationLocationId, weightKg },
  });
  return response.data;
};
