import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { PendingProvider } from './context/PendingContext'
import BottomNav from './components/BottomNav'
import WelcomePage from './pages/WelcomePage'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import PendingPage from './pages/PendingPage'

// Heavy scanner lib (ZXing) is split into its own chunk
const ScannerPage = lazy(() => import('./pages/ScannerPage'))

function ScannerFallback() {
  return (
    <div className="flex-1 flex items-center justify-center bg-black">
      <div className="w-8 h-8 border-2 border-[--color-brand] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ProtectedLayout() {
  const { rider } = useAuth()
  if (!rider) return <Navigate to="/welcome" replace />
  return (
    <PendingProvider>
      <div className="flex flex-col h-dvh overflow-hidden">
        <Routes>
          <Route path="/scan"      element={<Suspense fallback={<ScannerFallback />}><ScannerPage /></Suspense>} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/pending"   element={<PendingPage />} />
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
      <Routes>
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/login"   element={<LoginPage />} />
        <Route path="*"        element={<Navigate to="/welcome" replace />} />
      </Routes>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AuthRouter />
      </BrowserRouter>
    </AuthProvider>
  )
}

function AuthRouter() {
  const { rider } = useAuth()
  return rider ? <ProtectedLayout /> : <PublicLayout />
}
