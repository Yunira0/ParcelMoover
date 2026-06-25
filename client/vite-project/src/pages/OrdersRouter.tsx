import React from 'react';
import OrderManagement from './OrderManagement';
import VendorOrders from './vendor/VendorOrders';
import { getCurrentUserRoles } from '../utils/auth';

// /orders renders a different page per role - vendors get a focused order list
// scoped to their own parcels; staff get the full operational order management.
const OrdersRouter: React.FC = () => {
  const roles = getCurrentUserRoles();
  const isStaff = roles.includes('super_admin') || roles.includes('admin');
  const isVendorOnly = roles.includes('vendor') && !isStaff;

  return isVendorOnly ? <VendorOrders /> : <OrderManagement />;
};

export default OrdersRouter;
