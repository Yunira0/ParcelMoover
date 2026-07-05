import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import SegmentedTabs from '../SegmentedTabs';
import Table from '../Table';
import StatusChip, { type StatusChipTone } from '../StatusChip';
import type { Order, ParcelStatus } from '../../services/orders.service';
import { getOrders } from '../../services/orders.service';
import { toBsDateLabel } from '../../utils/nepaliDate';
import './VendorOrderDetails.css';

type DetailsTab = 'all' | 'delivered' | 'return';
const RECENT_ORDERS_LIMIT = 8;

const formatMoney = (value: number) => `Rs. ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return toBsDateLabel(date);
};

const formatStatusLabel = (status: ParcelStatus) =>
  status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const getStatusTone = (status: ParcelStatus): StatusChipTone => {
  if (status === 'delivered') return 'success';
  if (['arrived', 'arrived_at_branch', 'rider_assigned'].includes(status)) return 'info';
  if (['failed_pickup', 'failed_delivery', 'loss_and_damage'].includes(status)) return 'danger';
  if (status === 'cancelled') return 'neutral';
  return 'warning';
};

const VendorOrderDetails: React.FC = () => {
  const [tab, setTab] = useState<DetailsTab>('all');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    getOrders(
      tab === 'delivered'
        ? { status: ['delivered'] }
        : tab === 'return'
          ? { orderType: 'return' }
          : undefined,
    )
      .then((res) => {
        if (active) setOrders(res.data.slice(0, RECENT_ORDERS_LIMIT));
      })
      .catch(() => {
        if (active) setError('Failed to load orders.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tab]);

  const columns = [
    {
      header: 'ORDER ID',
      accessor: (order: Order) => (
        <Link to={`/orders/track/${encodeURIComponent(order.trackingId)}`} className="vendor-order-details-link">
          {order.trackingId}
        </Link>
      ),
    },
    { header: 'DATE', accessor: (order: Order) => formatDate(order.createdAt) },
    { header: 'DESTINATION', accessor: 'destination' as const },
    {
      header: 'RECEIVER',
      accessor: (order: Order) => (
        <div>
          <div>{order.receiverName}</div>
          <div className="vendor-order-details-subtext">{order.receiverPhone}</div>
        </div>
      ),
    },
    { header: 'COD', accessor: (order: Order) => formatMoney(order.codAmount) },
    {
      header: 'STATUS',
      accessor: (order: Order) => (
        <StatusChip tone={getStatusTone(order.status)}>{formatStatusLabel(order.status)}</StatusChip>
      ),
    },
    {
      header: 'ACTIONS',
      accessor: (order: Order) => (
        <Link
          to={`/orders/track/${encodeURIComponent(order.trackingId)}`}
          className="vendor-order-details-action"
          title="View order details"
          aria-label="View order details"
        >
          <MoreVertical size={16} />
        </Link>
      ),
      className: 'vendor-order-details-actions-cell',
    },
  ];

  return (
    <div className="vendor-order-details">
      <h3 className="section-title">Order Details</h3>
      <SegmentedTabs
        ariaLabel="Order details filter"
        fullWidth={false}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'all', label: 'All' },
          { value: 'delivered', label: 'Delivered' },
          { value: 'return', label: 'Returned' },
        ]}
      />

      {error && <p className="vendor-order-details-error">{error}</p>}

      <Table
        columns={columns}
        data={orders}
        selectable={false}
        loading={loading}
        loadingMessage="Loading orders..."
        emptyMessage="No orders found."
      />
    </div>
  );
};

export default VendorOrderDetails;
