import api from '../utils/api';
import { getAllOrders, getOrders, type Order, type ParcelStatus } from './orders.service';
import {
  getMerchantOverview,
  MERCHANT_METRIC_LABELS,
  MERCHANT_METRIC_ORDER,
  MERCHANT_METRIC_STATUSES,
  MERCHANT_METRIC_SETTLEMENT,
  type MerchantMetricKey,
  type MerchantOverviewSummary,
} from './merchantOverview.service';

/**
 * Sales Overview: the admin-facing counterpart to Vendor Overview, scoped to
 * every vendor a sales rep owns (vendors.sales_user_id) instead of one vendor.
 * Reuses the exact same metric shape/labels as Vendor Overview so the two
 * pages read as one family.
 */
export interface SalesOverviewFilters {
  /** Sales rep's user id, or undefined for "all sales reps". */
  salesUserId?: string;
  /** One of the rep's vendors, picked from the vendor table - narrows everything to it. */
  vendorId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export {
  MERCHANT_METRIC_LABELS as SALES_METRIC_LABELS,
  MERCHANT_METRIC_ORDER as SALES_METRIC_ORDER,
};
export type { MerchantMetricKey as SalesMetricKey, MerchantOverviewSummary as SalesOverviewSummary };

/** Fetches server-side aggregated stats (no row cap, includes settlement data). */
export const getSalesOverview = async (
  filters: SalesOverviewFilters,
): Promise<MerchantOverviewSummary> => {
  // One vendor picked: its own Vendor Overview figures, the same card shape.
  if (filters.vendorId) {
    return getMerchantOverview({ vendorId: filters.vendorId, dateFrom: filters.dateFrom, dateTo: filters.dateTo });
  }
  const params: Record<string, string> = {};
  if (filters.salesUserId) params.salesUserId = filters.salesUserId;
  if (filters.dateFrom) params.dateFrom = filters.dateFrom;
  if (filters.dateTo) params.dateTo = filters.dateTo;

  const res = await api.get('/orders/sales-overview', { params });
  return res.data.data;
};

/** Loads paginated orders for the table. */
export const fetchSalesOrders = async (
  filters: SalesOverviewFilters,
  opts: { pageSize?: number; cursor?: string; dir?: 'next' | 'prev'; withArrival?: boolean; status?: ParcelStatus[]; settlement?: 'settled' | 'pending' } = {},
): Promise<{ data: Order[]; meta?: { hasNextPage?: boolean; hasPrevPage?: boolean; nextCursor?: string | null; prevCursor?: string | null; total?: number; totalPages?: number } }> => {
  const res = await getOrders({
    salesUserId: filters.salesUserId,
    vendorId: filters.vendorId ? [filters.vendorId] : undefined,
    ...(opts.status?.length ? { status: opts.status } : {}),
    ...(opts.settlement ? { settlement: opts.settlement } : {}),
    ...(filters.dateFrom || filters.dateTo ? { dateField: 'createdAt' as const } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
    ...(opts.withArrival ? { withArrival: true } : {}),
    pageSize: opts.pageSize ?? 10,
    cursor: opts.cursor,
    dir: opts.dir ?? 'next',
  });
  return { data: res.data, meta: res.meta };
};

// Re-exported so the page/cards can reuse Vendor Overview's exact metric →
// status / settlement mapping without importing across the merchant module.
export { MERCHANT_METRIC_STATUSES as SALES_METRIC_STATUSES, MERCHANT_METRIC_SETTLEMENT as SALES_METRIC_SETTLEMENT };

/** Every order behind the current cards/filters - for exports, which must not stop at one page. */
export const fetchAllSalesOrders = (
  filters: SalesOverviewFilters,
  opts: { status?: ParcelStatus[]; settlement?: 'settled' | 'pending' } = {},
): Promise<Order[]> =>
  getAllOrders({
    salesUserId: filters.salesUserId,
    vendorId: filters.vendorId ? [filters.vendorId] : undefined,
    ...(opts.status?.length ? { status: opts.status } : {}),
    ...(opts.settlement ? { settlement: opts.settlement } : {}),
    ...(filters.dateFrom || filters.dateTo ? { dateField: 'createdAt' as const } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo ? { dateTo: filters.dateTo } : {}),
    withArrival: true,
  });

/** One of a sales rep's vendors, with the all-time figures Vendor Management shows. */
export interface SalesVendor {
  id: string;
  client: string;
  company: string;
  email: string;
  phone: string;
  orders: { total: number; delivered: number; returned: number };
  codDue: number;
  joined: string;
  lastOrderedDate: string;
}

/** The registered company, falling back to the owner's name - as on Vendor Management. */
export const salesVendorName = (v: { company: string; client: string }) => v.company || v.client;
