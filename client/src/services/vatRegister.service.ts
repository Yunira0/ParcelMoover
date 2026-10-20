import api from '../utils/api';

export type RegisterKind = 'sales' | 'sales-return' | 'purchase' | 'purchase-return';
export type PurchaseType = 'local' | 'import' | 'capital';

export interface RegisterAmounts {
  total: number;
  exempt: number;
  taxable: number;
  vat: number;
  importTaxable: number;
  importVat: number;
  capitalTaxable: number;
  capitalVat: number;
}

export interface RegisterRow extends RegisterAmounts {
  id: string;
  source: 'statement' | 'carrier' | 'bill';
  /** BS date, `2083.05.01`. */
  date: string;
  invoiceNo: string;
  customsNo: string | null;
  partyName: string;
  partyPan: string | null;
  description: string | null;
}

export interface VatRegister {
  kind: RegisterKind;
  period: { year: number; month: number };
  taxpayer: { name: string; pan: string };
  rows: RegisterRow[];
  totals: RegisterAmounts;
}

export const getVatRegister = async (kind: RegisterKind, year: number, month: number): Promise<VatRegister> =>
  (await api.get(`/finance/vat-registers/${kind}`, { params: { year, month } })).data.data;

export interface PurchaseBillInput {
  /** AD "YYYY-MM-DD" from the BS date picker. */
  billDate: string;
  billNo: string;
  customsNo?: string;
  supplierName: string;
  supplierPan?: string;
  purchaseType: PurchaseType;
  description?: string;
  totalAmount: number;
  exemptAmount: number;
}

export const createPurchaseBill = async (input: PurchaseBillInput): Promise<{ id: string }> =>
  (await api.post('/finance/purchase-bills', input)).data.data;

export const cancelPurchaseBill = async (id: string, remark: string): Promise<{ id: string }> =>
  (await api.post(`/finance/purchase-bills/${id}/cancel`, { remark })).data.data;
