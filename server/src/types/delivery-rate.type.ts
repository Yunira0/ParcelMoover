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
