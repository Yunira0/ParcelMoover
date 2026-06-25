import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout'
import DashboardLayout from './layouts/DashboardLayout'
import Home from './pages/Home'
import Login from './pages/Login'
import DashboardRouter from './pages/DashboardRouter'
import OrdersRouter from './pages/OrdersRouter'
import CreateOrderPage from './pages/CreateOrderPage'
import OrderDetailPage from './pages/OrderDetailPage'
import AdminManagement from './pages/AdminManagement'
import VendorManagement from './pages/VendorManagement'
import RiderManagement from './pages/RiderManagement'
import FinanceManagement from './pages/FinanceManagement'
import DeliveryRateSettings from './pages/DeliveryRateSettings'
import PickupOperations from './pages/PickupOperations'
import DispatchOperations from './pages/DispatchOperations'
import OOVOperations from './pages/OOVOperations'
import ReturnOperations from './pages/ReturnOperations'
import HoldOperations from './pages/HoldOperations'
import LossAndDamageOperations from './pages/LossAndDamageOperations'
import CXCenter from './pages/CXCenter'
import RemarkDetail from './pages/RemarkDetail'
import TicketDetail from './pages/TicketDetail'
import VendorSettlements from './pages/vendor/VendorSettlements'
import VendorPendingCod from './pages/vendor/VendorPendingCod'
import VendorOrderPayments from './pages/vendor/VendorOrderPayments'
import VendorUserManagement from './pages/vendor/VendorUserManagement'
import VendorDeliveryCharges from './pages/vendor/VendorDeliveryCharges'
import ProtectedRoute from './components/ProtectedRoute'
import RoleGuard from './components/RoleGuard'
import './App.css'
function App() {

  return (
    <Router>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<MainLayout><Home /></MainLayout>} />
        <Route path="/login" element={<MainLayout><Login /></MainLayout>} />

        {/* Protected Dashboard Routes */}
        <Route 
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<DashboardRouter />} />
          <Route path="/orders" element={<OrdersRouter />} />
          <Route path="/orders/create" element={<CreateOrderPage />} />
          <Route path="/orders/track/:trackingId" element={<OrderDetailPage />} />
          <Route path="/admin" element={<AdminManagement />} />
          <Route path="/vendors" element={<VendorManagement />} />
          <Route path="/riders" element={<RiderManagement />} />
          <Route path="/finance" element={<FinanceManagement />} />
          <Route path="/settings/delivery-rates" element={<DeliveryRateSettings />} />
          <Route path="/pickup" element={<PickupOperations />} />
          <Route path="/dispatch" element={<DispatchOperations />} />
          <Route path="/oov" element={<OOVOperations />} />
          <Route path="/return" element={<ReturnOperations />} />
          <Route path="/hold" element={<HoldOperations />} />
          <Route path="/loss-and-damage" element={<LossAndDamageOperations />} />
          <Route path="/tickets" element={<CXCenter />} />
          <Route path="/tickets/:id" element={<TicketDetail />} />
          <Route path="/remarks" element={<CXCenter />} />
          <Route path="/remarks/:id" element={<RemarkDetail />} />
          <Route
            path="/finance/settlements"
            element={<RoleGuard allowedRoles={['vendor']}><VendorSettlements /></RoleGuard>}
          />
          <Route
            path="/finance/pending-cod"
            element={<RoleGuard allowedRoles={['vendor']}><VendorPendingCod /></RoleGuard>}
          />
          <Route
            path="/finance/order-payments"
            element={<RoleGuard allowedRoles={['vendor']}><VendorOrderPayments /></RoleGuard>}
          />
          <Route
            path="/user-management"
            element={<RoleGuard allowedRoles={['vendor']}><VendorUserManagement /></RoleGuard>}
          />
          <Route
            path="/delivery-charges"
            element={<RoleGuard allowedRoles={['vendor']}><VendorDeliveryCharges /></RoleGuard>}
          />
        </Route>
        {/* Catch-all */}

      </Routes>
    </Router>
  )
}

export default App
