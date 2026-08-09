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
  status: 'pending' | 'settled' | 'cancelled';
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

export type SettlementStatusFilter = 'pending' | 'settled' | 'cancelled';

export const getSettlements = async (
  payeeType: PayeeType,
  targetId?: string,
  page = 1,
  pageSize = 20,
  fromDate?: string,
  toDate?: string,
  status?: SettlementStatusFilter,
  search?: string,
): Promise<SettlementsListResponse> => {
  const response = await api.get('/finance/settlements', {
    params: {
      payeeType,
      page,
      pageSize,
      ...(targetId ? { targetId } : {}),
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
      ...(status ? { status } : {}),
      ...(search ? { search } : {}),
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
  status: 'pending' | 'settled' | 'cancelled';
  remark: string | null;
}

export const createSettlement = async (
  payload: CreateSettlementPayload,
): Promise<{ success: boolean; message: string; data: CreateSettlementResponse }> => {
  const response = await api.post('/finance/settlements', payload);
  return response.data;
};

export interface PaySettlementDocuments {
  /** Screenshot/PDF of the transfer confirmation. */
  paymentReceipt?: File | null;
  /** Tax invoice raised against this payout. */
  taxInvoice?: File | null;
}

export const paySettlement = async (
  id: string,
  payments: SettlementPayment[],
  remark?: string,
  documents?: PaySettlementDocuments,
): Promise<{ success: boolean; message: string; data: CreateSettlementResponse }> => {
  // Multipart because of the attachments; `payments` is sent as JSON text and
  // revived server-side (see parseMultipartJson) since form fields are strings.
  const form = new FormData();
  form.append('payments', JSON.stringify(payments));
  // Omit rather than send "" - the field is optional server-side.
  if (remark?.trim()) form.append('remark', remark.trim());
  if (documents?.paymentReceipt) form.append('paymentReceipt', documents.paymentReceipt);
  if (documents?.taxInvoice) form.append('taxInvoice', documents.taxInvoice);

  // The header override is required, not cosmetic: the api instance defaults to
  // Content-Type: application/json, and axios serialises FormData to JSON when
  // that header is set - the File objects would silently become {} and the
  // request would arrive as JSON, so multer would never see the uploads. Same
  // reason kyc.service.ts sets it. The browser replaces this with the real
  // multipart type plus its boundary.
  const response = await api.post(`/finance/settlements/${id}/pay`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

// Follow-up step after paySettlement — attaches the receipt/invoice as proof
// once the payout is already on record. Either file may be sent alone.
export const attachSettlementDocuments = async (
  id: string,
  documents: PaySettlementDocuments,
): Promise<{ success: boolean; message: string; data: { id: string; paymentReceiptPath: string | null; taxInvoicePath: string | null } }> => {
  const form = new FormData();
  if (documents.paymentReceipt) form.append('paymentReceipt', documents.paymentReceipt);
  if (documents.taxInvoice) form.append('taxInvoice', documents.taxInvoice);

  const response = await api.patch(`/finance/settlements/${id}/documents`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export interface UnsettledOrderItem {
  id: string;
  codCollectionId: string;
  orderNumber: number;
  trackingId: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string | null;
  destination: string;
  /** Pickup or delivery location for this rider's leg. Null for vendor rows. */
  location: string | null;
  orderType: string;
  isReturnToVendor: boolean;
  /** Declared COD due on the parcel - informational, not what's owed. */
  codAmount: number;
  /** Cash actually collected - what netPayable is computed from. */
  collectedAmount: number;
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
  codCollectionId: string;
  orderNumber: number;
  trackingId: string;
  reference: string | null;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string | null;
  vendorName: string | null;
  vendorPhone: string | null;
  orderType: string | null;
  isReturnToVendor: boolean;
  pieces: number | null;
  weightKg: number | null;
  /** Pickup or delivery location for this rider's leg. Null for vendor statements. */
  location: string | null;
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
  payeeId: string;
  payeeName: string;
  payeePhone: string;
  payeeEmail: string | null;
  payeeAddress: string | null;
  payeePan: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountHolder: string | null;
  transferDate: string | null;
  createdAt: string;
  amount: number;
  payableAmount: number;
  status: 'pending' | 'settled' | 'cancelled';
  paymentMethod: string | null;
  payments: SettlementPayment[];
  remark: string | null;
  paymentReceiptPath: string | null;
  taxInvoicePath: string | null;
  items: SettlementDetailItem[];
}

export const getSettlementDetail = async (id: string): Promise<SettlementDetail> => {
  const response = await api.get(`/finance/settlements/${id}`);
  return response.data.data;
};

export const updateSettlement = async (
  id: string,
  codCollectionIds: string[],
): Promise<{ success: boolean; message: string; data: CreateSettlementResponse }> => {
  const response = await api.patch(`/finance/settlements/${id}`, { codCollectionIds });
  return response.data;
};

export const revertSettlement = async (
  id: string,
  remark: string,
): Promise<{ success: boolean; message: string; data: CreateSettlementResponse }> => {
  const response = await api.post(`/finance/settlements/${id}/revert`, { remark });
  return response.data;
};

export const cancelSettlement = async (
  id: string,
  remark: string,
): Promise<{ success: boolean; message: string; data: CreateSettlementResponse }> => {
  const response = await api.post(`/finance/settlements/${id}/cancel`, { remark });
  return response.data;
};
