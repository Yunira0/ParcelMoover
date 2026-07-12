import React from 'react';
import Dashboard from './Dashboard';
import VendorDashboard from './vendor/VendorDashboard';
import SalesDashboard from './sales/SalesDashboard';
import { isVendorSide, isSalesUser } from '../utils/auth';

const DashboardRouter: React.FC = () => {
  if (isVendorSide()) return <VendorDashboard />;
  if (isSalesUser()) return <SalesDashboard />;
  return <Dashboard />;
};

export default DashboardRouter;
