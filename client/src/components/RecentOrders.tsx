import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Table from './Table';
import StatusChip from './StatusChip';
import { getOrders, type Order } from '../services/orders.service';
import { ORDER_STATUS_LABELS, getOrderStatusTone } from '../utils/orderStatus';
import './RecentOrders.css';

const RECENT_LIMIT = 6;

const formatMoney = (value: number) =>
  `Rs. ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const RecentOrders: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    getOrders(
      { sortBy: 'createdAt', sortDir: 'desc', pageSize: RECENT_LIMIT },
      controller.signal,
    )
      .then((res) => {
        if (res?.success && Array.isArray(res.data)) {
          setOrders(res.data.slice(0, RECENT_LIMIT));
          setError('');
        } else {
          setError('Recent orders are unavailable.');
        }
      })
      .catch((err) => {
        if (err?.name !== 'CanceledError' && err?.name !== 'AbortError') {
          setError('Recent orders are unavailable.');
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

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
