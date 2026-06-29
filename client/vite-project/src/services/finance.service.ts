import api from '../utils/api';

export interface VendorBillingProfile {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
}

export interface PendingCodItem {
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

export interface SettlementListItem {
  id: string;
  statementId: string;
  transferDate: string | null;
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
  page = 1,
  pageSize = 20,
  fromDate?: string,
  toDate?: string,
): Promise<SettlementsListResponse> => {
  const response = await api.get('/finance/settlements', {
    params: { page, pageSize, ...(fromDate ? { fromDate } : {}), ...(toDate ? { toDate } : {}) },
  });
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
