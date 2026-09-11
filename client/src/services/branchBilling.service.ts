import api from '../utils/api';

export type BranchBillingState = 'ok' | 'warned' | 'blocked';
export type BranchPaymentStatus = 'pending' | 'verified' | 'rejected';

export interface BranchBillingStatus {
  branchId: string;
  branchName: string;
  unsettledCod: number;
  paymentsReceived: number;
  balance: number;
  /** Portion of unsettledCod past the branch COD SLA (delivered more than codSlaHours ago). */
  overdueCod: number;
  warnThreshold: number;
  blockThreshold: number;
  state: BranchBillingState;
  amountToClearBlock: number;
  pendingPaymentAmount: number;
  /** Hours a branch has, after delivery, to submit collected COD; null if the SLA is disabled. */
  codSlaHours: number | null;
}

export interface BranchPayment {
  id: string;
  branchId: string;
  branchName: string;
  settlementId: string | null;
  statementNo: string | null;
  amount: number;
  method: string;
  reference: string | null;
  proofPath: string | null;
  status: BranchPaymentStatus;
  note: string | null;
  reviewRemark: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export const getBranchBillingStatus = async (branchId?: string): Promise<BranchBillingStatus> =>
  (await api.get('/branches/billing/status', { params: branchId ? { branchId } : {} })).data.data;

export const listBranchBalances = async (): Promise<BranchBillingStatus[]> =>
  (await api.get('/branches/billing/balances')).data.data;

export const listBranchPayments = async (params?: { branchId?: string; status?: BranchPaymentStatus; page?: number; pageSize?: number }) =>
  (await api.get('/branches/billing/payments', { params: params ?? {} })).data as {
    data: BranchPayment[]; meta: { page: number; pageSize: number; total: number; totalPages: number };
  };

export const submitBranchPayment = async (input: { branchId?: string; settlementId?: string; amount: number; reference?: string; note?: string; proof?: File | null }) => {
  const form = new FormData();
  if (input.branchId) form.append('branchId', input.branchId);
  if (input.settlementId) form.append('settlementId', input.settlementId);
  form.append('amount', String(input.amount));
  if (input.reference) form.append('reference', input.reference);
  if (input.note) form.append('note', input.note);
  if (input.proof) form.append('proof', input.proof);
  return (await api.post('/branches/billing/payments', form, { headers: { 'Content-Type': 'multipart/form-data' } })).data.data as BranchPayment;
};

export const reviewBranchPayment = async (id: string, decision: 'verified' | 'rejected', remark?: string) =>
  (await api.patch(`/branches/billing/payments/${id}/review`, { decision, remark })).data.data as BranchPayment;
