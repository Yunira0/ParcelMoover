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
  payeeType: "rider" | "vendor";
  payeeName: string;
  payeePhone: string;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountHolder: string | null;
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

export interface CreateSettlementInput {
  payeeType: "rider" | "vendor";
  targetId: string;
  codCollectionIds: string[];
  settlementDate: string;
}

export interface SettlementPaymentInput {
  method: "cash" | "online";
  amount: number;
}

export interface PaySettlementInput {
  payments: SettlementPaymentInput[];
  remark: string;
}

export interface CreateSettlementResult {
  id: string;
  statementId: string;
  payeeType: "rider" | "vendor";
  amount: number;
  payableAmount: number;
  settlementDate: string | null;
  status: "pending" | "settled";
  paymentMethod: string | null;
  payments: SettlementPaymentInput[];
  remark: string | null;
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

export interface SettlementDetailItem {
  orderNumber: number;
  trackingId: string;
  reference: string | null;
  receiverName: string;
  receiverPhone: string;
  destination: string;
  orderType: string;
  pieces: number;
  weightKg: number | null;
  codAmount: number;
  collectedAmount: number;
  deliveryCharge: number;
  settledAmount: number;
  deliveredAt: string | null;
}

export interface SettlementDetailResult {
  id: string;
  statementId: string;
  payeeType: "rider" | "vendor";
  payeeName: string;
  payeePhone: string;
  payeeEmail: string | null;
  payeeAddress: string | null;
  transferDate: string | null;
  amount: number;
  payableAmount: number;
  status: "pending" | "settled";
  paymentMethod: string | null;
  payments: SettlementPaymentInput[];
  remark: string | null;
  items: SettlementDetailItem[];
}
