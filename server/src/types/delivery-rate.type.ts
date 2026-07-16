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
