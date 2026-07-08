import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api'

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  timeout: 12000,
})

// The server already sets csrfToken as a non-httpOnly cookie on login (it has
// to be JS-readable for the double-submit pattern below to work at all) - so
// reading it from there instead of keeping a second copy in localStorage adds
// no XSS exposure beyond what already exists, while avoiding a manually
// managed, easily-stale duplicate of the same value.
function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

// Attach CSRF token from the cookie on every mutating request
api.interceptors.request.use((config) => {
  const csrf = getCookie('csrfToken')
  if (csrf && ['post', 'patch', 'put', 'delete'].includes(config.method ?? '')) {
    config.headers['X-CSRF-Token'] = csrf
  }
  return config
})

// Guard so concurrent 401s (e.g. several requests firing at once) only
// trigger a single cleanup + redirect.
let isHandlingSessionExpiry = false

// Response interceptor: when the session is no longer valid (401), clear the
// local session and send the rider to the login screen instead of leaving
// them stuck on a screen full of failed requests with no way out.
//
// NOTE: we intentionally do NOT treat 403 as session-expiry - 403 is used for
// legitimate authorization denials (CSRF, role checks) where logging the
// rider out would be wrong.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    const requestUrl: string = error.config?.url ?? ''

    // A 401 on the login request means "wrong credentials" - let the login
    // page display that; don't redirect (there's nothing to log out of).
    const isLoginRequest = requestUrl.includes('/auth/login')

    if (status === 401 && !isLoginRequest && !isHandlingSessionExpiry) {
      isHandlingSessionExpiry = true
      localStorage.removeItem('rider')

      if (window.location.pathname !== '/login') {
        // Full-page redirect: this interceptor lives outside React Router, so
        // it can't use navigate() here.
        window.location.assign('/login?expired=1')
      }
    }

    return Promise.reject(error)
  }
)

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
  }>('/auth/login', payload)

  if (!data.success) throw new Error(data.message)

  const roles: string[] = (data.data as any).roles ?? []
  if (!roles.includes('rider')) {
    throw new Error('Access denied. This app is for riders only.')
  }

  localStorage.setItem('rider', JSON.stringify(data.data))
  return data.data
}

// ── Parcel types ──────────────────────────────────────────────────────────
export type ParcelStatus =
  | 'pickup_ordered' | 'rider_assigned' | 'picked_up' | 'arrived'
  | 'ready_to_deliver' | 'sent_for_delivery' | 'oov' | 'dispatched'
  | 'arrived_at_branch' | 'hold' | 'loss_and_damage'
  | 'delivered' | 'failed_pickup' | 'failed_delivery' | 'cancelled'

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
  sent_for_delivery: ['delivered', 'failed_delivery'],
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
  remarks?: string
): Promise<void> {
  const idempotencyKey = crypto.randomUUID()
  const { data } = await api.patch<{ success: boolean; message: string }>(
    `/orders/${orderId}/status`,
    { status, remarks },
    { headers: { 'Idempotency-Key': idempotencyKey } }
  )
  if (!data.success) throw new Error(data.message)
}

export async function logoutRider() {
  try {
    await api.post('/auth/logout')
  } catch (err) {
    // Best-effort: still clear the local session below even if the request
    // fails (offline, timeout) - the rider must be able to log out locally
    // regardless. The server-side token naturally expires on its own schedule.
    console.error('Failed to revoke session on logout:', err)
  }
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
