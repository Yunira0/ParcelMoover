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

// Set by AuthContext so an expired/revoked session can clear app state and let
// the router fall back to /welcome, without api.ts needing to know about React.
// reason 'deactivated' means the account was disabled by an admin, not just an
// expired session - the app shows the dedicated deactivated screen for it.
let onUnauthorized: ((reason?: 'deactivated') => void) | null = null
export function setUnauthorizedHandler(fn: ((reason?: 'deactivated') => void) | null) {
  onUnauthorized = fn
}

// Persisted separately from the session cache so a relaunch of the PWA still
// lands on the deactivated screen instead of the login form.
const DEACTIVATED_FLAG = 'riderDeactivated'
export const getDeactivatedFlag = () => localStorage.getItem(DEACTIVATED_FLAG) === '1'
export const setDeactivatedFlag = () => localStorage.setItem(DEACTIVATED_FLAG, '1')
export const clearDeactivatedFlag = () => localStorage.removeItem(DEACTIVATED_FLAG)

/** True when the server rejected the request because the account is deactivated. */
export function isAccountInactiveError(error: unknown): boolean {
  return (error as any)?.response?.data?.code === 'ACCOUNT_INACTIVE'
}

api.interceptors.response.use(
  (res) => res,
  (error) => {
    // Surface the backend's actual error message instead of axios's generic
    // "Request failed with status code NNN" — every failure path in the API
    // returns { success: false, message } alongside the non-2xx status.
    const backendMessage = error.response?.data?.message
    if (backendMessage) error.message = backendMessage

    // Both the auth middleware (401) and the login endpoint (403) tag
    // deactivated accounts with this code.
    if (isAccountInactiveError(error)) setDeactivatedFlag()

    // A 401 from /auth/login just means "wrong credentials" — handled inline
    // by the login form. Anywhere else, it means the session has expired or
    // been revoked, so clear local state and let the app fall back to login.
    const isLoginRequest = error.config?.url?.includes('/auth/login')
    if (error.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem('rider')
      onUnauthorized?.(isAccountInactiveError(error) ? 'deactivated' : undefined)
    }

    return Promise.reject(error)
  },
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

  const roles: string[] = (data.data as any).roles ?? []
  if (!roles.includes('rider')) {
    throw new Error('Access denied. This app is for riders only.')
  }

  // The login response's Set-Cookie header already wrote the csrfToken
  // cookie the request interceptor reads from - only the profile needs a
  // client-side cache, to hydrate AuthContext without a round trip on boot.
  localStorage.setItem('rider', JSON.stringify(data.data))
  // A successful login proves the account is active again.
  clearDeactivatedFlag()
  return data.data
}

// ── Parcel types ──────────────────────────────────────────────────────────
export type ParcelStatus =
  | 'pickup_ordered' | 'rider_assigned' | 'picked_up' | 'arrived'
  | 'ready_to_deliver' | 'sent_for_delivery' | 'oov' | 'dispatched'
  | 'arrived_at_branch' | 'hold' | 'loss_and_damage'
  | 'delivered' | 'partially_delivered' | 'failed_pickup' | 'failed_delivery' | 'cancelled'
  | 'follow_up' | 'ready_to_return' | 'sent_to_vendor' | 'returned_to_vendor'

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

// Rider-allowed transitions only.
// Note: "arrived" and "arrived_at_branch" are hub operations confirmed by
// admin/hub staff, not the rider — never exposed here, since the backend
// rejects both for a rider actor anyway.
export const RIDER_TRANSITIONS: Partial<Record<ParcelStatus, ParcelStatus[]>> = {
  rider_assigned:    ['picked_up', 'failed_pickup'],
  sent_for_delivery: ['delivered', 'partially_delivered', 'failed_delivery'],
}

// Statuses shown in the rider's "Pending" queue - broader than
// RIDER_TRANSITIONS (which is only the subset with an actionable button
// right now). picked_up/dispatched parcels have no rider action to take at
// that moment but are still worth tracking until they move to the next stage.
export const PENDING_QUEUE_STATUSES: ParcelStatus[] = [
  'rider_assigned', 'picked_up', 'dispatched', 'sent_for_delivery',
]

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

export async function getRiderParcels(statuses?: ParcelStatus[]): Promise<Parcel[]> {
  const { data } = await api.get<{ success: boolean; data: Parcel[] }>('/orders', {
    params: statuses?.length ? { status: statuses.join(',') } : undefined,
  })
  return data.data ?? []
}

export async function getParcelByTrackingId(trackingId: string, signal?: AbortSignal): Promise<Parcel> {
  const { data } = await api.get<{ success: boolean; data: Parcel }>(
    `/orders/track/${trackingId}`,
    { signal },
  )
  return data.data
}

export async function updateParcelStatus(
  orderId: string,
  status: ParcelStatus,
  remarks?: string,
  codCollected?: number,
  // Callers that retry the same logical attempt (e.g. a re-tap after a
  // timeout) should pass the same key back in, so the retry actually dedupes
  // against a possibly-already-applied change instead of defeating the point
  // of idempotency by minting a fresh key every call.
  idempotencyKey: string = crypto.randomUUID(),
  // Set when delivering an exchange order: confirms the rider received the
  // customer's return parcel (required for exchange deliveries; the server
  // auto-creates the linked return order).
  exchangeReturnReceived?: boolean,
): Promise<void> {
  await api.patch(
    `/orders/${orderId}/status`,
    { status, remarks, codCollected, exchangeReturnReceived },
    { headers: { 'Idempotency-Key': idempotencyKey } }
  )
}

// Lightweight session probe. The auth middleware rejects deactivated accounts
// and revoked sessions with a 401, which the response interceptor above turns
// into a local logout. Network failures (offline, server down) are swallowed -
// we can't verify, so the cached session stays until we can reach the server.
export async function validateSession(): Promise<void> {
  try {
    await api.get('/me')
  } catch {
    // 401 already handled by the interceptor; anything else keeps the session.
  }
}

export async function changeRiderPassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/auth/change-password', { currentPassword, newPassword })
}

// ── COD settlement ────────────────────────────────────────────────────────
export interface PendingCodOrder {
  id: string
  codCollectionId: string
  trackingId: string
  receiverName: string
  destination: string
  codAmount: number
  deliveryCharge: number
  netPayable: number
}

export interface PendingCodResult {
  items: PendingCodOrder[]
  totalCod: number
  totalDeliveryCharge: number
  totalNetPayable: number
}

export async function getMyPendingCod(): Promise<PendingCodResult> {
  const { data } = await api.get<{ success: boolean; data: PendingCodResult }>(
    '/finance/unsettled-orders',
    { params: { type: 'rider' } },
  )
  return data.data
}

export interface SettlementStatement {
  id: string
  statementId: string
  transferDate: string | null
  orderCount: number
  amount: number
  status: 'pending' | 'settled'
  remark: string | null
}

export interface SettlementsPage {
  data: SettlementStatement[]
  meta: { page: number; pageSize: number; total: number; totalPages: number }
}

export async function getMySettlements(page = 1, pageSize = 20): Promise<SettlementsPage> {
  const { data } = await api.get<{ success: boolean } & SettlementsPage>(
    '/finance/settlements',
    { params: { payeeType: 'rider', page, pageSize } },
  )
  return { data: data.data, meta: data.meta }
}

export interface SettlementDetailOrder {
  trackingId: string
  receiverName: string
  receiverPhone: string
  destination: string
  codAmount: number
  deliveryCharge: number
  settledAmount: number
  deliveredAt: string | null
}

export interface SettlementDetail {
  id: string
  statementId: string
  payeeName: string
  payeePhone: string
  transferDate: string | null
  amount: number
  payableAmount: number
  status: 'pending' | 'settled'
  remark: string | null
  items: SettlementDetailOrder[]
}

export async function getSettlementDetail(id: string): Promise<SettlementDetail> {
  const { data } = await api.get<{ success: boolean; data: SettlementDetail }>(
    `/finance/settlements/${id}`,
  )
  return data.data
}

export async function logoutRider() {
  try {
    await api.post('/auth/logout')
  } catch (err) {
    // Best-effort: even if the server call fails (e.g. offline), still clear
    // the local session so the app doesn't look logged in.
    console.error('Failed to revoke session on logout:', err)
  } finally {
    // The server call above clears the csrfToken/accessToken cookies via
    // Set-Cookie; only the profile cache is ours to clear here.
    localStorage.removeItem('rider')
  }
}

export function getCachedRider(): RiderUser | null {
  try {
    const raw = localStorage.getItem('rider')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
