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

/** `partially_paid` sits between pending and settled — see the enum in schema.prisma. */
export type SettlementStatus = "pending" | "settled" | "partially_paid" | "cancelled";

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
  createdAt: string;
  orderCount: number;
  amount: number;
  status: SettlementStatus;
  /** Total recorded against the statement so far — non-zero and below `amount` while partially_paid. */
  paidAmount: number;
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
  remark?: string;
  /** Relative upload paths, set by the controller after the files are secured. */
  paymentReceiptPaths?: string[];
  taxInvoicePaths?: string[];
}

export type SettlementDocumentKindInput = "receipt" | "tax_invoice";

export interface AttachSettlementDocumentsInput {
  /** Relative upload paths, set by the controller after the files are secured. Each becomes its own document row — a statement can hold several receipts. */
  paymentReceiptPaths?: string[];
  taxInvoicePaths?: string[];
  /** Which instalment the files prove. Omit to attach them to the statement as a whole. */
  paymentId?: string;
  /** Swap the file behind an existing document instead of adding another one. Only valid with exactly one uploaded file. */
  replaceDocumentId?: string;
}

export interface SettlementDocumentResult {
  id: string;
  kind: SettlementDocumentKindInput;
  /** Which instalment this file proves; null when it covers the statement as a whole. */
  paymentId: string | null;
  /** So the client can render a PDF placeholder instead of a broken <img>. */
  isPdf: boolean;
  uploadedAt: string;
}

/** One act of paying: its methods, its amount, its date and its own evidence. */
export interface SettlementPaymentRecordResult {
  id: string;
  amount: number;
  method: string;
  breakdown: SettlementPaymentInput[];
  remark: string | null;
  paidAt: string;
  documents: SettlementDocumentResult[];
}

export interface UpdateSettlementInput {
  codCollectionIds: string[];
}

export interface RevertSettlementInput {
  remark: string;
}

export interface CancelSettlementInput {
  remark: string;
}

export interface CreateSettlementResult {
  id: string;
  statementId: string;
  payeeType: "rider" | "vendor";
  amount: number;
  payableAmount: number;
  settlementDate: string | null;
  status: SettlementStatus;
  paymentMethod: string | null;
  payments: SettlementPaymentInput[];
  remark: string | null;
  /** Total handed over so far across every instalment. */
  paidAmount: number;
  /** ABS(payableAmount) - paidAmount; 0 once the statement is settled. */
  remainingAmount: number;
  /** The instalment this call created, when it created one. Lets the pay flow attach proof to it. */
  paymentId?: string;
}

export interface UnsettledOrderItem {
  id: string;
  codCollectionId: string;
  orderNumber: number;
  trackingId: string;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string | null;
  destination: string;
  // Pickup or delivery location for this rider's leg of the parcel - null
  // for vendor statements, where `destination` above is the relevant fact.
  location: string | null;
  orderType: string;
  // True for a genuine return order (orderType "return") AND for a plain
  // delivery that failed and was bounced back to the vendor (status
  // "returned_to_vendor") - both read as RTV to a payee, regardless of which
  // path got the parcel there.
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

export interface SettlementDetailItem {
  codCollectionId: string;
  orderNumber: number;
  trackingId: string;
  reference: string | null;
  receiverName: string;
  receiverPhone: string;
  receiverAddress: string | null;
  // Whose money this line is. Null for parcels booked without a vendor
  // (walk-in / direct orders). Mainly useful on rider statements, where
  // every line can belong to a different vendor.
  vendorName: string | null;
  vendorPhone: string | null;
  orderType: string;
  isReturnToVendor: boolean;
  pieces: number;
  weightKg: number | null;
  // Pickup or delivery location for this rider's leg of the parcel - null
  // for vendor statements, where the location isn't the relevant fact.
  location: string | null;
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
  /** vendors.id / riders.id — needed by the client to look up more orders eligible for this statement when editing it. */
  payeeId: string;
  payeeName: string;
  payeePhone: string;
  payeeEmail: string | null;
  payeeAddress: string | null;
  payeePan: string | null;
  /** Payee's bank account, so the payment screen can show where to transfer. */
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountHolder: string | null;
  transferDate: string | null;
  createdAt: string;
  amount: number;
  payableAmount: number;
  /** Total recorded so far across every instalment. */
  paidAmount: number;
  /** ABS(payableAmount) - paidAmount — what the payee is still owed. */
  remainingAmount: number;
  status: SettlementStatus;
  paymentMethod: string | null;
  payments: SettlementPaymentInput[];
  /** Each act of paying, oldest first, with the proof attached to it. */
  paymentRecords: SettlementPaymentRecordResult[];
  /** Every uploaded proof on this statement, including any not tied to an instalment. */
  documents: SettlementDocumentResult[];
  remark: string | null;
  /** Newest document of each kind, for callers that only want one. Null when none is attached. */
  paymentReceiptPath: string | null;
  taxInvoicePath: string | null;
  items: SettlementDetailItem[];
}
