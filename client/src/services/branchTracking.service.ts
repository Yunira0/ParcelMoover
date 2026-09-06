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
  hold: 'Hold', failed: 'Failed', deposited: 'Deposited', pendingDeposit: 'Pending Deposit',
};

export interface BranchFilters {
  fromBranchId?: string;
  toBranchId?: string;
  dateFrom?: string;
  dateTo?: string;
  metric?: BranchMetricKey;
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
  status: string;
  paymentMethod: string | null;
  remark: string | null;
}

export async function getBranchSettlements(filters: Omit<BranchFilters, 'metric'> & { page: number; pageSize: number }, signal?: AbortSignal) {
  const response = await api.get('/branches/settlements', { params: cleanParams(filters), signal });
  return response.data as { success: boolean; data: BranchSettlement[]; meta: { page: number; pageSize: number; total: number; totalPages: number } };
}

export async function createBranchSettlement(input: {
  fromBranchId: string; toBranchId: string; settlementDate: string; orderIds: string[];
  commissionPerParcel?: number; paymentMethod?: string; remark?: string;
}) {
  const response = await api.post('/branches/settlements', input);
  return response.data;
}
