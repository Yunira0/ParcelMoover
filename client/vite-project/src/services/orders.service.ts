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
  deliveryCharge?: number;
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

export const getOrders = async () => {
  const response = await api.get('/orders');
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
) => {
  const response = await api.patch(`/orders/${orderId}/status`, {
    status,
    remarks,
    locationId,
  });
  notifyOrderStatusChanged();
  return response.data;
};
