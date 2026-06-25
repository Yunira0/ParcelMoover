import React from 'react';
import Dashboard from './Dashboard';
import VendorDashboard from './vendor/VendorDashboard';
import { getCurrentUserRoles } from '../utils/auth';

// /dashboard renders a different page per role - vendors get a dashboard
// scoped to their own orders/COD; staff get the full operational overview.
const DashboardRouter: React.FC = () => {
  const roles = getCurrentUserRoles();
  const isStaff = roles.includes('super_admin') || roles.includes('admin');
  const isVendorOnly = roles.includes('vendor') && !isStaff;

  return isVendorOnly ? <VendorDashboard /> : <Dashboard />;
};

export default DashboardRouter;
