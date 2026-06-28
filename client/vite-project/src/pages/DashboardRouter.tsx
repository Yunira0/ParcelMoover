import React from 'react';
import Dashboard from './Dashboard';
import VendorDashboard from './vendor/VendorDashboard';
import { isVendorSide } from '../utils/auth';

const DashboardRouter: React.FC = () => (
  isVendorSide() ? <VendorDashboard /> : <Dashboard />
);

export default DashboardRouter;
