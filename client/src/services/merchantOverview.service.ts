import api from '../utils/api';
import { getOrders, type Order, type ParcelStatus } from './orders.service';

/**
 * Merchant Overview: the stats cards are server-side aggregated (no row cap,
 * includes real settlement data). The table below still uses the paginated
 * GET /orders endpoint for row-level detail.
 */
export interface MerchantOverviewFilters {
  /** Vendor id, or undefined for "all merchants". */
  vendorId?: string;
  /** Inclusive Nepal-local day bounds, AD "YYYY-MM-DD". Compared against createdAt. */
  dateFrom?: string;
  dateTo?: string;
}

export type MerchantMetricKey =
  | 'totalOrders'
  | 'pendingOrders'
  | 'totalDelivered'
  | 'returnProcessing'
  | 'returnDelivered'
  | 'holdOrder'
  | 'cancelledOrders'
  | 'deliveryCharge'
  | 'deposited'
  | 'pendingDeposit';

export interface MerchantMetric {
  /** Orders that fall in this bucket. */
  count: number;
  /** The rupee figure the bucket carries (COD, collected cash, or charge). */
  amount: number;
}

export interface MerchantOverviewSummary {
  metrics: Record<MerchantMetricKey, MerchantMetric>;
  codSettlement: {
    lastAmount: number;
    lastSettledAt: string | null;
  };
}

// Card labels, in the order the strip renders them.
export const MERCHANT_METRIC_LABELS: Record<MerchantMetricKey, string> = {
  totalOrders: 'Total Orders',
  pendingOrders: 'Pending Orders',
  totalDelivered: 'Total Delivered',
  returnProcessing: 'Return Processing',
  returnDelivered: 'Return Delivered',
  holdOrder: 'Hold Order',
  cancelledOrders: 'Cancelled Orders',
  deliveryCharge: 'Delivery Charge',
  deposited: 'Deposited',
  pendingDeposit: 'Pending Deposit',
};

export const MERCHANT_METRIC_ORDER: MerchantMetricKey[] = [
  'totalOrders',
  'pendingOrders',
  'totalDelivered',
  'returnProcessing',
  'returnDelivered',
  'holdOrder',
  'cancelledOrders',
  'deliveryCharge',
  'deposited',
  'pendingDeposit',
];

/** Maps each metric to the parcel statuses it represents in the table. null = all (no filter). */
export const MERCHANT_METRIC_STATUSES: Record<MerchantMetricKey, ParcelStatus[] | null> = {
  totalOrders: null,
  pendingOrders: [
    'pickup_ordered','rider_assigned','picked_up','arrived',
    'oov','dispatched','arrived_at_branch','ready_to_deliver',
    'sent_for_delivery','failed_pickup','failed_delivery','loss_and_damage',
  ],
  totalDelivered: ['delivered', 'partially_delivered'],
  returnProcessing: ['follow_up', 'ready_to_return', 'sent_to_vendor'],
  returnDelivered: ['returned_to_vendor'],
  holdOrder: ['hold'],
  cancelledOrders: ['cancelled'],
  deliveryCharge: ['delivered', 'partially_delivered'],
  deposited: ['delivered', 'partially_delivered'],
  pendingDeposit: ['delivered', 'partially_delivered'],
};

/** Authentic settlement filter for Deposited/Pending — deposited = in a settled settlement (has items), pending = delivered not yet settled */
export const MERCHANT_METRIC_SETTLEMENT: Record<MerchantMetricKey, 'settled' | 'pending' | null> = {
  totalOrders: null,
  pendingOrders: null,
  totalDelivered: null,
  returnProcessing: null,
  returnDelivered: null,
  holdOrder: null,
  cancelledOrders: null,
  deliveryCharge: null,
  deposited: 'settled',
  pendingDeposit: 'pending',
};

/** Fetches server-side aggregated stats (no row cap, includes settlement data). */
export const getMerchantOverview = async (
  filters: MerchantOverviewFilters,
): Promise<MerchantOverviewSummary> => {
  const params: Record<string, string> = {};
  if (filters.vendorId) params.vendorId = filters.vendorId;
  if (filters.dateFrom) params.dateFrom = filters.dateFrom;
  if (filters.dateTo) params.dateTo = filters.dateTo;

  const res = await api.get('/orders/merchant-overview', { params });
  return res.data.data;
};

/** Loads paginated orders for the table. */
export const fetchMerchantOrders = async (
  filters: MerchantOverviewFilters,
  opts: { pageSize?: number; cursor?: string; dir?: 'next' | 'prev'; withArrival?: boolean; status?: ParcelStatus[]; settlement?: 'settled' | 'pending' } = {},
): Promise<{ data: Order[]; meta?: { hasNextPage?: boolean; hasPrevPage?: boolean; nextCursor?: string | null; prevCursor?: string | null; total?: number; totalPages?: number } }> => {
  const res = await getOrders({
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
