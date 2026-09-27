import api from '../utils/api';

export type CarrierCode = 'ncm' | 'upaya';
export const CARRIERS: CarrierCode[] = ['ncm', 'upaya'];
export const CARRIER_LABEL: Record<CarrierCode, string> = { ncm: 'NCM', upaya: 'Upaya' };

export type CarrierSettlementStatus = 'pending' | 'partially_paid' | 'settled' | 'cancelled';
export type PaymentLine = { method: string; amount: number };

export interface CarrierCodSummary {
  carrier: CarrierCode;
  /** COD the carrier collected on orders it delivered. */
  collected: number;
  /** Cash it has paid us. */
  received: number;
  /** Charges it kept, on live statements. */
  charges: number;
  /** Cash it still owes us. */
  outstanding: number;
  /** COD on delivered orders not yet on any statement. */
  notOnStatement: number;
  onStatementsOwed: number;
  statements: number;
}

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
  orders: number;
  grossCod: number;
  carrierCharges: number;
  netReceivable: number;
  paidAmount: number;
  remainingAmount: number;
}

export interface CarrierSettlementDetail extends Omit<CarrierSettlementRow, 'orders'> {
  paymentBreakdown: PaymentLine[];
  remark: string | null;
  createdBy: string | null;
  settledAt: string | null;
  payments: Array<{ id: string; amount: number; method: string; breakdown: PaymentLine[]; remark: string | null; proofPath: string | null; paidAt: string; recordedBy: string | null }>;
  items: Array<{ codCollectionId: string; orderNumber: number; trackingId: string; vendorName: string; receiverName: string; destination: string | null; collectedAmount: number; carrierCharge: number; netAmount: number }>;
}

export async function getCarrierCodSummary(): Promise<CarrierCodSummary[]> {
  return (await api.get('/finance/carrier-cod')).data.data;
}

export async function getUnsettledCarrierOrders(carrier: CarrierCode): Promise<UnsettledCarrierOrder[]> {
  return (await api.get(`/finance/carrier-cod/${carrier}/unsettled`)).data.data;
}

export async function getCarrierSettlements(params: { carrier?: CarrierCode; status?: CarrierSettlementStatus } = {}): Promise<CarrierSettlementRow[]> {
  return (await api.get('/finance/carrier-settlements', { params })).data.data;
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

export async function payCarrierSettlement(id: string, payments: PaymentLine[], remark?: string, proof?: File | null) {
  // Multipart for the optional proof; `payments` travels as JSON text (see parseMultipartJson).
  const form = new FormData();
  form.append('payments', JSON.stringify(payments));
  if (remark?.trim()) form.append('remark', remark.trim());
  if (proof) form.append('proof', proof);
  const response = await api.post(`/finance/carrier-settlements/${id}/pay`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data as { success: boolean; message: string; data: { status: CarrierSettlementStatus; remainingAmount: number } };
}

export async function cancelCarrierSettlement(id: string, remark: string) {
  return (await api.post(`/finance/carrier-settlements/${id}/cancel`, { remark })).data;
}
