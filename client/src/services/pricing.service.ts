import api from '../utils/api';

export interface PricingSettings {
  id: string;
  zoneMajorCities: number | null;
  zoneUrbanAreas: number | null;
  zoneRemoteAreas: number | null;
  zoneInsideValley: number | null;
  flatInsideValley: number | null;
  flatOutsideValley: number | null;
  extraWeightPercent: number | null;
  freeWeightKg: number;
  branchZoneMajorCities: number | null;
  branchZoneUrbanAreas: number | null;
  branchZoneRemoteAreas: number | null;
  branchZoneInsideValley: number | null;
  branchFlatInsideValley: number | null;
  branchFlatOutsideValley: number | null;
  returnInsideValleyPercent: number | null;
  returnOutsideValleyPercent: number | null;
}

export type UpdatePricingSettingsInput = Partial<Omit<PricingSettings, 'id'>>;

export const getPricingSettings = async (): Promise<{ success: boolean; data: PricingSettings }> => {
  const response = await api.get('/pricing/settings');
  return response.data;
};

export const updatePricingSettings = async (data: UpdatePricingSettingsInput) => {
  const response = await api.put('/pricing/settings', data);
  return response.data;
};

export interface VendorQuote {
  baseCharge: number;
  weightSurcharge: number;
  totalPayable: number;
  freeWeightKg: number;
  rateType: string;
  basis: string;
}

// Vendor-aware quote: charges by the vendor's chosen rate model (per-destination /
// zone / flat) with its per-vendor overrides. vendorId is optional for vendor
// actors (resolved from the session); required when staff quote for a vendor.
export const getVendorQuote = async (
  destinationLocationId: string,
  weightKg: number,
  vendorId?: string,
): Promise<{ success: boolean; data: VendorQuote }> => {
  const response = await api.get('/pricing/quote', {
    params: { destinationLocationId, weightKg, ...(vendorId ? { vendorId } : {}) },
  });
  return response.data;
};
