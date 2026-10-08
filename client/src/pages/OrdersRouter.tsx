import React, { lazy } from 'react';
import { isVendorSide } from '../utils/auth';

const OrderManagement = lazy(() => import('./OrderManagement'));
const VendorOrders = lazy(() => import('./vendor/VendorOrders'));

const OrdersRouter: React.FC = () => (
  isVendorSide() ? <VendorOrders /> : <OrderManagement />
);

export default OrdersRouter;
