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
import AdminFormPage from './pages/AdminFormPage'
import VendorManagement from './pages/VendorManagement'
import VendorFormPage from './pages/VendorFormPage'
import RiderManagement from './pages/RiderManagement'
import RiderFormPage from './pages/RiderFormPage'
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
import StaffFormPage from './pages/vendor/StaffFormPage'
import BulkOrderPage from './pages/vendor/BulkOrderPage'
import VendorDeliveryCharges from './pages/vendor/VendorDeliveryCharges'
import ForceChangePasswordPage from './pages/ForceChangePasswordPage'
import KycApplicationPage from './pages/KycApplicationPage'
import KycManagement from './pages/KycManagement'
import ProfilePage from './pages/ProfilePage'
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
        {/* Standalone — no sidebar/topnav, intentionally outside ProtectedRoute */}
        <Route path="/change-password" element={<ForceChangePasswordPage />} />
        <Route path="/apply" element={<KycApplicationPage />} />

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
          <Route
            path="/orders/create"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'vendor', 'vendor_staff']}><CreateOrderPage /></RoleGuard>}
          />
          <Route
            path="/orders/bulk-create"
            element={<RoleGuard allowedRoles={['vendor', 'vendor_staff']}><BulkOrderPage /></RoleGuard>}
          />
          <Route path="/orders/track/:trackingId" element={<OrderDetailPage />} />
          <Route
            path="/admin"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><AdminManagement /></RoleGuard>}
          />
          <Route
            path="/admin/new"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><AdminFormPage /></RoleGuard>}
          />
          <Route
            path="/vendors"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><VendorManagement /></RoleGuard>}
          />
          <Route
            path="/vendors/new"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><VendorFormPage /></RoleGuard>}
          />
          <Route
            path="/kyc-applications"
            element={<RoleGuard allowedRoles={['super_admin']}><KycManagement /></RoleGuard>}
          />
          <Route
            path="/riders"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><RiderManagement /></RoleGuard>}
          />
          <Route
            path="/riders/new"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><RiderFormPage /></RoleGuard>}
          />
          <Route
            path="/finance"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><FinanceManagement /></RoleGuard>}
          />
          <Route
            path="/settings/delivery-rates"
            element={<RoleGuard allowedRoles={['super_admin']}><DeliveryRateSettings /></RoleGuard>}
          />
          <Route
            path="/pickup"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><PickupOperations /></RoleGuard>}
          />
          <Route
            path="/dispatch"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><DispatchOperations /></RoleGuard>}
          />
          <Route
            path="/oov"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><OOVOperations /></RoleGuard>}
          />
          <Route
            path="/return"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><ReturnOperations /></RoleGuard>}
          />
          <Route
            path="/hold"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><HoldOperations /></RoleGuard>}
          />
          <Route
            path="/loss-and-damage"
            element={<RoleGuard allowedRoles={['super_admin', 'admin']}><LossAndDamageOperations /></RoleGuard>}
          />
          <Route
            path="/tickets"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'vendor', 'vendor_staff']}><CXCenter /></RoleGuard>}
          />
          <Route
            path="/tickets/:id"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'vendor', 'vendor_staff']}><TicketDetail /></RoleGuard>}
          />
          <Route
            path="/remarks"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'vendor', 'vendor_staff']}><CXCenter /></RoleGuard>}
          />
          <Route
            path="/remarks/:id"
            element={<RoleGuard allowedRoles={['super_admin', 'admin', 'vendor', 'vendor_staff']}><RemarkDetail /></RoleGuard>}
          />
          <Route
            path="/finance/settlements"
            element={<RoleGuard allowedRoles={['vendor', 'vendor_staff']}><VendorSettlements /></RoleGuard>}
          />
          <Route
            path="/finance/pending-cod"
            element={<RoleGuard allowedRoles={['vendor', 'vendor_staff']}><VendorPendingCod /></RoleGuard>}
          />
          <Route
            path="/finance/order-payments"
            element={<RoleGuard allowedRoles={['vendor', 'vendor_staff']}><VendorOrderPayments /></RoleGuard>}
          />
          <Route
            path="/user-management"
            element={<RoleGuard allowedRoles={['vendor']}><VendorUserManagement /></RoleGuard>}
          />
          <Route
            path="/user-management/staff/new"
            element={<RoleGuard allowedRoles={['vendor']}><StaffFormPage /></RoleGuard>}
          />
          <Route
            path="/user-management/staff/:id/edit"
            element={<RoleGuard allowedRoles={['vendor']}><StaffFormPage /></RoleGuard>}
          />
          <Route
            path="/delivery-charges"
            element={<RoleGuard allowedRoles={['vendor', 'vendor_staff']}><VendorDeliveryCharges /></RoleGuard>}
          />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
        {/* Catch-all */}

      </Routes>
    </Router>
  )
}

export default App
