import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import Button from '../components/Button';
import Table from '../components/Table';
import StatusChip from '../components/StatusChip';
import { getOrders, type Order } from '../services/orders.service';
import { METRIC_STATUS_GROUPS, type MetricKey } from '../components/OverviewMetrics';
import { ORDER_STATUS_LABELS, getOrderStatusTone } from '../utils/orderStatus';
import { downloadExcel } from '../utils/excel';
import { toBsDate } from '../utils/nepaliDate';
import { formatCurrency } from '../utils/format';
import './OverviewOrdersPage.css';

// Local AD date (YYYY-MM-DD) - the browser runs in Nepal time, matching how the
// server anchors "today". Used to narrow the Delivered-today drill-down.
const todayAd = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const isMetricKey = (value: string | undefined): value is MetricKey =>
  !!value && value in METRIC_STATUS_GROUPS;

const OverviewOrdersPage: React.FC = () => {
  const { metric } = useParams<{ metric: string }>();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const validMetric = isMetricKey(metric) ? metric : null;
  const group = validMetric ? METRIC_STATUS_GROUPS[validMetric] : null;

  useEffect(() => {
    if (!group) {
      // Unknown metric in the URL - bounce back to the dashboard.
      navigate('/dashboard', { replace: true });
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    // withArrival so the export carries each order's "arrived at origin" date.
    getOrders({ status: group.statuses, withArrival: true })
      .then((res) => {
        if (!active) return;
        let data = Array.isArray(res.data) ? res.data : [];
        if (group.todayOnly) {
          const today = todayAd();
          data = data.filter((o) => o.deliveredAt === today);
        }
        setOrders(data);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metric]);

  const columns = useMemo(
    () => [
      {
        header: 'ORDER ID',
        accessor: (o: Order) => (
          <Link to={`/orders/track/${encodeURIComponent(o.trackingId)}`} className="overview-orders-link">
            {o.trackingId}
          </Link>
        ),
      },
      { header: 'DATE', accessor: (o: Order) => toBsDate(o.createdAt) || '—' },
      { header: 'ORIGIN', accessor: 'origin' as const },
      { header: 'SENDER', accessor: (o: Order) => o.senderName },
      {
        header: 'RECEIVER',
        accessor: (o: Order) => (
          <div>
            <div>{o.receiverName}</div>
            <div className="overview-orders-subtext">{o.receiverPhone}</div>
          </div>
        ),
      },
      { header: 'DESTINATION', accessor: 'destination' as const },
      { header: 'COD', accessor: (o: Order) => formatCurrency(o.codAmount) },
      { header: 'DELIVERY', accessor: (o: Order) => formatCurrency(o.deliveryCharge) },
      {
        header: 'STATUS',
        accessor: (o: Order) => (
          <StatusChip tone={getOrderStatusTone(o.status)}>{ORDER_STATUS_LABELS[o.status]}</StatusChip>
        ),
      },
    ],
    [],
  );

  const handleExport = () => {
    const headers = [
      '#', 'Tracking ID', 'Status', 'Order Type', 'Service Type', 'Origin', 'Destination',
      'Sender', 'Sender Phone', 'Sender Address',
      'Receiver', 'Receiver Phone', 'Receiver Alt Phone', 'Receiver Address',
      'Pieces', 'Weight (kg)', 'COD', 'Delivery Charge', 'Package Type', 'Delivery Instruction',
      'Vendor', 'Rider', 'Attempts', 'Remarks',
      'Order Created Date', 'Arrived at Origin Date', 'Delivered At', 'Last Updated By', 'Last Updated At',
    ];
    const rows = orders.map((o) => [
      `#${o.orderNumber}`,
      o.trackingId,
      ORDER_STATUS_LABELS[o.status],
      o.orderType,
      o.serviceType,
      o.origin,
      o.destination,
      o.senderName,
      o.senderPhone || '',
      o.senderAddress || '',
      o.receiverName,
      o.receiverPhone || '',
      o.receiverAlternatePhone || '',
      o.receiverAddress || '',
      o.pieces,
      o.weightKg ?? '',
      o.codAmount,
      o.deliveryCharge,
      o.packageType || '',
      o.deliveryInstruction || '',
      o.vendorName || '',
      o.riderName || '',
      o.attemptCount,
      o.remarks || '',
      toBsDate(o.createdAt) || '',
      toBsDate(o.arrivedAtOrigin) || '',
      toBsDate(o.deliveredAt) || '',
      o.lastUpdatedBy || '',
      toBsDate(o.lastUpdatedAt) || '',
    ]);
    const label = group?.label ?? 'orders';
    const slug = label.toLowerCase().replace(/\s+/g, '-');
    downloadExcel(`${slug}.xlsx`, label.slice(0, 31), headers, rows);
  };

  if (!group) return null;

  return (
    <div className="overview-orders-page">
      <div className="overview-orders-header">
        <div className="overview-orders-title">
          <button type="button" className="overview-orders-back" onClick={() => navigate('/dashboard')} aria-label="Back to dashboard">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1>{group.label}</h1>
            <span className="overview-orders-count">{loading ? 'Loading…' : `${orders.length} order${orders.length === 1 ? '' : 's'}`}</span>
          </div>
        </div>
        <Button variant="secondary" onClick={handleExport} disabled={loading || orders.length === 0}>
          <Download size={16} /> Download Excel
        </Button>
      </div>

      {error && <p className="overview-orders-error">{error}</p>}

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

export default OverviewOrdersPage;
