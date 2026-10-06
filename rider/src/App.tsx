import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { PendingProvider } from './context/PendingContext'
import BottomNav from './components/BottomNav'
import OfflineBanner from './components/OfflineBanner'
import LoginPage from './pages/LoginPage'
import DeactivatedPage from './pages/DeactivatedPage'
import DashboardPage from './pages/DashboardPage'
import PendingPage from './pages/PendingPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import SettlementsPage from './pages/SettlementsPage'
import OrderListPage from './pages/OrderListPage'
import ProfilePage from './pages/ProfilePage'
import ProfileChangePasswordPage from './pages/ProfileChangePasswordPage'

// Heavy scanner lib (ZXing) is split into its own chunk
const ScannerPage = lazy(() => import('./pages/ScannerPage'))

function ScannerFallback() {
  return (
    <div className="flex-1 flex items-center justify-center bg-black">
      <div className="w-8 h-8 border-2 border-rust border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ProtectedLayout() {
  const { rider } = useAuth()
  if (!rider) return <Navigate to="/login" replace />
  // A pending forced password change blocks every other screen — the backend
  // rejects every other authenticated call anyway, so there's nothing else
  // useful to show until this is resolved.
  if (rider.mustChangePassword) {
    return (
      <div className="flex flex-col h-dvh overflow-hidden">
        <OfflineBanner />
        <ChangePasswordPage />
      </div>
    )
  }
  return (
    <PendingProvider>
      <div className="flex flex-col h-dvh overflow-hidden">
        <OfflineBanner />
        <Routes>
          <Route path="/scan"      element={<Suspense fallback={<ScannerFallback />}><ScannerPage /></Suspense>} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/pending"   element={<PendingPage />} />
          <Route path="/settlements" element={<SettlementsPage />} />
          <Route path="/orders"      element={<OrderListPage />} />
          <Route path="/profile"     element={<ProfilePage />} />
          <Route path="/profile/change-password" element={<ProfileChangePasswordPage />} />
          <Route path="*"          element={<Navigate to="/scan" replace />} />
        </Routes>
        <BottomNav />
      </div>
    </PendingProvider>
  )
}

function PublicLayout() {
  const { rider } = useAuth()
  if (rider) return <Navigate to="/scan" replace />
  return (
    <div className="flex flex-col h-full min-h-dvh">
      <OfflineBanner />
      <Routes>
        <Route path="/login"   element={<LoginPage />} />
        <Route path="*"        element={<Navigate to="/login" replace />} />
      </Routes>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <HashRouter>
          <OfflineBanner />
          <AuthRouter />
        </HashRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}

function AuthRouter() {
  const { rider, deactivated } = useAuth()
  // A deactivated account gets no portal at all - not even the login form -
  // until the rider explicitly leaves this screen via "Back to sign in".
  if (!rider && deactivated) return <DeactivatedPage />
  return rider ? <ProtectedLayout /> : <PublicLayout />
}
