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

/** `partially_paid` means some money is on record but the payee is still owed the rest. */
export type SettlementStatus = 'pending' | 'settled' | 'partially_paid' | 'cancelled';

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
  status: SettlementStatus;
  /** Recorded so far — between 0 and `amount` while partially paid. */
  paidAmount: number;
  /**
   * What was actually paid, per method, already totalled across instalments —
   * `[{ method: 'Cash', amount: 1000 }, { method: 'Bank', amount: 1000 }]`.
   * Empty until something is paid.
   */
  paymentBreakdown: Array<{ method: string; amount: number }>;
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

export type SettlementStatusFilter = SettlementStatus;


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
  status: SettlementStatus;
  remark: string | null;
  /** Total recorded across every instalment so far. */
  paidAmount: number;
  /** What the payee is still owed — 0 once the statement is settled. */
  remainingAmount: number;
  /** The instalment a `paySettlement` call created, so its proof can be attached to it. */
  paymentId?: string;
}

export const createSettlement = async (
  payload: CreateSettlementPayload,
): Promise<{ success: boolean; message: string; data: CreateSettlementResponse }> => {
  const response = await api.post('/finance/settlements', payload);
  return response.data;
};

export interface PaySettlementDocuments {
  /** Screenshots/PDFs of the transfer confirmation. Several are allowed — a transfer can be photographed more than once. */
  paymentReceipt?: File | File[] | null;
  /** Tax invoice(s) raised against this payout. */
  taxInvoice?: File | File[] | null;
}

const appendFiles = (form: FormData, field: string, value: File | File[] | null | undefined) => {
  if (!value) return;
  for (const file of Array.isArray(value) ? value : [value]) {
    form.append(field, file);
  }
};

// Records one payment against a statement. The total may be less than what's
// outstanding — the statement then comes back `partially_paid` and this can be
// called again for the balance.
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
  appendFiles(form, 'paymentReceipt', documents?.paymentReceipt);
  appendFiles(form, 'taxInvoice', documents?.taxInvoice);

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

export interface SettlementDocument {
  id: string;
  kind: 'receipt' | 'tax_invoice';
  /** Which instalment this file proves; null when it covers the statement as a whole. */
  paymentId: string | null;
  /** Render a PDF placeholder rather than a broken <img> when true. */
  isPdf: boolean;
  uploadedAt: string;
}

/** One act of paying: its methods, amount, date and its own proof. */
export interface SettlementPaymentRecord {
  id: string;
  amount: number;
  method: string;
  breakdown: SettlementPayment[];
  remark: string | null;
  paidAt: string;
  documents: SettlementDocument[];
}

export interface AttachSettlementDocumentOptions {
  /** Tie the files to one instalment. Omit to attach them to the statement as a whole. */
  paymentId?: string;
  /** Swap the file behind an existing document instead of adding another. Only valid with one file. */
  replaceDocumentId?: string;
}

// Follow-up step after paySettlement — attaches the receipt/invoice as proof
// once the payout is already on record. Either file may be sent alone, and each
// call adds to what's already there rather than replacing it, so a statement
// paid in instalments ends up with a receipt per instalment.
export const attachSettlementDocuments = async (
  id: string,
  documents: PaySettlementDocuments,
  options: AttachSettlementDocumentOptions = {},
): Promise<{ success: boolean; message: string; data: { id: string; documents: SettlementDocument[] } }> => {
  const form = new FormData();
  appendFiles(form, 'paymentReceipt', documents.paymentReceipt);
  appendFiles(form, 'taxInvoice', documents.taxInvoice);
  if (options.paymentId) form.append('paymentId', options.paymentId);
  if (options.replaceDocumentId) form.append('replaceDocumentId', options.replaceDocumentId);

  const response = await api.patch(`/finance/settlements/${id}/documents`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const deleteSettlementDocument = async (
  id: string,
  documentId: string,
): Promise<{ success: boolean; message: string; data: { id: string; documents: SettlementDocument[] } }> => {
  const response = await api.delete(`/finance/settlements/${id}/documents/${documentId}`);
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
  destination: string;
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
  /** Total recorded so far across every instalment. */
  paidAmount: number;
  /** What the payee is still owed. */
  remainingAmount: number;
  status: SettlementStatus;
  paymentMethod: string | null;
  payments: SettlementPayment[];
  /** Each act of paying, oldest first, with the proof attached to it. */
  paymentRecords: SettlementPaymentRecord[];
  /** Every proof on this statement, including any not tied to an instalment. */
  documents: SettlementDocument[];
  remark: string | null;
  /** Newest document of each kind. Null when none is attached. */
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
