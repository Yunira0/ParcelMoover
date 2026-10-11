import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import Table from './Table';
import StatusChip from './StatusChip';
import { getOrders, type Order } from '../services/orders.service';
import { ORDER_STATUS_LABELS, getOrderStatusTone } from '../utils/orderStatus';
import { queryKeys } from '../queries/keys';
import './RecentOrders.css';

const RECENT_LIMIT = 6;

const formatMoney = (value: number) =>
  `Rs. ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const RecentOrders: React.FC = () => {
  const recentQuery = useQuery({
    queryKey: queryKeys.orders.recent(RECENT_LIMIT),
    queryFn: ({ signal }) => getOrders({ sortBy: 'createdAt', sortDir: 'desc', pageSize: RECENT_LIMIT }, signal),
  });
  const orders: Order[] = recentQuery.data?.success && Array.isArray(recentQuery.data.data)
    ? recentQuery.data.data.slice(0, RECENT_LIMIT)
    : [];
  const loading = recentQuery.isPending;
  const error = recentQuery.isError || (recentQuery.data && !recentQuery.data.success)
    ? 'Recent orders are unavailable.'
    : '';

  const columns = [
    {
      header: 'ORDER',
      accessor: (o: Order) => (
        <Link to={`/orders/track/${o.trackingId}`} className="recent-orders-id">
          {o.trackingId}
        </Link>
      ),
    },
    { header: 'VENDOR', accessor: (o: Order) => o.vendorName || o.senderName || '—' },
    { header: 'DESTINATION', accessor: (o: Order) => o.destination || '—' },
    {
      header: 'STATUS',
      accessor: (o: Order) => (
        <StatusChip tone={getOrderStatusTone(o.status)}>{ORDER_STATUS_LABELS[o.status]}</StatusChip>
      ),
    },
    { header: 'COD', accessor: (o: Order) => formatMoney(o.codAmount), className: 'recent-orders-cod' },
  ];

  return (
    <div className="recent-orders">
      <div className="recent-orders-header">
        <h3 className="section-title">Recent Orders</h3>
        <Link to="/orders" className="recent-orders-link">View all orders</Link>
      </div>

      {error && <p className="recent-orders-error">{error}</p>}

      <Table
        columns={columns}
        data={orders}
        selectable={false}
        loading={loading}
        loadingMessage="Loading recent orders..."
        emptyMessage="No orders yet."
      />
    </div>
  );
};

export default RecentOrders;
