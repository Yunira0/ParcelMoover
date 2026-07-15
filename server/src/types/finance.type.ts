export interface FinanceListQuery {
  vendorId?: string;
  page?: number;
  pageSize?: number;
}

export interface SettlementsListQuery extends FinanceListQuery {
  fromDate?: string;
  toDate?: string;
}

export type CodPaymentFilter = "settled" | "not_settled";

export interface OrderCodListQuery extends FinanceListQuery {
  status?: CodPaymentFilter;
}

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

export interface OrderCodListResult {
  data: OrderCodItem[];
  settledCount: number;
  notSettledCount: number;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface SettlementListItem {
  id: string;
  statementId: string;
  transferDate: string | null;
  orderCount: number;
  amount: number;
  status: "pending" | "settled";
  remark: string | null;
}

export interface SettlementsListResult {
  data: SettlementListItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

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
