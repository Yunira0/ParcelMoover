import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { getCachedRider, logoutRider, type RiderUser } from '../lib/api'

interface AuthState {
  rider: RiderUser | null
  login: (user: RiderUser) => void
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [rider, setRider] = useState<RiderUser | null>(getCachedRider)

  const login = useCallback((user: RiderUser) => setRider(user), [])

  const logout = useCallback(() => {
    logoutRider()
    setRider(null)
  }, [])

  return (
    <AuthContext.Provider value={{ rider, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
