import api from '../utils/api';
import { v4 as uuidv4 } from 'uuid';

export type ParcelStatus =
  | 'pickup_ordered'
  | 'rider_assigned'
  | 'picked_up'
  | 'arrived'
  | 'ready_to_deliver'
  | 'sent_for_delivery'
  | 'oov'
  | 'dispatched'
  | 'arrived_at_branch'
  | 'hold'
  | 'loss_and_damage'
  | 'delivered'
  | 'partially_delivered'
  | 'failed_pickup'
  | 'failed_delivery'
  | 'cancelled'
  | 'follow_up'
  | 'ready_to_return'
  | 'sent_to_vendor'
  | 'returned_to_vendor';

export type OrderType = 'delivery' | 'exchange' | 'return';
export type ServiceType = 'home_delivery' | 'branch_delivery';

export interface CreateOrderInput {
  sender: {
    name: string;
    phone: string;
    email?: string;
    address?: string;
    locationId?: string;
  };
  receiver: {
    name: string;
    phone: string;
    alternatePhone?: string;
    email?: string;
    address?: string;
    locationId?: string;
  };
  originLocationId?: string;
  destinationLocationId?: string;
  orderType: OrderType;
  serviceType: ServiceType;
  pieces: number;
  weightKg?: number;
  codAmount?: number;
  /** Declared value of the items in the parcel. */
  itemValue?: number;
  /** Unused by the new Create Order page - kept for type compat with older flows; the server computes the real charge from the route's delivery rate. */
  deliveryCharge?: number;
  packageType?: string;
  deliveryInstruction?: string;
  remarks?: string;
  pickupAddress?: string;
  scheduledPickupAt?: string;
  vendorId?: string;
  /** Set true to bypass the same-day duplicate warning after the user confirms. */
  confirmDuplicate?: boolean;
}

export interface Order {
  id: string;
  orderNumber: number;
  trackingId: string;
  status: ParcelStatus;
  orderType: OrderType;
  serviceType: ServiceType;
  senderName: string;
  senderPhone: string;
  senderAddress?: string;
  receiverName: string;
  receiverPhone: string;
  receiverAlternatePhone?: string;
  receiverAddress: string;
  origin: string;
  destination: string;
  /** Raw destination hub name (used on printed labels). */
  destinationName?: string;
  originLocationId?: string | null;
  destinationLocationId?: string | null;
  /** "inside" | "outside" | null — the destination location's valley classification. */
  destinationValley?: string | null;
  pieces: number;
  weightKg?: number;
  attemptCount: number;
  codAmount: number;
  itemValue: number;
  deliveryCharge: number;
  /** Cash actually collected from the receiver. 0 until delivered, and below codAmount on a partial. */
  collectedAmount: number;
  packageType?: string;
  deliveryInstruction?: string;
  vendorId: string | null;
  vendorName?: string;
  vendorLocation?: string;
  // Resolved sticker print size (mm) - the vendor's own override, or the app
  // default when unset. See printLabels.ts.
  labelWidthMm: number;
  labelHeightMm: number;
  riderName?: string;
  remarks?: string;
  lastUpdatedBy?: string;
  lastUpdatedAt?: string;
  createdAt: string;
  createdAtRaw: string;
  /** AD "YYYY-MM-DD" of the first "arrived at origin" status change, or '' if never. */
  arrivedAtOrigin?: string;
  /** AD "YYYY-MM-DD" the parcel was delivered, or '' if not delivered. */
  deliveredAt?: string;
  /** Vendor-declared at creation: this shipment may be accepted in part. */
  allowPartialDelivery?: boolean;
  /** Set once a rider/admin marks the parcel partially_delivered. */
  partialDeliveryRemarks?: string | null;
  partialCodCollected?: number | null;
  /** Set only on an auto-created return leg — points back at its source exchange order. */
  sourceOrderId?: string | null;
}

export const ORDER_SORT_FIELDS = ['createdAt', 'codAmount', 'deliveryCharge', 'trackingId', 'status'] as const;
export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

export interface ListOrdersParams {
  status?: ParcelStatus[];
  orderType?: OrderType;
  search?: string;
  /** Narrow to these vendors. Server intersects it with the caller's own scope. */
  vendorId?: string[];
  /** Narrows the list to parcels carried by one delivery rider. */
  deliveryRiderId?: string;
  /** Display-only page hint echoed back in meta; position comes from the cursor. */
  page?: number;
  pageSize?: number;
  /** Opaque keyset cursor from meta.nextCursor/prevCursor. Omitted = first page ('next') or last page ('prev'). */
  cursor?: string;
  dir?: 'next' | 'prev';
  sortBy?: OrderSortField;
  sortDir?: 'asc' | 'desc';
  /** Export-only: include each order's first "arrived at origin" date. */
  withArrival?: boolean;
  /** Narrow to parcels delivered since local midnight, as the dashboard's
   *  "Delivered today" card counts them. */
  deliveredToday?: boolean;
  /** Which date `dateFrom`/`dateTo` are compared against. */
  dateField?: 'createdAt' | 'lastUpdatedAt';
  /** Inclusive Nepal-local day bounds, "YYYY-MM-DD". */
  dateFrom?: string;
  dateTo?: string;
}

export interface OrdersPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  // Set when the caller didn't request pagination and the result was capped.
  truncated?: boolean;
  // Keyset navigation - present on paginated queries.
  hasNextPage?: boolean;
  hasPrevPage?: boolean;
  nextCursor?: string | null;
  prevCursor?: string | null;
}

export interface OrdersListResponse {
  success: boolean;
  data: Order[];
  meta?: OrdersPageMeta;
}

export interface BulkStatusOptions {
  remarks?: string;
  /** Destination hub for the manifest. Required when status === 'dispatched'. */
  toLocationId?: string;
  riderId?: string;
  /** Required when status === 'partially_delivered'. Amount of COD collected. */
  codCollected?: number;
}

export interface BulkStatusResult {
  updatedCount: number;
  status: ParcelStatus;
  dispatch?: {
    id: string;
    dispatchNo: string;
    toLocationId: string;
  };
}

export interface DashboardTrendDay {
  day: string;
  date: string;
  totalOrders: number;
  pickedUp: number;
  delivered: number;
  returned: number;
}

/** One status inside an SLA group, and how many orders are past it. */
export interface SlaStatusBreach {
  status: ParcelStatus;
  count: number;
}

export interface DashboardSummary {
  overview: {
    totalOrders: number;
    totalOrderAmount: number;
    pendingPickups: number;
    pendingPickupsAmount: number;
    pendingReturns: number;
    pendingReturnsAmount: number;
    inTransit: number;
    inTransitAmount: number;
    pendingDeliveries: number;
    pendingDeliveriesAmount: number;
    /** Vendor-shaped split of the pipeline (see the vendor/sales overview
     *  cards): only what we haven't collected yet counts as awaiting pickup,
     *  and everything from pickup to the customer's door is one bucket. */
    awaitingPickup: number;
    awaitingPickupAmount: number;
    inDelivery: number;
    inDeliveryAmount: number;
    totalDelivered: number;
    totalDeliveredAmount: number;
    totalReturns: number;
    totalReturnsAmount: number;
    /** Parcels currently at returned_to_vendor status (all-time). */
    totalReturnedToVendor: number;
    totalReturnedToVendorAmount: number;
  };
  today: {
    totalOrders: number;
    delivered: number;
    /** COD value of the parcels delivered today. */
    deliveredAmount: number;
    inTransit: number;
    returns: number;
    /** Parcels that became returned_to_vendor today (by status-history date). */
    returnedToVendor: number;
    remarks: number;
    unclosedComments: number;
  };
  /** Counts of orders that have breached their per-status SLA (see SLA settings). */
  sla: {
    overduePickup: number;
    overdueDelivery: number;
    overdueTransit: number;
    overdueRemarks: number;
    overdueReturn: number;
    /** Representative SLA threshold (hours) per group — null if unset. */
    pickupHours: number | null;
    deliveryHours: number | null;
    transitHours: number | null;
    remarksHours: number | null;
    returnHours: number | null;
    /** Which statuses make up each group's total. Breaching statuses only. */
    pickupBreaches: SlaStatusBreach[];
    deliveryBreaches: SlaStatusBreach[];
    transitBreaches: SlaStatusBreach[];
    returnBreaches: SlaStatusBreach[];
  };
  codSettlement: {
    totalCod: number;
    settledCod: number;
    pendingCod: number;
    /** codFromPmRider + codFromNcm (+ future 3PLs) - the umbrella "COD to
     *  collect from riders" figure; carriers below break it down. */
    codFromRiders: number;
    /** Cash a ParcelMoover rider has collected but not yet remitted to the office. */
    codFromPmRider: number;
    /** Cash NCM collected on our behalf, not yet remitted to the office. */
    codFromNcm: number;
    /** Cash Upaya's placeholder rider is holding, not yet remitted to the office. */
    codFromUpaya: number;
    /** Delivery charge owed on orders whose COD hasn't been settled yet. */
    pendingDeliveryCharge: number;
    /** Total delivery charges (office cut) on the delivered orders in the COD window. */
    deliveryCharge: number;
    progressPercent: number;
    scopedToRider: boolean;
    /** Net amount actually paid to the vendor in the last settlement (COD minus delivery charge). */
    lastAmount: number;
    /** Full ISO timestamp of the last settlement (has both date and time). */
    lastSettledAt: string | null;
  };
  weeklyTrend: DashboardTrendDay[];
  updatedAt: string;
}

/**
 * The largest page this endpoint will serve (order.service MAX_PAGE_SIZE).
 * Asking for more is clamped server-side, so don't offer a bigger number.
 */
export const MAX_ORDER_PAGE_SIZE = 500;

const ORDER_STATUS_CHANGED_EVENT = 'parcelmoover:order-status-changed';

export const notifyOrderStatusChanged = () => {
  window.dispatchEvent(new Event(ORDER_STATUS_CHANGED_EVENT));
};

export const subscribeToOrderStatusChanged = (handler: () => void) => {
  window.addEventListener(ORDER_STATUS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(ORDER_STATUS_CHANGED_EVENT, handler);
};

export const getOrders = async (params?: ListOrdersParams, signal?: AbortSignal): Promise<OrdersListResponse> => {
  const query: Record<string, string> = {};
  if (params?.status?.length) query.status = params.status.join(',');
  if (params?.orderType) query.orderType = params.orderType;
  if (params?.vendorId?.length) query.vendorId = params.vendorId.join(',');
  if (params?.search) query.search = params.search;
  if (params?.deliveryRiderId) query.deliveryRiderId = params.deliveryRiderId;
  if (params?.page !== undefined) query.page = String(params.page);
  if (params?.pageSize !== undefined) query.pageSize = String(params.pageSize);
  if (params?.cursor !== undefined) query.cursor = params.cursor;
  if (params?.dir !== undefined) query.dir = params.dir;
  if (params?.sortBy) query.sortBy = params.sortBy;
  if (params?.sortDir) query.sortDir = params.sortDir;
  if (params?.withArrival) query.withArrival = 'true';
  if (params?.deliveredToday) query.deliveredToday = 'true';
  if (params?.dateField) query.dateField = params.dateField;
  if (params?.dateFrom) query.dateFrom = params.dateFrom;
  if (params?.dateTo) query.dateTo = params.dateTo;

  const response = await api.get('/orders', { params: query, signal });
  return response.data;
};

/** Per-status totals behind the orders list page's tab badges. */
export type OrderCountsByStatus = Record<ParcelStatus, number>;

// Every filter the list pushes down except `status` — the counts describe the
// same set of orders the table does, broken down per status rather than paged.
export type OrderCountsByStatusParams = Pick<
  ListOrdersParams,
  'orderType' | 'vendorId' | 'search' | 'deliveryRiderId' | 'deliveredToday' | 'dateField' | 'dateFrom' | 'dateTo'
>;

// Deliberately not derived from getOrders: that endpoint returns one keyset
// page and its meta.total only ever describes the active tab, so the other
// tabs' badges can't be read off it.
export const getOrderCountsByStatus = async (
  params?: OrderCountsByStatusParams,
  signal?: AbortSignal,
): Promise<{ success: boolean; data: OrderCountsByStatus }> => {
  const query: Record<string, string> = {};
  if (params?.orderType) query.orderType = params.orderType;
  if (params?.vendorId?.length) query.vendorId = params.vendorId.join(',');
  if (params?.search) query.search = params.search;
  if (params?.deliveryRiderId) query.deliveryRiderId = params.deliveryRiderId;
  if (params?.deliveredToday) query.deliveredToday = 'true';
  if (params?.dateField) query.dateField = params.dateField;
  if (params?.dateFrom) query.dateFrom = params.dateFrom;
  if (params?.dateTo) query.dateTo = params.dateTo;

  const response = await api.get('/orders/count-by-status', { params: query, signal });
  return response.data;
};

export interface OrderFilterOptions {
  origins: string[];
  destinations: string[];
  riders: string[];
}

// Lean, tab-scoped values for the orders list page's filter dropdowns -
// deliberately not routed through getOrders/listOrders, whose page is only
// 10 rows and whose full include is too heavy to reuse just for 3 strings.
export const getOrderFilterOptions = async (
  status?: ParcelStatus[],
  signal?: AbortSignal,
): Promise<{ success: boolean; data: OrderFilterOptions }> => {
  const response = await api.get('/orders/filter-options', {
    params: status?.length ? { status: status.join(',') } : {},
    signal,
  });
  return response.data;
};

// Fetches every order matching the given filters by walking the keyset-paginated
// endpoint page by page. Used for exports/reports, where the default flat list is
// capped (see DEFAULT_LIST_CAP on the server) and would silently drop rows.
export const getAllOrders = async (
  params?: Omit<ListOrdersParams, 'page' | 'pageSize' | 'cursor' | 'dir'>,
  signal?: AbortSignal,
): Promise<Order[]> => {
  // Deliberately below MAX_ORDER_PAGE_SIZE: an export walks every page anyway,
  // so a smaller batch just trades a few more round-trips for lighter
  // responses and a shorter time to the first one.
  const PAGE_SIZE = 100;
  const all: Order[] = [];
  let cursor: string | undefined;

  // Hard stop guards against an unexpected cursor loop; 1000 pages = 100k rows.
  for (let page = 0; page < 1000; page += 1) {
    const res = await getOrders(
      { ...params, pageSize: PAGE_SIZE, dir: 'next', cursor },
      signal,
    );
    if (!res?.success || !Array.isArray(res.data)) break;
    all.push(...res.data);

    const next = res.meta?.nextCursor;
    if (!res.meta?.hasNextPage || !next) break;
    cursor = next;
  }

  return all;
};

export const getDashboardSummary = async (trendDays: 7 | 30 = 7) => {
  const response = await api.get('/orders/dashboard-summary', { params: { trendDays } });
  return response.data;
};

// ── COD settlement drill-down ───────────────────────────────────────────────
// One bucket per line of the COD Settlement dashboard card. Carrier buckets
// ('pm-rider', 'ncm', 'upaya') sit under the "COD to collect from riders"
// heading; a future 3PL adds its slug here and a matching FILTER clause
// server-side.
export const COD_DETAIL_BUCKETS = [
  'total',
  'settled',
  'pending',
  'pm-rider',
  'ncm',
  'upaya',
  'delivery-charge',
] as const;
export type CodDetailBucket = (typeof COD_DETAIL_BUCKETS)[number];

export interface CodDetailRow {
  id: string;
  trackingId: string;
  orderNumber: number;
  vendorName: string;
  receiverName: string;
  riderName: string | null;
  collectedAmount: number;
  riderRemittedAmount: number;
  remittedAmount: number;
  deliveryCharge: number;
  /** The figure this bucket is measuring for this row — these sum to the
   *  amount shown on the dashboard card line that linked here. */
  bucketAmount: number;
  deliveredAt: string | null;
}

export const getCodSettlementDetail = async (
  bucket: CodDetailBucket,
  signal?: AbortSignal,
): Promise<{ rows: CodDetailRow[]; capped: boolean }> => {
  const response = await api.get('/orders/cod-settlement-detail', { params: { bucket }, signal });
  return { rows: response.data?.data ?? [], capped: Boolean(response.data?.capped) };
};

// Returns per-status-group counts for operation page tab badges.
// Accepts a record like { pickup_ordered: ["pickup_ordered"], rider_assigned: ["rider_assigned"] }
// and returns { pickup_ordered: 12, rider_assigned: 5 }.
export const getStatusCounts = async (
  groups: Record<string, string[]>,
  filters?: { deliveryRiderId?: string; vendorId?: string[]; search?: string },
): Promise<Record<string, number>> => {
  const response = await api.get('/orders/status-counts', {
    params: {
      groups: JSON.stringify(groups),
      ...(filters?.deliveryRiderId ? { deliveryRiderId: filters.deliveryRiderId } : {}),
      ...(filters?.vendorId?.length ? { vendorId: filters.vendorId.join(',') } : {}),
      ...(filters?.search ? { search: filters.search } : {}),
    },
  });
  return response.data.data;
};

// ── Rider run sheet ───────────────────────────────────────────────────────────
// Run sheets are persisted hand-off records: one numbered sheet per batch of
// parcels sent out for delivery with a rider.

export interface RunSheetParcel {
  id: string;
  orderNumber: number;
  trackingId: string;
  status: ParcelStatus;
  receiverName: string;
  receiverPhone: string;
  address: string;
  destination: string;
  pieces: number;
  weightKg?: number;
  codAmount: number;
  vendorName: string;
  deliveryInstruction: string;
  deliveredAt: string | null;
}

export interface RunSheet {
  id: string;
  sheetNo: string;
  rider: {
    id: string;
    name: string;
    phone: string;
    vehicleNo: string;
    hub: string;
  };
  createdAt: string;
  updatedAt: string;
  totalItems: number;
  deliveredItems: number;
  failedItems: number;
  outItems: number;
  totalCod: number;
  codCollected: number;
  parcels: RunSheetParcel[];
}

export interface RunSheetResponse {
  success: boolean;
  data: {
    date: string;
    summary: {
      totalSheets: number;
      totalItems: number;
      deliveredItems: number;
      outItems: number;
      totalCod: number;
    };
    sheets: RunSheet[];
  };
}

/** Run sheets for one day (defaults to today), optionally for a single rider. Admin-side only. */
export const getRiderRunSheet = async (
  params?: { riderId?: string; date?: string },
): Promise<RunSheetResponse> => {
  const query: Record<string, string> = {};
  if (params?.riderId) query.riderId = params.riderId;
  if (params?.date) query.date = params.date;
  const response = await api.get('/orders/run-sheet', { params: query });
  return response.data;
};

export interface SenderProfile {
  id: string;
  name: string;
  phone: string;
  address: string;
  locationId: string | null;
}

/** The calling vendor/vendor_staff's own business identity - they ARE the default sender. */
export const getSenderProfile = async (): Promise<{ success: boolean; data: SenderProfile }> => {
  const response = await api.get('/orders/sender-profile');
  return response.data;
};

export interface OrderRemark {
  id: string;
  remark: string;
  addedBy: string;
  createdAt: string;
  parentRemarkId: string | null;
  parentAuthor: string | null;
  parentSnippet: string | null;
}

export interface OrderStatusHistoryEntry {
  id: string;
  oldStatus: ParcelStatus | null;
  newStatus: ParcelStatus;
  remarks: string;
  changedBy: string;
  /** 'user' for staff-visible attribution, 'branch' when the viewer only gets a branch/company name, 'rider' for rider-driven milestones. */
  changedByType: 'user' | 'branch' | 'rider';
  createdAt: string;
}

/** A single COD or delivery-charge adjustment made after the order was created. */
export interface PriceLogEntry {
  id: string;
  field: 'cod' | 'delivery_charge';
  oldValue: number;
  newValue: number;
  changedBy: string;
  createdAt: string;
}

/** One destination change made because the customer moved after booking. */
export interface RedirectLogEntry {
  id: string;
  fromBranch: string | null;
  toBranch: string;
  fromAddress: string | null;
  toAddress: string | null;
  reason: string;
  statusAtRedirect: ParcelStatus;
  oldDeliveryCharge: number;
  redirectCharge: number;
  newDeliveryCharge: number;
  redirectedBy: string;
  createdAt: string;
}

export interface OrderDetail extends Omit<Order, 'remarks'> {
  remarks: OrderRemark[];
  statusHistory: OrderStatusHistoryEntry[];
  /** COD / delivery-charge changes made after creation, newest first. */
  priceLog: PriceLogEntry[];
  /** Destination redirects, newest first. */
  redirectLog: RedirectLogEntry[];
  /** True when the viewer is allowed to change this order's status (super_admin/admin). */
  canChangeStatus: boolean;
}

export const getOrderByTrackingId = async (
  trackingId: string,
): Promise<{ success: boolean; data: OrderDetail }> => {
  const response = await api.get(`/orders/track/${encodeURIComponent(trackingId)}`);
  return response.data;
};

export interface PublicTrackingHistoryEntry {
  status: ParcelStatus;
  location: string | null;
  createdAt: string;
}

export interface PublicTracking {
  trackingId: string;
  status: ParcelStatus;
  serviceType: ServiceType;
  pieces: number;
  origin: string;
  destination: string;
  createdAt: string;
  lastUpdatedAt: string;
  statusHistory: PublicTrackingHistoryEntry[];
}

/** Unauthenticated lookup for the public "track a parcel" page - never carries party/financial detail. */
export const trackParcelPublic = async (
  trackingId: string,
): Promise<{ success: boolean; data: PublicTracking }> => {
  const response = await api.get(`/orders/public-track/${encodeURIComponent(trackingId)}`);
  return response.data;
};

export const addOrderRemark = async (
  orderId: string,
  remark: string,
  parentRemarkId?: string | null,
): Promise<{ success: boolean; data: OrderRemark }> => {
  const response = await api.post(`/orders/${orderId}/remarks`, {
    remark,
    parentRemarkId: parentRemarkId ?? undefined,
  });
  return response.data;
};

export const createOrder = async (data: CreateOrderInput) => {
  const idempotencyKey = uuidv4();
  const response = await api.post('/orders', data, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return response.data;
};

export type UpdateOrderInput = Partial<Omit<CreateOrderInput, 'sender' | 'deliveryCharge' | 'pickupAddress' | 'scheduledPickupAt'>>;

export const updateOrder = async (orderId: string, data: UpdateOrderInput) => {
  const idempotencyKey = uuidv4();
  const response = await api.patch(`/orders/${orderId}`, data, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  notifyOrderStatusChanged();
  return response.data;
};

export interface RedirectOrderInput {
  destinationLocationId: string;
  address: string;
  reason: string;
  /** Diversion fee added on top of the existing delivery charge. */
  redirectCharge: number;
}

/** Admin-only: send a parcel to a different destination because the customer moved. */
export const redirectOrder = async (orderId: string, data: RedirectOrderInput) => {
  const idempotencyKey = uuidv4();
  const response = await api.post(`/orders/${orderId}/redirect`, data, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  notifyOrderStatusChanged();
  return response.data;
};

export const updateOrderStatus = async (
  orderId: string,
  status: ParcelStatus,
  remarks?: string,
  locationId?: string,
  riderId?: string,
) => {
  const idempotencyKey = uuidv4();
  const response = await api.patch(
    `/orders/${orderId}/status`,
    {
      status,
      remarks,
      locationId,
      riderId,
    },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  notifyOrderStatusChanged();
  return response.data;
};

export interface BulkCreateOrderRow {
  sender?: { name: string; phone: string; address?: string };
  receiver: { name: string; phone: string; alternatePhone?: string; address?: string; locationId?: string };
  codAmount?: number;
  /** Declared value of the items in the parcel, separate from COD. */
  itemValue?: number;
  weightKg?: number;
  orderType?: OrderType;
  serviceType?: ServiceType;
  packageType?: string;
  deliveryInstruction?: string;
  originLocationId?: string;
  destinationLocationId?: string;
  /** Set by admin/super_admin/sales when bulk-importing on behalf of a vendor. */
  vendorId?: string;
}

export interface BulkCreateOrderInput {
  defaultSender?: { name: string; phone: string; address?: string };
  orders: BulkCreateOrderRow[];
}

export interface BulkCreateResult {
  created: number;
  failed: number;
  results: Array<
    | { index: number; success: true; trackingId: string }
    | { index: number; success: false; error: string }
  >;
}

export const bulkCreateOrders = async (
  input: BulkCreateOrderInput,
): Promise<{ success: boolean; message: string; data: BulkCreateResult }> => {
  const idempotencyKey = uuidv4();
  const response = await api.post('/orders/bulk', input, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  notifyOrderStatusChanged();
  return response.data;
};

export const bulkUpdateOrderStatus = async (
  ids: string[],
  status: ParcelStatus,
  options?: BulkStatusOptions,
): Promise<{ success: boolean; message: string; data: BulkStatusResult }> => {
  const idempotencyKey = uuidv4();
  const response = await api.patch(
    '/orders/bulk-status',
    {
      ids,
      status,
      remarks: options?.remarks,
      toLocationId: options?.toLocationId,
      riderId: options?.riderId,
      codCollected: options?.codCollected,
    },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  notifyOrderStatusChanged();
  return response.data;
};

// ── Trash (soft-deleted orders) ──────────────────────────────────────────────
// Admin-only on the server. Trashed orders are excluded from every other list,
// so the only way back to one is getTrashedOrders below.

/** Admin-only: soft-delete an order — it leaves every list and lands in the trash. */
export const trashOrder = async (orderId: string) => {
  const response = await api.post(`/orders/${orderId}/trash`);
  notifyOrderStatusChanged();
  return response.data;
};

/** The stages a trashed order can be restored into (server: TRASH_RESTORE_STAGES). */
export const TRASH_RESTORE_STAGES = ['pickup_ordered', 'ready_to_deliver'] as const;
export type TrashRestoreStage = (typeof TRASH_RESTORE_STAGES)[number];

/**
 * Admin-only: put a trashed order back into the live lists at `restoreTo`.
 *
 * This is the only path allowed past the server's STATUS_TRANSITIONS, so it can
 * un-cancel an order — which nothing else in the app can do.
 */
export const restoreOrder = async (orderId: string, restoreTo: TrashRestoreStage) => {
  const response = await api.post(`/orders/${orderId}/restore`, { restoreTo });
  notifyOrderStatusChanged();
  return response.data;
};

/**
 * Admin-only and unrecoverable. The server refuses with 409 for any order
 * carrying accounting or COD records, so callers should surface the message
 * rather than assuming success.
 */
export const deleteOrderPermanently = async (orderId: string) => {
  const response = await api.delete(`/orders/${orderId}/permanent`);
  notifyOrderStatusChanged();
  return response.data;
};

/** Admin-only: the trash listing. Same row shape and paging as getOrders. */
export const getTrashedOrders = async (
  params?: ListOrdersParams,
  signal?: AbortSignal,
): Promise<OrdersListResponse> => {
  const query: Record<string, string> = {};
  if (params?.search) query.search = params.search;
  if (params?.page !== undefined) query.page = String(params.page);
  if (params?.pageSize !== undefined) query.pageSize = String(params.pageSize);
  if (params?.cursor !== undefined) query.cursor = params.cursor;
  if (params?.dir !== undefined) query.dir = params.dir;
  if (params?.sortBy) query.sortBy = params.sortBy;
  if (params?.sortDir) query.sortDir = params.sortDir;

  const response = await api.get('/orders/trash', { params: query, signal });
  return response.data;
};
