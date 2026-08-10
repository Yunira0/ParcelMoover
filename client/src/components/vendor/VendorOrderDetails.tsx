import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import SegmentedTabs from '../SegmentedTabs';
import Table from '../Table';
import Pagination from '../Pagination';
import StatusChip, { type StatusChipTone } from '../StatusChip';
import type { Order, OrdersPageMeta, ParcelStatus } from '../../services/orders.service';
import { getOrders } from '../../services/orders.service';
import { useCursorPagination } from '../../hooks/useCursorPagination';
import { toBsDateLabel } from '../../utils/nepaliDate';
import './VendorOrderDetails.css';

type DetailsTab = 'all' | 'delivered' | 'return';
// The server caps any value at 100 (order.service MAX_PAGE_SIZE).
const PAGE_SIZE = 10;

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
  if (status === 'partially_delivered') return 'warning';
  if (['arrived', 'arrived_at_branch', 'rider_assigned'].includes(status)) return 'info';
  if (['failed_pickup', 'failed_delivery', 'loss_and_damage'].includes(status)) return 'danger';
  if (status === 'cancelled') return 'neutral';
  return 'warning';
};

const VendorOrderDetails: React.FC = () => {
  const [tab, setTab] = useState<DetailsTab>('all');
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<OrdersPageMeta | null>(null);
  // The orders endpoint is keyset-paginated (no row offsets), so navigation
  // goes through the cursors it hands back rather than a page number.
  const pager = useCursorPagination();
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const changeTab = (next: DetailsTab) => {
    setTab(next);
    pager.reset();
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    getOrders({
      ...(tab === 'delivered' ? { status: ['delivered' as ParcelStatus] } : {}),
      ...(tab === 'return' ? { orderType: 'return' as const } : {}),
      ...pager.request,
      pageSize: pageSizeChoice,
    })
      .then((res) => {
        if (!active) return;
        setOrders(res.data);
        setMeta(res.meta ?? null);
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
  }, [tab, pager.request, pageSizeChoice]);

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
        onChange={changeTab}
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

      <Pagination
        ariaLabel="Order details pagination"
        page={pager.page}
        totalPages={meta?.totalPages ?? 1}
        cursor={pager.controls(meta)}
        pageSize={pageSizeChoice}
        pageSizeLabel="orders"
        onPageSizeChange={(size) => {
          setPageSizeChoice(size);
          pager.reset();
        }}
        summary={meta ? `${meta.total} order${meta.total === 1 ? '' : 's'}` : undefined}
      />
    </div>
  );
};

export default VendorOrderDetails;
