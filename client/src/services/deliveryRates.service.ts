import api from '../utils/api';

export interface DeliveryRate {
  id: string;
  originLocationId: string;
  originLocationName: string;
  destinationLocationId: string;
  destinationLocationName: string;
  baseCharge: number;
  branchBaseCharge: number | null;
  extraWeightPercent: number;
  freeWeightKg: number;
  isActive: boolean;
  createdAt: string;
}

export interface UpsertDeliveryRateInput {
  originLocationId: string;
  destinationLocationId: string;
  baseCharge: number;
  branchBaseCharge?: number | null;
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

export type VendorRateType = 'flat' | 'zone' | 'per_destination';

export interface VendorSelfRate {
  destinationId: string;
  destinationName: string;
  coveredAreas: string[];
  zone: string | null;
  valley: string | null;
  homeRate: number | null;
  branchRate: number | null;
  note: string | null;
}

export interface VendorSelfRates {
  rateType: VendorRateType;
  freeWeightKg: number;
  extraWeightPercent: number;
  rates: VendorSelfRate[];
}

// The rates that apply to the current vendor, from their own rate model.
export const getMyDeliveryRates = async (): Promise<{ success: boolean; data: VendorSelfRates }> => {
  const response = await api.get('/delivery-rates/my-rates');
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

// ── Bulk import (Excel/CSV upload) ───────────────────────────────────────────
// Rows reference locations by name; the server resolves them to hub ids.

export interface BulkImportRateRow {
  origin: string;
  destination: string;
  baseCharge: number;
  extraWeightPercent?: number;
  freeWeightKg?: number;
}

export interface BulkImportRateResult {
  origin: string;
  destination: string;
  action?: 'created' | 'updated';
  error?: string;
}

export const bulkImportDeliveryRates = async (
  rows: BulkImportRateRow[],
): Promise<{ success: boolean; message: string; data: BulkImportRateResult[] }> => {
  const response = await api.post('/delivery-rates/bulk-import', { rows });
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
