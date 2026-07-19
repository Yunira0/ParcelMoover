import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import SegmentedTabs from '../components/SegmentedTabs';
import Table from '../components/Table';
import StatusChip from '../components/StatusChip';
import Button from '../components/Button';
import { getOrders, type Order, type ParcelStatus } from '../services/orders.service';
import { ORDER_STATUS_LABELS, getOrderStatusTone } from '../utils/orderStatus';
import { toBsDate } from '../utils/nepaliDate';
import { downloadExcel } from '../utils/excel';
import './ReportsPage.css';

type ReportKey = 'pickup' | 'dispatch' | 'transit' | 'return';
type Bucket = 'pending' | 'completed';

// Which parcel statuses each report/bucket covers. Kept as one editable config
// so the operational grouping is explicit and easy to adjust.
//   pending   = orders still being worked in that stage
//   completed = orders that have cleared the stage
const REPORTS: Record<ReportKey, { label: string; pending: ParcelStatus[]; completed: ParcelStatus[] }> = {
  pickup: {
    label: 'Pickup',
    // up to and including picked up
    pending: ['pickup_ordered', 'rider_assigned', 'picked_up'],
    // arrived at origin
    completed: ['arrived'],
  },
  dispatch: {
    label: 'Dispatch',
    pending: ['ready_to_deliver', 'sent_for_delivery', 'failed_delivery'],
    completed: ['delivered', 'partially_delivered'],
  },
  transit: {
    label: 'Transit',
    // transit (oov), in transit (dispatched), arrived at branch, and the
    // in-transit order sent out for delivery
    pending: ['oov', 'dispatched', 'arrived_at_branch', 'sent_for_delivery'],
    completed: ['delivered', 'partially_delivered'],
  },
  return: {
    label: 'Return',
    pending: ['follow_up', 'ready_to_return', 'sent_to_vendor', 'failed_delivery'],
    completed: ['returned_to_vendor'],
  },
};

const REPORT_OPTIONS = (Object.keys(REPORTS) as ReportKey[]).map((value) => ({
  value,
  label: `${REPORTS[value].label} report`,
}));

const BUCKET_OPTIONS: { value: Bucket; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
];

const formatMoney = (value: number) =>
  `Rs. ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const ReportsPage: React.FC = () => {
  const [report, setReport] = useState<ReportKey>('pickup');
  const [bucket, setBucket] = useState<Bucket>('pending');
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const statuses = REPORTS[report][bucket];

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    getOrders({ status: statuses }, controller.signal)
      .then((res) => {
        if (res?.success && Array.isArray(res.data)) {
          setOrders(res.data);
        } else {
          setError('This report is unavailable right now.');
          setOrders([]);
        }
      })
      .catch((err) => {
        if (err?.name !== 'CanceledError' && err?.name !== 'AbortError') {
          setError('This report is unavailable right now.');
          setOrders([]);
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
    // statuses is derived from report+bucket; those two drive the refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, bucket]);

  const columns = useMemo(
    () => [
      {
        header: 'ORDER',
        accessor: (o: Order) => (
          <Link to={`/orders/track/${o.trackingId}`} className="reports-id">{o.trackingId}</Link>
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
      { header: 'COD', accessor: (o: Order) => formatMoney(o.codAmount), className: 'reports-cod' },
      { header: 'CREATED', accessor: (o: Order) => toBsDate(o.createdAt) || '—' },
    ],
    [],
  );

  const handleDownload = () => {
    const headers = ['#', 'Tracking ID', 'Vendor', 'Sender', 'Origin', 'Destination', 'Receiver', 'Receiver Phone', 'COD', 'Status', 'Rider', 'Created'];
    const rows = orders.map((o) => [
      `#${o.orderNumber}`,
      o.trackingId,
      o.vendorName || '',
      o.senderName,
      o.origin,
      o.destination,
      o.receiverName,
      o.receiverPhone || '',
      o.codAmount,
      ORDER_STATUS_LABELS[o.status],
      o.riderName || '',
      toBsDate(o.createdAt) || '',
    ]);
    downloadExcel(
      `${report}-${bucket}-report.xlsx`,
      `${REPORTS[report].label} ${bucket}`,
      headers,
      rows,
    );
  };

  return (
    <div className="reports-page">
      <PageHeader
        title="Reports"
        subtitle="Pickup, dispatch, transit, and return orders — pending and delivered."
      />

      <SegmentedTabs
        options={REPORT_OPTIONS}
        value={report}
        onChange={setReport}
        ariaLabel="Choose a report"
      />

      <div className="reports-toolbar">
        <SegmentedTabs
          options={BUCKET_OPTIONS}
          value={bucket}
          onChange={setBucket}
          ariaLabel="Completed or pending"
          fullWidth={false}
        />
        <Button variant="primary" onClick={handleDownload} disabled={loading || orders.length === 0}>
          <Download size={16} /> Download
        </Button>
      </div>

      {error && <p className="reports-error">{error}</p>}

      <p className="reports-count">
        {loading ? 'Loading…' : `${orders.length.toLocaleString()} ${bucket} ${REPORTS[report].label.toLowerCase()} order${orders.length === 1 ? '' : 's'}`}
      </p>

      <Table
        columns={columns}
        data={orders}
        selectable={false}
        loading={loading}
        loadingMessage="Loading report…"
        emptyMessage={`No ${bucket} orders in the ${REPORTS[report].label.toLowerCase()} report.`}
      />
    </div>
  );
};

export default ReportsPage;
