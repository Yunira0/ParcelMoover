import api from '../utils/api';
import type { Order, OrdersPageMeta } from './orders.service';

export interface Branch {
  id: string;
  name: string;
  code: string | null;
  district: string | null;
  isActive: boolean;
  commissionPerParcel: number;
  coveredAreaCount: number;
}

export type BranchMetricKey =
  | 'totalOrders' | 'inTransit' | 'pendingDelivery' | 'totalDelivered'
  | 'returnProcessing' | 'returned' | 'hold' | 'failed' | 'deposited' | 'pendingDeposit';

export interface BranchMetric { count: number; amount: number }
export type BranchMetrics = Record<BranchMetricKey, BranchMetric>;

export const BRANCH_METRIC_ORDER: BranchMetricKey[] = [
  'totalOrders', 'inTransit', 'pendingDelivery', 'totalDelivered', 'returnProcessing',
  'returned', 'hold', 'failed', 'deposited', 'pendingDeposit',
];

export const BRANCH_METRIC_LABELS: Record<BranchMetricKey, string> = {
  totalOrders: 'Total Orders', inTransit: 'In Transit', pendingDelivery: 'Pending Delivery',
  totalDelivered: 'Total Delivered', returnProcessing: 'Return Processing', returned: 'Returned',
  hold: 'Hold', failed: 'Failed', deposited: 'COD Deposited', pendingDeposit: 'COD Pending',
};

export interface BranchFilters {
  fromBranchId?: string;
  toBranchId?: string;
  dateFrom?: string;
  dateTo?: string;
  metric?: BranchMetricKey;
  /** Creation picker only: excludes parcels already attached to any statement. */
  availableForSettlement?: boolean;
}

const cleanParams = (filters: object) => Object.fromEntries(
  Object.entries(filters).filter(([, value]) => value !== undefined && value !== '' && value !== 'all'),
);

export async function listBranches(signal?: AbortSignal): Promise<Branch[]> {
  const response = await api.get('/branches', { signal });
  return response.data.data;
}

export async function getBranchOverview(filters: BranchFilters, signal?: AbortSignal): Promise<BranchMetrics> {
  const response = await api.get('/branches/overview', { params: cleanParams(filters), signal });
  return response.data.data;
}

export async function getBranchOrders(
  filters: BranchFilters & { page?: number; pageSize?: number; cursor?: string; dir?: 'next' | 'prev' },
  signal?: AbortSignal,
): Promise<{ data: Order[]; meta: OrdersPageMeta }> {
  const response = await api.get('/branches/orders', { params: cleanParams(filters), signal });
  return { data: response.data.data, meta: response.data.meta };
}

export async function exportBranchOrders(filters: BranchFilters, signal?: AbortSignal) {
  const response = await api.get('/branches/orders/export', { params: cleanParams(filters), signal, timeout: 60_000 });
  return response.data as { success: boolean; data: Order[]; truncated: boolean };
}

export async function createBranch(input: {
  locationId: string;
  /** Plain-destination coverage (re-parenting) - set from the Destinations
   *  settings page, not the Add Branch modal, which only offers virtual branches. */
  coveredAreaIds?: string[];
  /** Other existing branches this one also covers - a side relationship, not
   *  a re-parenting: each keeps its own routing/pricing untouched. */
  virtualBranchIds?: string[];
  commissionPerParcel: number;
}) {
  const response = await api.post('/branches', input);
  return response.data;
}

export type BranchSettlementStatus = 'pending' | 'partially_paid' | 'settled' | 'cancelled';
export interface BranchPaymentLine { method: string; amount: number }

export interface BranchSettlement {
  id: string;
  statementNo: string;
  fromBranch: string;
  toBranch: string;
  settlementDate: string;
  orderCount: number;
  grossCod: number;
  commissionAmount: number;
  netPayable: number;
  commissionPerParcel: number;
  status: BranchSettlementStatus;
  paidAmount: number;
  remainingAmount: number;
  paymentMethod: string | null;
  paymentBreakdown: BranchPaymentLine[];
  remark: string | null;
}

export interface BranchSettlementSummary {
  grossCod: number;
  commissionCredit: number;
  netPayable: number;
  paid: number;
  outstanding: number;
  pendingStatements: number;
}

export async function getBranchSettlements(filters: Omit<BranchFilters, 'metric' | 'availableForSettlement'> & {
  page: number; pageSize: number; status?: BranchSettlementStatus; scope?: 'outgoing' | 'incoming' | 'all';
}, signal?: AbortSignal) {
  const response = await api.get('/branches/settlements', { params: cleanParams(filters), signal });
  return response.data as { success: boolean; data: BranchSettlement[]; summary: BranchSettlementSummary; meta: { page: number; pageSize: number; total: number; totalPages: number } };
}

export async function createBranchSettlement(input: {
  fromBranchId: string; toBranchId: string; settlementDate: string; orderIds: string[];
  commissionPerParcel?: number; paymentMethod?: string; remark?: string;
}) {
  const response = await api.post('/branches/settlements', input);
  return response.data;
}

export interface BranchSettlementPaymentRecord {
  id: string;
  amount: number;
  method: string;
  breakdown: BranchPaymentLine[];
  remark: string | null;
  paidAt: string;
  recordedBy: string | null;
}

export interface BranchSettlementPaymentProof {
  id: string;
  amount: number;
  method: string;
  reference: string | null;
  proofPath: string;
  note: string | null;
  submittedAt: string;
  verifiedAt: string | null;
}

export interface BranchSettlementDetail extends Omit<BranchSettlement, 'fromBranch' | 'toBranch' | 'orderCount'> {
  fromBranch: { id: string; name: string };
  toBranch: { id: string; name: string };
  settledAt: string | null;
  settledBy: string | null;
  createdAt: string;
  payments: BranchSettlementPaymentRecord[];
  paymentProofs: BranchSettlementPaymentProof[];
  items: Array<{
    parcelId: string;
    orderNumber: number;
    trackingId: string;
    status: string;
    receiverName: string;
    receiverPhone: string;
    origin: string | null;
    destination: string | null;
    collectedAmount: number;
    commissionAmount: number;
    netPayable: number;
  }>;
}

export async function getBranchSettlement(id: string, signal?: AbortSignal): Promise<BranchSettlementDetail> {
  const response = await api.get(`/branches/settlements/${id}`, { signal });
  return response.data.data;
}

export async function payBranchSettlement(id: string, input: {
  payments: BranchPaymentLine[];
  remark?: string;
}) {
  const response = await api.post(`/branches/settlements/${id}/pay`, input);
  return response.data as { success: boolean; message: string; data: {
    id: string; statementNo: string; status: BranchSettlementStatus;
    netPayable: number; paidAmount: number; remainingAmount: number; paymentId: string;
  } };
}
