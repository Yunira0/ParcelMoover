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
  | 'failed_pickup'
  | 'failed_delivery'
  | 'cancelled'
  | 'follow_up'
  | 'ready_to_return'
  | 'sent_to_vendor'
  | 'returned_to_vendor';

export type OrderType = 'delivery' | 'exchange' | 'return';
export type ServiceType = 'dtd' | 'btd' | 'btb' | 'dtb';

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
  origin: string;
  destination: string;
  pieces: number;
  weightKg?: number;
  codAmount: number;
  deliveryCharge: number;
  vendorName?: string;
  riderName?: string;
  remarks?: string;
  lastUpdatedBy?: string;
  lastUpdatedAt?: string;
  createdAt: string;
}

export const ORDER_SORT_FIELDS = ['createdAt', 'codAmount', 'deliveryCharge', 'trackingId', 'status'] as const;
export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

export interface ListOrdersParams {
  status?: ParcelStatus[];
  orderType?: OrderType;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: OrderSortField;
  sortDir?: 'asc' | 'desc';
}

export interface OrdersPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  // Set when the caller didn't request pagination and the result was capped.
  truncated?: boolean;
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
  delivered: number;
  returned: number;
}

export interface DashboardSummary {
  overview: {
    totalOrders: number;
    pendingPickups: number;
    pendingReturns: number;
    inTransit: number;
    pendingDeliveries: number;
    totalDelivered: number;
    totalReturns: number;
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
  if (params?.sortBy) query.sortBy = params.sortBy;
  if (params?.sortDir) query.sortDir = params.sortDir;

  const response = await api.get('/orders', { params: query, signal });
  return response.data;
};

export const getDashboardSummary = async () => {
  const response = await api.get('/orders/dashboard-summary');
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

export interface OrderDetail extends Omit<Order, 'remarks'> {
  remarks: OrderRemark[];
  statusHistory: OrderStatusHistoryEntry[];
  /** True when the viewer is allowed to change this order's status (super_admin/admin). */
  canChangeStatus: boolean;
}

export const getOrderByTrackingId = async (
  trackingId: string,
): Promise<{ success: boolean; data: OrderDetail }> => {
  const response = await api.get(`/orders/track/${encodeURIComponent(trackingId)}`);
  return response.data;
};

export const addOrderRemark = async (
  orderId: string,
  remark: string,
  parentRemarkId?: string | null,
): Promise<{ success: boolean; data: OrderRemark }> => {
  const response = await api.post(`/orders/${orderId}/remarks`, { remark, parentRemarkId });
  return response.data;
};

export const createOrder = async (data: CreateOrderInput) => {
  const idempotencyKey = uuidv4();
  const response = await api.post('/orders', data, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
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
  receiver: { name: string; phone: string; alternatePhone?: string; address?: string };
  codAmount?: number;
  weightKg?: number;
  orderType?: OrderType;
  serviceType?: ServiceType;
  deliveryInstruction?: string;
  originLocationId?: string;
  destinationLocationId?: string;
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
    },
    { headers: { 'Idempotency-Key': idempotencyKey } },
  );
  notifyOrderStatusChanged();
  return response.data;
};
