import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout'
import DashboardLayout from './layouts/DashboardLayout'
import Home from './pages/Home'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import OrderManagement from './pages/OrderManagement'
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
import Tickets from './pages/Tickets'
import Remarks from './pages/Remarks'
import RemarkDetail from './pages/RemarkDetail'
import ProtectedRoute from './components/ProtectedRoute'
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
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/orders" element={<OrderManagement />} />
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
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/remarks" element={<Remarks />} />
          <Route path="/remarks/:id" element={<RemarkDetail />} />
        </Route>
        {/* Catch-all */}

      </Routes>
    </Router>
  )
}

export default App
