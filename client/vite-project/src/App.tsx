import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import MainLayout from './layouts/MainLayout'
import DashboardLayout from './layouts/DashboardLayout'
import Home from './pages/Home'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import OrderManagement from './pages/OrderManagement'
import AdminManagement from './pages/AdminManagement'
import VendorManagement from './pages/VendorManagement'
import RiderManagement from './pages/RiderManagement'
import FinanceManagement from './pages/FinanceManagement'
import PickupOperations from './pages/PickupOperations'
import DispatchOperations from './pages/DispatchOperations'
import OOVOperations from './pages/OOVOperations'
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
          <Route path="/admin" element={<AdminManagement />} />
          <Route path="/vendors" element={<VendorManagement />} />
          <Route path="/riders" element={<RiderManagement />} />
          <Route path="/finance" element={<FinanceManagement />} />
          <Route path="/pickup" element={<PickupOperations />} />
          <Route path="/dispatch" element={<DispatchOperations />} />
          <Route path="/oov" element={<OOVOperations />} />
        </Route>
        {/* Catch-all */}

      </Routes>
    </Router>
  )
}

export default App
