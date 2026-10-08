import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import {
  clearDeactivatedFlag,
  getCachedRider,
  getDeactivatedFlag,
  logoutRider,
  setDeactivatedFlag,
  setUnauthorizedHandler,
  validateSession,
  type RiderUser,
} from '../lib/api'

interface AuthState {
  rider: RiderUser | null
  /** True when the server said this account was deactivated by an admin. */
  deactivated: boolean
  login: (user: RiderUser) => void
  logout: () => void
  updateRider: (patch: Partial<RiderUser>) => void
  markDeactivated: () => void
  /** "Back to sign in" from the deactivated screen. */
  resetDeactivated: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [rider, setRider] = useState<RiderUser | null>(getCachedRider)
  const [deactivated, setDeactivated] = useState(getDeactivatedFlag)

  const login = useCallback((user: RiderUser) => {
    setDeactivated(false)
    setRider(user)
  }, [])

  const markDeactivated = useCallback(() => {
    setDeactivatedFlag()
    setDeactivated(true)
  }, [])

  const resetDeactivated = useCallback(() => {
    clearDeactivatedFlag()
    setDeactivated(false)
  }, [])

  const logout = useCallback(() => {
    logoutRider()
    setRider(null)
  }, [])

  // Patches the cached rider (e.g. clearing mustChangePassword after a forced
  // change) in both React state and localStorage, so a page reload doesn't
  // re-hydrate the stale flag from the cache and re-trigger the forced screen.
  const updateRider = useCallback((patch: Partial<RiderUser>) => {
    setRider(prev => {
      if (!prev) return prev
      const next = { ...prev, ...patch }
      localStorage.setItem('rider', JSON.stringify(next))
      return next
    })
  }, [])

  // An expired/revoked session (401 from any authenticated call) drops the
  // cached rider so ProtectedLayout's <Navigate to="/welcome"> takes over,
  // instead of the app sitting on a dead session showing raw error toasts.
  useEffect(() => {
    setUnauthorizedHandler((reason) => {
      setRider(null)
      if (reason === 'deactivated') setDeactivated(true)
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  // A rider deactivated by an admin must lose access even while sitting on
  // cached PWA screens that never fetch. Probe /me on boot and whenever the
  // app returns to the foreground or comes back online - if the account is
  // inactive the probe 401s and the interceptor clears the cached session.
  useEffect(() => {
    if (!rider) return
    validateSession()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') validateSession()
    }
    const onOnline = () => validateSession()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
    }
  }, [rider?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthContext.Provider
      value={{ rider, deactivated, login, logout, updateRider, markDeactivated, resetDeactivated }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
