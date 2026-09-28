import api from '../utils/api';

export type CarrierCode = 'ncm' | 'upaya';
export const CARRIERS: CarrierCode[] = ['ncm', 'upaya'];
export const CARRIER_LABEL: Record<CarrierCode, string> = { ncm: 'NCM', upaya: 'Upaya' };

export type CarrierSettlementStatus = 'pending' | 'partially_paid' | 'settled' | 'cancelled';
export type PaymentLine = { method: string; amount: number };

export interface UnsettledCarrierOrder {
  codCollectionId: string;
  orderNumber: number;
  trackingId: string;
  vendorName: string;
  receiverName: string;
  receiverPhone: string;
  destination: string | null;
  deliveredAt: string | null;
  collectedAmount: number;
}

export interface CarrierSettlementRow {
  id: string;
  statementNo: string;
  carrier: CarrierCode;
  settlementDate: string;
  status: CarrierSettlementStatus;
  netReceivable: number;
  paidAmount: number;
  paymentBreakdown: PaymentLine[];
  settledAt: string | null;
  remark: string | null;
}

export interface CarrierSettlementDetail extends CarrierSettlementRow {
  grossCod: number;
  carrierCharges: number;
  remainingAmount: number;
  createdBy: string | null;
  createdAt: string;
  payments: Array<{ id: string; amount: number; method: string; breakdown: PaymentLine[]; remark: string | null; proofPath: string | null; paidAt: string; recordedBy: string | null }>;
  items: Array<{ codCollectionId: string; orderNumber: number; trackingId: string; vendorName: string; receiverName: string; destination: string | null; collectedAmount: number; carrierCharge: number; netAmount: number }>;
}

export async function getUnsettledCarrierOrders(carrier: CarrierCode): Promise<UnsettledCarrierOrder[]> {
  return (await api.get(`/finance/carrier-cod/${carrier}/unsettled`)).data.data;
}

export async function getCarrierSettlements(params: {
  carrier?: CarrierCode;
  status?: CarrierSettlementStatus;
  settledFrom?: string;
  settledTo?: string;
  page: number;
  pageSize: number;
}): Promise<{ data: CarrierSettlementRow[]; meta: { total: number; totalPages: number } }> {
  const response = await api.get('/finance/carrier-settlements', { params });
  return { data: response.data.data, meta: response.data.meta };
}

export async function createCarrierSettlement(input: {
  carrier: CarrierCode;
  settlementDate: string;
  items: Array<{ codCollectionId: string; carrierCharge: number }>;
  remark?: string;
}): Promise<{ id: string; statementNo: string }> {
  return (await api.post('/finance/carrier-settlements', input)).data.data;
}

export async function getCarrierSettlement(id: string): Promise<CarrierSettlementDetail> {
  return (await api.get(`/finance/carrier-settlements/${id}`)).data.data;
}

export async function payCarrierSettlement(id: string, payments: PaymentLine[], remark?: string) {
  // Multipart, like the other statement pay calls; `payments` travels as JSON text (see parseMultipartJson).
  const form = new FormData();
  form.append('payments', JSON.stringify(payments));
  if (remark?.trim()) form.append('remark', remark.trim());
  const response = await api.post(`/finance/carrier-settlements/${id}/pay`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data as { success: boolean; message: string; data: { status: CarrierSettlementStatus; remainingAmount: number } };
}

export async function cancelCarrierSettlement(id: string, remark: string) {
  return (await api.post(`/finance/carrier-settlements/${id}/cancel`, { remark })).data;
}
