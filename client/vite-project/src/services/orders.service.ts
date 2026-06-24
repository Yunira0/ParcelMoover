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
  | 'cancelled';

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

export interface ListOrdersParams {
  status?: ParcelStatus[];
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface OrdersPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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

export interface DashboardSummary {
  overview: {
    totalOrders: number;
    pendingPickups: number;
    pendingReturns: number;
    inTransit: number;
    pendingDeliveries: number;
  };
  today: {
    totalOrders: number;
    delivered: number;
    inTransit: number;
    returns: number;
  };
  codSettlement: {
    totalCod: number;
    settledCod: number;
    pendingCod: number;
    progressPercent: number;
    scopedToRider: boolean;
  };
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

export const getOrders = async (params?: ListOrdersParams): Promise<OrdersListResponse> => {
  const query: Record<string, string> = {};
  if (params?.status?.length) query.status = params.status.join(',');
  if (params?.search) query.search = params.search;
  if (params?.page !== undefined) query.page = String(params.page);
  if (params?.pageSize !== undefined) query.pageSize = String(params.pageSize);

  const response = await api.get('/orders', { params: query });
  return response.data;
};

export const getDashboardSummary = async () => {
  const response = await api.get('/orders/dashboard-summary');
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
  const response = await api.patch(`/orders/${orderId}/status`, {
    status,
    remarks,
    locationId,
    riderId,
  });
  notifyOrderStatusChanged();
  return response.data;
};

export const bulkUpdateOrderStatus = async (
  ids: string[],
  status: ParcelStatus,
  options?: BulkStatusOptions,
): Promise<{ success: boolean; message: string; data: BulkStatusResult }> => {
  const response = await api.patch('/orders/bulk-status', {
    ids,
    status,
    remarks: options?.remarks,
    toLocationId: options?.toLocationId,
    riderId: options?.riderId,
  });
  notifyOrderStatusChanged();
  return response.data;
};
