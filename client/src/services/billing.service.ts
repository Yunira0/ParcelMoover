import api from '../utils/api';

// ── Vendor credit control ────────────────────────────────────────────────────
//
// A vendor's account balance is negative when they owe the office delivery
// charges. Past the warn threshold they're notified; past the block threshold
// order creation is refused server-side (see billing.service.ts on the API).

export type VendorBillingState = 'ok' | 'warned' | 'blocked';

export interface BillingStatus {
  vendorId: string;
  /** Lifetime COD collected from receivers on this vendor's parcels. */
  codCollected: number;
  /** Lifetime delivery charges earned on delivered/returned parcels. */
  deliveryCharges: number;
  /** Lifetime net already paid out to the vendor via settled statements. */
  payouts: number;
  /** Lifetime verified payments the vendor has made back to the office. */
  paymentsReceived: number;
  /** Negative = the vendor owes the office. */
  balance: number;
  warnThreshold: number;
  blockThreshold: number;
  state: VendorBillingState;
  /** How much would lift a block. Zero when not blocked. */
  amountToClearBlock: number;
  /** Claims awaiting verification — submitted, but not yet in the balance. */
  pendingPaymentAmount: number;
  paymentQrPath: string | null;
  paymentNote: string | null;
}

export interface VendorPayment {
  id: string;
  vendorId: string;
  vendorName: string;
  amount: number;
  method: string;
  reference: string | null;
  proofPath: string | null;
  status: 'pending' | 'verified' | 'rejected';
  note: string | null;
  reviewRemark: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export interface VendorPaymentsResponse {
  success: boolean;
  data: VendorPayment[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface BillingSettings {
  id: string;
  warnThreshold: number;
  blockThreshold: number;
  paymentQrPath: string | null;
  paymentNote: string | null;
}

export interface VendorBalanceRow extends BillingStatus {
  vendorName: string;
  /** What the vendor was last notified about; drifts from `state` until the
   *  next evaluation runs. */
  storedState: VendorBillingState;
}

export const getBillingStatus = async (vendorId?: string): Promise<BillingStatus> => {
  const response = await api.get('/billing/status', {
    params: vendorId ? { vendorId } : {},
  });
  return response.data.data;
};

export const listVendorPayments = async (params?: {
  vendorId?: string;
  status?: 'pending' | 'verified' | 'rejected';
  page?: number;
  pageSize?: number;
}): Promise<VendorPaymentsResponse> => {
  const response = await api.get('/billing/payments', { params: params ?? {} });
  return response.data;
};

// Multipart because of the optional proof screenshot.
export const submitVendorPayment = async (input: {
  amount: number;
  reference?: string;
  note?: string;
  proof?: File | null;
}): Promise<VendorPayment> => {
  const form = new FormData();
  form.append('amount', String(input.amount));
  if (input.reference) form.append('reference', input.reference);
  if (input.note) form.append('note', input.note);
  if (input.proof) form.append('proof', input.proof);

  const response = await api.post('/billing/payments', form);
  return response.data.data;
};

export const reviewVendorPayment = async (
  paymentId: string,
  decision: 'verified' | 'rejected',
  remark?: string,
): Promise<VendorPayment> => {
  const response = await api.patch(`/billing/payments/${paymentId}/review`, { decision, remark });
  return response.data.data;
};

export const getBillingSettings = async (): Promise<BillingSettings> => {
  const response = await api.get('/billing/settings');
  return response.data.data;
};

export const updateBillingSettings = async (input: {
  warnThreshold?: number;
  blockThreshold?: number;
  paymentNote?: string | null;
}): Promise<BillingSettings> => {
  const response = await api.patch('/billing/settings', input);
  return response.data.data;
};

export const uploadPaymentQr = async (qr: File): Promise<BillingSettings> => {
  const form = new FormData();
  form.append('qr', qr);
  const response = await api.post('/billing/settings/qr', form);
  return response.data.data;
};

export const listVendorBalances = async (
  state?: VendorBillingState,
): Promise<VendorBalanceRow[]> => {
  const response = await api.get('/billing/vendors', { params: state ? { state } : {} });
  return response.data.data;
};
