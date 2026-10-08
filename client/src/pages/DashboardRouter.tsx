import React, { lazy } from 'react';
import { isVendorSide, isSalesUser } from '../utils/auth';

const Dashboard = lazy(() => import('./Dashboard'));
const VendorDashboard = lazy(() => import('./vendor/VendorDashboard'));
const SalesDashboard = lazy(() => import('./sales/SalesDashboard'));

const DashboardRouter: React.FC = () => {
  if (isVendorSide()) return <VendorDashboard />;
  if (isSalesUser()) return <SalesDashboard />;
  return <Dashboard />;
};

export default DashboardRouter;
