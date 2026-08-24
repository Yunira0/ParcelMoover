import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import Button from '../components/Button';
import Table from '../components/Table';
import Pagination from '../components/Pagination';
import StatusChip from '../components/StatusChip';
import {
  getOrders,
  type ListOrdersParams,
  type Order,
  type OrdersPageMeta,
} from '../services/orders.service';
import { METRIC_STATUS_GROUPS, type MetricKey } from '../components/OverviewMetrics';
import { ORDER_STATUS_LABELS, getOrderStatusTone, STATUS_TIMELINE_HEADERS, statusTimelineCells } from '../utils/orderStatus';
import { downloadExcel } from '../utils/excel';
import { useCursorPagination } from '../hooks/useCursorPagination';
import { toBsDate, toBsDateTimeCell } from '../utils/nepaliDate';
import { formatCurrency } from '../utils/format';
import './OverviewOrdersPage.css';

const PAGE_SIZE = 10;
// The server caps a page at 100 rows, so the export walks the list in
// 100-row hops rather than relying on the unpaginated endpoint's 200-row cap -
// that cap is exactly why a 240-order card used to open onto 200 rows.
const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORT_PAGES = 100; // safety cap: 10,000 rows per download

const isMetricKey = (value: string | undefined): value is MetricKey =>
  !!value && value in METRIC_STATUS_GROUPS;

const OverviewOrdersPage: React.FC = () => {
  const { metric } = useParams<{ metric: string }>();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<OrdersPageMeta | null>(null);
  const pager = useCursorPagination();
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  const validMetric = isMetricKey(metric) ? metric : null;
  const group = validMetric ? METRIC_STATUS_GROUPS[validMetric] : null;

  // The query behind both the table and the export. deliveredToday is applied
  // server-side (not by filtering a page client-side) so meta.total matches the
  // dashboard card that linked here.
  const baseQuery: ListOrdersParams | null = useMemo(
    () =>
      group
        ? {
            status: group.statuses,
            ...(group.todayOnly ? { deliveredToday: true } : {}),
          }
        : null,
    [group],
  );

  useEffect(() => {
    if (!group) {
      // Unknown metric in the URL - bounce back to the dashboard.
      navigate('/dashboard', { replace: true });
    }
  }, [group, navigate]);

  // A different card means a different list - start back at page one.
  useEffect(() => { pager.reset(); }, [metric, pager.reset]);

  useEffect(() => {
    if (!baseQuery) return;
    let active = true;
    setLoading(true);
    setError('');
    getOrders({
      ...baseQuery,
      pageSize: pageSizeChoice,
      cursor: pager.request.cursor,
      dir: pager.request.dir,
    })
      .then((res) => {
        if (!active) return;
        setOrders(Array.isArray(res.data) ? res.data : []);
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
  }, [baseQuery, pageSizeChoice, pager.request]);

  const totalCount = meta?.total ?? orders.length;
  const totalPages = meta?.totalPages ?? 1;

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

  // Walks every page of the same query the table shows. The download is the
  // whole card, not just the page on screen - withArrival adds each order's
  // "arrived at origin" date, which only the export column needs.
  const fetchAllForExport = useCallback(async (): Promise<Order[]> => {
    if (!baseQuery) return [];
    const all: Order[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < MAX_EXPORT_PAGES; i++) {
      const res = await getOrders({
        ...baseQuery,
        withArrival: true,
        pageSize: EXPORT_PAGE_SIZE,
        cursor,
        dir: 'next',
      });
      if (!res?.success || !Array.isArray(res.data)) break;
      all.push(...res.data);
      if (!res.meta?.hasNextPage || !res.meta.nextCursor) break;
      cursor = res.meta.nextCursor;
    }
    return all;
  }, [baseQuery]);

  const handleExport = async () => {
    setExporting(true);
    let rows: Order[];
    try {
      rows = await fetchAllForExport();
    } catch {
      rows = orders; // fall back to the page on screen
    } finally {
      setExporting(false);
    }

    const headers = [
      '#', 'Tracking ID', 'Status', 'Order Type', 'Service Type', 'Origin', 'Destination',
      'Sender', 'Sender Phone', 'Sender Address',
      'Receiver', 'Receiver Phone', 'Receiver Alt Phone', 'Receiver Address',
      'Pieces', 'Weight (kg)', 'COD', 'Delivery Charge', 'Package Type', 'Delivery Instruction',
      'Vendor', 'Rider', 'Attempts', 'Remarks',
      'Order Created Date', 'Last Updated By', 'Last Updated At', ...STATUS_TIMELINE_HEADERS,
    ];
    const sheetRows = rows.map((o) => [
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
      toBsDateTimeCell(o.createdAtRaw || o.createdAt) || '',
      o.lastUpdatedBy || '',
      toBsDateTimeCell(o.lastUpdatedAt) || '',
      ...statusTimelineCells(o.statusTimestamps),
    ]);
    const label = group?.label ?? 'orders';
    const slug = label.toLowerCase().replace(/\s+/g, '-');
    downloadExcel(`${slug}.xlsx`, label.slice(0, 31), headers, sheetRows);
  };

  if (!group) return null;

  return (
    <div className="overview-orders-page">
      <div className="overview-orders-header">
        <div className="overview-orders-title">
          <button type="button" className="overview-orders-back" onClick={() => navigate('/dashboard')} aria-label="Back to dashboard" style={{ background: '#fff', color: '#000', border: '1px solid #d1d5db', padding: 0 }}>
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1>{group.label}</h1>
            <span className="overview-orders-count">{loading ? 'Loading…' : `${totalCount} order${totalCount === 1 ? '' : 's'}`}</span>
          </div>
        </div>
        <Button variant="secondary" onClick={handleExport} disabled={loading || exporting || totalCount === 0}>
          <Download size={16} /> {exporting ? 'Preparing…' : 'Download Excel'}
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

      <Pagination
        ariaLabel={`${group.label} pagination`}
        page={pager.page}
        totalPages={totalPages}
        cursor={pager.controls(meta)}
        pageSize={pageSizeChoice}
        // Named after the card you opened ("Pending pickups per page"), not a
        // generic "orders per page".
        pageSizeLabel={group.label}
        onPageSizeChange={(size) => {
          setPageSizeChoice(size);
          pager.reset();
        }}
        summary={`${totalCount} order${totalCount === 1 ? '' : 's'}`}
      />
    </div>
  );
};

export default OverviewOrdersPage;
