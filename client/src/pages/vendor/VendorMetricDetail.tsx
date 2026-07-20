import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import Table from '../../components/Table';
import Button from '../../components/Button';
import Pagination from '../../components/Pagination';
import StatusChip, { type StatusChipTone } from '../../components/StatusChip';
import { getOrders, type Order, type OrderType, type ParcelStatus } from '../../services/orders.service';
import { toBsDate } from '../../utils/nepaliDate';
import { formatCurrency } from '../../utils/format';
import './VendorMetricDetail.css';

const STATUS_LABELS: Record<ParcelStatus, string> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Picked Up',
  arrived: 'Arrived at Origin',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'Sent for Delivery',
  oov: 'Transit',
  dispatched: 'In Transit',
  arrived_at_branch: 'Arrived at Destination',
  hold: 'On Hold',
  loss_and_damage: 'Loss & Damage',
  delivered: 'Delivered',
  partially_delivered: 'Partially Delivered',
  failed_pickup: 'Failed Pickup',
  failed_delivery: 'Failed Delivery',
  cancelled: 'Cancelled',
  follow_up: 'Follow Up',
  ready_to_return: 'Ready to Return',
  sent_to_vendor: 'Sent to Vendor',
  returned_to_vendor: 'Returned to Vendor',
};

const getStatusTone = (status: ParcelStatus): StatusChipTone => {
  if (status === 'delivered') return 'success';
  if (status === 'partially_delivered') return 'warning';
  if (['arrived', 'arrived_at_branch', 'rider_assigned'].includes(status)) return 'info';
  if (['failed_pickup', 'failed_delivery', 'loss_and_damage'].includes(status)) return 'danger';
  if (status === 'cancelled') return 'neutral';
  return 'warning';
};

// Mirrors the server's dashboard-summary counters (order.service.ts) so each
// metric page lists exactly the orders its dashboard number counted.
const IN_DELIVERY_STATUSES: ParcelStatus[] = [
  'picked_up', 'arrived', 'dispatched', 'arrived_at_branch',
  'ready_to_deliver', 'sent_for_delivery', 'oov',
];
// Return-workflow stages still in progress, i.e. not yet back with the
// vendor (compare 'rtv-delivered', which is the terminal returned_to_vendor
// status). Mirrors RETURN_IN_PROGRESS_STATUSES in order.service.ts.
const RETURN_IN_PROGRESS_STATUSES: ParcelStatus[] = ['follow_up', 'ready_to_return', 'sent_to_vendor'];

interface MetricConfig {
  label: string;
  description: string;
  status?: ParcelStatus[];
  orderType?: OrderType;
  /** Restrict to today (NPT): by creation date, delivery date, or latest status change. */
  today?: 'created' | 'delivered' | 'statusChanged';
}

export const METRICS: Record<string, MetricConfig> = {
  'total-orders': {
    label: 'Total Orders',
    description: 'Every order you have placed, across all statuses.',
  },
  delivered: {
    label: 'Delivered',
    description: 'Orders delivered to the customer (including partial deliveries).',
    status: ['delivered', 'partially_delivered'],
  },
  'rtv-delivered': {
    label: 'RTV Delivered',
    description: 'Orders returned to vendor.',
    status: ['returned_to_vendor'],
  },
  'in-delivery': {
    label: 'In Delivery',
    description: 'Orders picked up and moving through the network towards the customer.',
    status: IN_DELIVERY_STATUSES,
  },
  'pending-pickup': {
    label: 'Pending Pickup',
    description: 'Orders waiting to be picked up from you.',
    status: ['pickup_ordered', 'rider_assigned'],
  },
  'return-process': {
    label: 'Return Process',
    description: 'Orders in the return workflow: follow up, ready to return, or sent to vendor.',
    status: RETURN_IN_PROGRESS_STATUSES,
  },
  'today-orders': {
    label: "Today's Orders",
    description: 'Orders created today.',
    today: 'created',
  },
  'today-delivered': {
    label: "Today's Delivered",
    description: 'Orders delivered today.',
    status: ['delivered', 'partially_delivered'],
    today: 'delivered',
  },
  'today-returns': {
    label: "Today's RTV Delivered",
    description: 'Orders returned to vendor today.',
    status: ['returned_to_vendor'],
    today: 'statusChanged',
  },
};

const PAGE_SIZE = 10;
const SERVER_FETCH_PAGE_SIZE = 100;
const MAX_FETCH_PAGES = 10; // safety cap: 1000 orders per metric page

/** Today's date in Nepal time as "YYYY-MM-DD" (matches the server's date fields). */
const nepalToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(new Date());

const matchesToday = (order: Order, mode: 'created' | 'delivered' | 'statusChanged') => {
  const today = nepalToday();
  if (mode === 'delivered') return order.deliveredAt === today;
  if (mode === 'statusChanged') {
    return order.lastUpdatedAt
      ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' }).format(new Date(order.lastUpdatedAt)) === today
      : false;
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kathmandu' })
    .format(new Date(order.createdAtRaw)) === today;
};

/** Orders-page URL carrying the same filters, for the "Open in Orders" jump. */
const ordersHref = (config: MetricConfig) => {
  const params = new URLSearchParams();
  if (config.orderType) params.set('orderType', config.orderType);
  if (config.status?.length) params.set('status', config.status.join(','));
  const query = params.toString();
  return query ? `/orders?${query}` : '/orders';
};

const VendorMetricDetail: React.FC = () => {
  const navigate = useNavigate();
  const { metricId } = useParams<{ metricId: string }>();
  const config = metricId ? METRICS[metricId] : undefined;

  const [orders, setOrders] = useState<Order[]>([]);
  const [capped, setCapped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState(1);
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    if (!config) return;
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    setPage(1);
    (async () => {
      try {
        const all: Order[] = [];
        let cursor: string | undefined;
        let hasMore = false;
        for (let i = 0; i < MAX_FETCH_PAGES; i++) {
          const res = await getOrders({
            status: config.status,
            orderType: config.orderType,
            pageSize: SERVER_FETCH_PAGE_SIZE,
            cursor,
            dir: 'next',
          });
          if (seq !== fetchSeqRef.current) return;
          if (!res?.success || !Array.isArray(res.data)) throw new Error('Unexpected orders response');
          all.push(...res.data);
          hasMore = !!res.meta?.hasNextPage && !!res.meta?.nextCursor;
          if (!hasMore) break;
          cursor = res.meta!.nextCursor!;
          // Newest-first ordering: once a whole server page is older than today,
          // a today-scoped metric has everything it needs.
          if (config.today === 'created' && res.data.length > 0 &&
              !matchesToday(res.data[res.data.length - 1]!, 'created')) {
            break;
          }
        }
        const filtered = config.today ? all.filter((o) => matchesToday(o, config.today!)) : all;
        setOrders(filtered);
        setCapped(hasMore && !config.today);
        setLoadError('');
      } catch {
        if (seq === fetchSeqRef.current) setLoadError('Failed to load orders for this metric.');
      } finally {
        if (seq === fetchSeqRef.current) setLoading(false);
      }
    })();
  }, [metricId]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalCod = useMemo(() => orders.reduce((sum, o) => sum + o.codAmount, 0), [orders]);

  const totalPages = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedOrders = orders.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const columns = useMemo(() => [
    {
      header: 'SN',
      accessor: (order: Order) => (currentPage - 1) * PAGE_SIZE + pagedOrders.indexOf(order) + 1,
      width: '50px',
    },
    { header: 'ORDER ID', accessor: (order: Order) => `#${order.orderNumber}`, width: '80px' },
    {
      header: 'TRACKING ID',
      accessor: (order: Order) => (
        <Link to={`/orders/track/${order.trackingId}`} className="vmd-tracking-link">{order.trackingId}</Link>
      ),
      width: '190px',
    },
    {
      header: 'RECEIVER',
      accessor: (order: Order) => (
        <div className="vmd-receiver-cell">
          <span>{order.receiverName}</span>
          <small>{order.receiverPhone}</small>
        </div>
      ),
      width: '180px',
    },
    { header: 'DESTINATION', accessor: (order: Order) => order.destination || '-', width: '170px' },
    {
      header: 'STATUS',
      accessor: (order: Order) => (
        <StatusChip tone={getStatusTone(order.status)}>{STATUS_LABELS[order.status]}</StatusChip>
      ),
      width: '150px',
    },
    { header: 'COD AMOUNT', accessor: (order: Order) => formatCurrency(order.codAmount, 0), width: '110px' },
    { header: 'CREATED', accessor: (order: Order) => toBsDate(order.createdAtRaw), width: '110px' },
  ], [currentPage, pagedOrders]);

  if (!config) return <Navigate to="/dashboard" replace />;

  return (
    <div className="vendor-metric-detail">
      <div className="vmd-header">
        <div>
          <Link to="/dashboard" className="vmd-back-link">
            <ArrowLeft size={14} /> Dashboard
          </Link>
          <h1 className="vmd-title">{config.label}</h1>
          <p className="vmd-description">{config.description}</p>
        </div>
        <Button variant="outline" onClick={() => navigate(ordersHref(config))}>
          Open in Orders <ExternalLink size={14} />
        </Button>
      </div>

      <div className="vmd-stats">
        <div className="vmd-stat">
          <span className="vmd-stat-value">{loading ? '—' : `${orders.length.toLocaleString()}${capped ? '+' : ''}`}</span>
          <span className="vmd-stat-label">Orders</span>
        </div>
        <div className="vmd-stat">
          <span className="vmd-stat-value">{loading ? '—' : formatCurrency(totalCod, 0)}</span>
          <span className="vmd-stat-label">Total COD</span>
        </div>
      </div>

      {loadError && <p className="vmd-error">{loadError}</p>}

      <Table
        columns={columns}
        data={pagedOrders}
        loading={loading}
        loadingMessage="Loading orders..."
        emptyMessage="No orders in this metric right now."
        minWidth="1050px"
        tableClassName="vmd-table"
      />

      {orders.length > PAGE_SIZE && (
        <Pagination
          ariaLabel={`${config.label} pages`}
          page={currentPage}
          totalPages={totalPages}
          onPageChange={setPage}
          summary={`Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, orders.length)} of ${orders.length}${capped ? '+' : ''} orders`}
        />
      )}
    </div>
  );
};

export default VendorMetricDetail;
