import api from '../utils/api';

export interface VendorBillingProfile {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
}

export interface PendingCodItem {
  orderNumber: number;
  trackingId: string;
  receiverName: string;
  receiverPhone: string;
  destination: string;
  codAmount: number;
  deliveryCharge: number;
}

export interface PendingCodBill {
  vendor: VendorBillingProfile;
  statementDate: string;
  items: PendingCodItem[];
  totals: {
    totalCod: number;
    deliveryCharges: number;
    payableAmount: number;
  };
}

export type CodPaymentFilter = 'settled' | 'not_settled';

export interface OrderCodItem {
  id: string;
  trackingId: string;
  receiverName: string;
  receiverPhone: string;
  createdAt: string;
  deliveredAt: string | null;
  status: CodPaymentFilter;
  netPayable: number;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OrderCodListResponse {
  success: boolean;
  data: OrderCodItem[];
  settledCount: number;
  notSettledCount: number;
  meta: PageMeta;
}

export type PayeeType = 'rider' | 'vendor';

export interface SettlementListItem {
  id: string;
  statementId: string;
  payeeType: PayeeType;
  payeeName: string;
  payeePhone: string;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountHolder: string | null;
  transferDate: string | null;
  createdAt: string;
  orderCount: number;
  amount: number;
  status: 'pending' | 'settled';
  remark: string | null;
}

export interface SettlementsListResponse {
  success: boolean;
  data: SettlementListItem[];
  meta: PageMeta;
}

export const getPendingCod = async (): Promise<PendingCodBill> => {
  const response = await api.get('/finance/pending-cod');
  return response.data.data;
};

export const getOrderCod = async (
  status?: CodPaymentFilter,
  page = 1,
  pageSize = 20,
): Promise<OrderCodListResponse> => {
  const response = await api.get('/finance/order-cod', {
    params: { ...(status ? { status } : {}), page, pageSize },
  });
  return response.data;
};

export const getSettlements = async (
  payeeType: PayeeType,
  targetId?: string,
  page = 1,
  pageSize = 20,
  fromDate?: string,
  toDate?: string,
): Promise<SettlementsListResponse> => {
  const response = await api.get('/finance/settlements', {
    params: {
      payeeType,
      page,
      pageSize,
      ...(targetId ? { targetId } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
    },
  });
  return response.data;
};

// Method names are configurable by super admins (Cash, Online, eSewa, Bank, ...),
// so this is an open string rather than a fixed union.
export type PaymentMethod = string;

export interface SettlementPayment {
  method: PaymentMethod;
  amount: number;
}

export interface CreateSettlementPayload {
  payeeType: PayeeType;
  targetId: string;
  codCollectionIds: string[];
  settlementDate: string;
}

export interface CreateSettlementResponse {
  id: string;
  statementId: string;
  payeeType: PayeeType;
  amount: number;
  payableAmount: number;
  settlementDate: string | null;
  status: 'pending' | 'settled';
  remark: string | null;
}

export const createSettlement = async (
  payload: CreateSettlementPayload,
): Promise<{ success: boolean; message: string; data: CreateSettlementResponse }> => {
  const response = await api.post('/finance/settlements', payload);
  return response.data;
};

export const paySettlement = async (
  id: string,
  payments: SettlementPayment[],
  remark: string,
): Promise<{ success: boolean; message: string; data: CreateSettlementResponse }> => {
  const response = await api.post(`/finance/settlements/${id}/pay`, { payments, remark });
  return response.data;
};

export interface UnsettledOrderItem {
  id: string;
  codCollectionId: string;
  trackingId: string;
  receiverName: string;
  destination: string;
  codAmount: number;
  deliveryCharge: number;
  netPayable: number;
}

export interface UnsettledOrdersResult {
  items: UnsettledOrderItem[];
  totalCod: number;
  totalDeliveryCharge: number;
  totalNetPayable: number;
}

export const getUnsettledOrders = async (
  type: 'rider' | 'vendor',
  targetId?: string,
): Promise<{ success: boolean; data: UnsettledOrdersResult }> => {
  const response = await api.get('/finance/unsettled-orders', {
    params: { type, ...(targetId ? { targetId } : {}) },
  });
  return response.data;
};

export interface SettlementDetailItem {
  orderNumber: number;
  trackingId: string;
  reference: string | null;
  receiverName: string;
  receiverPhone: string;
  destination: string;
  orderType: string | null;
  pieces: number | null;
  weightKg: number | null;
  codAmount: number;
  collectedAmount: number;
  deliveryCharge: number;
  settledAmount: number;
  deliveredAt: string | null;
}

export interface SettlementDetail {
  id: string;
  statementId: string;
  payeeType: PayeeType;
  payeeName: string;
  payeePhone: string;
  payeeEmail: string | null;
  payeeAddress: string | null;
  transferDate: string | null;
  createdAt: string;
  amount: number;
  payableAmount: number;
  status: 'pending' | 'settled';
  paymentMethod: string | null;
  payments: SettlementPayment[];
  remark: string | null;
  items: SettlementDetailItem[];
}

export const getSettlementDetail = async (id: string): Promise<SettlementDetail> => {
  const response = await api.get(`/finance/settlements/${id}`);
  return response.data.data;
};
