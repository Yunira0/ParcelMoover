import React from 'react';
import OrderManagement from './OrderManagement';
import VendorOrders from './vendor/VendorOrders';
import { isVendorSide } from '../utils/auth';

const OrdersRouter: React.FC = () => (
  isVendorSide() ? <VendorOrders /> : <OrderManagement />
);

export default OrdersRouter;
