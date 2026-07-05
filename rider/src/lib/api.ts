import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  timeout: 12000,
})

// Attach CSRF token from localStorage on every mutating request
api.interceptors.request.use((config) => {
  const csrf = localStorage.getItem('csrfToken')
  if (csrf && ['post', 'patch', 'put', 'delete'].includes(config.method ?? '')) {
    config.headers['X-CSRF-Token'] = csrf
  }
  return config
})

export interface LoginPayload {
  email: string
  password: string
}

export interface RiderUser {
  id: string
  fullName: string
  email: string
  phone: string
  roles: string[]
  mustChangePassword?: boolean
}

export async function loginRider(payload: LoginPayload): Promise<RiderUser> {
  const { data } = await api.post<{
    success: boolean
    message: string
    data: RiderUser
    csrfToken: string
    token: string
  }>('/auth/login', payload)

  if (!data.success) throw new Error(data.message)

  const roles: string[] = (data.data as any).roles ?? []
  if (!roles.includes('rider')) {
    throw new Error('Access denied. This app is for riders only.')
  }

  localStorage.setItem('csrfToken', data.csrfToken)
  localStorage.setItem('rider', JSON.stringify(data.data))
  return data.data
}

// ── Parcel types ──────────────────────────────────────────────────────────
export type ParcelStatus =
  | 'pickup_ordered' | 'rider_assigned' | 'picked_up' | 'arrived'
  | 'ready_to_deliver' | 'sent_for_delivery' | 'oov' | 'dispatched'
  | 'arrived_at_branch' | 'hold' | 'loss_and_damage'
  | 'delivered' | 'partially_delivered' | 'failed_pickup' | 'failed_delivery' | 'cancelled'

export interface Parcel {
  id: string
  trackingId: string
  status: ParcelStatus
  orderType: string
  senderName: string
  senderPhone: string
  receiverName: string
  receiverPhone: string
  origin: string
  destination: string
  riderName?: string
  vendorName?: string
  pieces?: number
  weightKg?: number
  codAmount?: number
  deliveryCharge?: number
  createdAt: string
}

// Rider-allowed transitions only
export const RIDER_TRANSITIONS: Partial<Record<ParcelStatus, ParcelStatus[]>> = {
  rider_assigned:    ['picked_up', 'failed_pickup'],
  picked_up:         ['arrived'],
  dispatched:        ['arrived_at_branch'],
  sent_for_delivery: ['delivered', 'partially_delivered', 'failed_delivery'],
}

// ── Dashboard ─────────────────────────────────────────────────────────────
export interface DashboardSummary {
  overview: {
    totalOrders: number
    pendingPickups: number
    pendingReturns: number
    inTransit: number
    pendingDeliveries: number
    totalDelivered: number
    totalPickedUp: number
    totalReturns: number
  }
  today: {
    totalOrders: number
    delivered: number
    inTransit: number
    returns: number
  }
  codSettlement: {
    totalCod: number
    settledCod: number
    pendingCod: number
    pendingCodCount: number
    progressPercent: number
  }
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const { data } = await api.get<{ success: boolean; data: DashboardSummary }>(
    '/orders/dashboard-summary'
  )
  return data.data
}

export async function getRiderParcels(): Promise<Parcel[]> {
  const { data } = await api.get<{ success: boolean; data: Parcel[] }>('/orders')
  return data.data ?? []
}

export async function getParcelByTrackingId(trackingId: string, signal?: AbortSignal): Promise<Parcel> {
  const { data } = await api.get<{ success: boolean; data: Parcel }>(
    `/orders/track/${trackingId}`,
    { signal },
  )
  if (!data.success) throw new Error('Parcel not found')
  return data.data
}

export async function updateParcelStatus(
  orderId: string,
  status: ParcelStatus,
  remarks?: string,
  codCollected?: number,
): Promise<void> {
  const idempotencyKey = crypto.randomUUID()
  const { data } = await api.patch<{ success: boolean; message: string }>(
    `/orders/${orderId}/status`,
    { status, remarks, codCollected },
    { headers: { 'Idempotency-Key': idempotencyKey } }
  )
  if (!data.success) throw new Error(data.message)
}

export async function logoutRider() {
  localStorage.removeItem('csrfToken')
  localStorage.removeItem('rider')
}

export function getCachedRider(): RiderUser | null {
  try {
    const raw = localStorage.getItem('rider')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
