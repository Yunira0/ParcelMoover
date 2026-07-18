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
  /** Unused by the new Create Order page - kept for type compat with older flows; the server computes the real charge from the route's delivery rate. */
  deliveryCharge?: number;
  packageType?: string;
  deliveryInstruction?: string;
  pickupAddress?: string;
  scheduledPickupAt?: string;
  vendorId?: string;
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
  pieces: number;
  weightKg?: number;
  attemptCount: number;
  codAmount: number;
  deliveryCharge: number;
  packageType?: string;
  deliveryInstruction?: string;
  vendorId: string | null;
  vendorName?: string;
  vendorLocation?: string;
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
}

export const ORDER_SORT_FIELDS = ['createdAt', 'codAmount', 'deliveryCharge', 'trackingId', 'status'] as const;
export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

export interface ListOrdersParams {
  status?: ParcelStatus[];
  orderType?: OrderType;
  search?: string;
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
    totalDelivered: number;
    totalDeliveredAmount: number;
    totalReturns: number;
    totalReturnsAmount: number;
  };
  today: {
    totalOrders: number;
    delivered: number;
    inTransit: number;
    returns: number;
    remarks: number;
    unclosedComments: number;
  };
  codSettlement: {
    totalCod: number;
    settledCod: number;
    pendingCod: number;
    /** Cash riders have collected but not yet remitted to the office. */
    codFromRider: number;
    progressPercent: number;
    scopedToRider: boolean;
    lastAmount: number;
    lastSettledAt: string | null;
  };
  weeklyTrend: DashboardTrendDay[];
  updatedAt: string;
}

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
  if (params?.search) query.search = params.search;
  if (params?.page !== undefined) query.page = String(params.page);
  if (params?.pageSize !== undefined) query.pageSize = String(params.pageSize);
  if (params?.cursor !== undefined) query.cursor = params.cursor;
  if (params?.dir !== undefined) query.dir = params.dir;
  if (params?.sortBy) query.sortBy = params.sortBy;
  if (params?.sortDir) query.sortDir = params.sortDir;
  if (params?.withArrival) query.withArrival = 'true';

  const response = await api.get('/orders', { params: query, signal });
  return response.data;
};

export const getDashboardSummary = async (trendDays: 7 | 30 = 7) => {
  const response = await api.get('/orders/dashboard-summary', { params: { trendDays } });
  return response.data;
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
  /** 'user' for staff-visible attribution, 'branch' when the viewer only gets a branch/company name. */
  changedByType: 'user' | 'branch';
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

export interface OrderDetail extends Omit<Order, 'remarks'> {
  remarks: OrderRemark[];
  statusHistory: OrderStatusHistoryEntry[];
  /** COD / delivery-charge changes made after creation, newest first. */
  priceLog: PriceLogEntry[];
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

export type UpdateOrderInput = Partial<Omit<CreateOrderInput, 'sender' | 'vendorId' | 'deliveryCharge' | 'pickupAddress' | 'scheduledPickupAt'>>;

export const updateOrder = async (orderId: string, data: UpdateOrderInput) => {
  const idempotencyKey = uuidv4();
  const response = await api.patch(`/orders/${orderId}`, data, {
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
