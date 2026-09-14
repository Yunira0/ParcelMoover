import api from '../utils/api';
import { getOrders, type Order, type ParcelStatus } from './orders.service';
import {
  MERCHANT_METRIC_LABELS,
  MERCHANT_METRIC_ORDER,
  MERCHANT_METRIC_STATUSES,
  MERCHANT_METRIC_SETTLEMENT,
  type MerchantMetricKey,
  type MerchantOverviewSummary,
} from './merchantOverview.service';

/**
 * Rider Overview: the admin-facing counterpart to Vendor/Branch Overview,
 * scoped to one rider's assigned deliveries (parcels.delivery_rider_id).
 * Reuses the exact same metric shape/labels as Vendor Overview so the three
 * "overview" pages read as one family.
 */
export interface RiderOverviewFilters {
  /** Rider id (riders.id), or undefined for "all riders". */
  riderId?: string;
  dateFrom?: string;
  dateTo?: string;
}

export {
  MERCHANT_METRIC_LABELS as RIDER_METRIC_LABELS,
  MERCHANT_METRIC_ORDER as RIDER_METRIC_ORDER,
};
export type { MerchantMetricKey as RiderMetricKey, MerchantOverviewSummary as RiderOverviewSummary };

/** Fetches server-side aggregated stats (no row cap, includes settlement data). */
export const getRiderOverview = async (
  filters: RiderOverviewFilters,
): Promise<MerchantOverviewSummary> => {
  const params: Record<string, string> = {};
  if (filters.riderId) params.riderId = filters.riderId;
  if (filters.dateFrom) params.dateFrom = filters.dateFrom;
  if (filters.dateTo) params.dateTo = filters.dateTo;

  const res = await api.get('/orders/rider-overview', { params });
  return res.data.data;
};

/** Loads paginated orders for the table. */
export const fetchRiderOrders = async (
  filters: RiderOverviewFilters,
  opts: { pageSize?: number; cursor?: string; dir?: 'next' | 'prev'; withArrival?: boolean; status?: ParcelStatus[]; settlement?: 'settled' | 'pending' } = {},
): Promise<{ data: Order[]; meta?: { hasNextPage?: boolean; hasPrevPage?: boolean; nextCursor?: string | null; prevCursor?: string | null; total?: number; totalPages?: number } }> => {
  const res = await getOrders({
    riderId: filters.riderId,
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
export { MERCHANT_METRIC_STATUSES as RIDER_METRIC_STATUSES, MERCHANT_METRIC_SETTLEMENT as RIDER_METRIC_SETTLEMENT };
