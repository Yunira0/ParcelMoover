import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Pagination from '../../components/Pagination';
import StatusChip from '../../components/StatusChip';
import Button from '../../components/Button';
import RiderOverviewFilterBar from '../../components/rider/RiderOverviewFilterBar';
import MerchantOverviewCards from '../../components/merchant/MerchantOverviewCards';
import {
  getRiderOverview,
  fetchRiderOrders,
  RIDER_METRIC_STATUSES,
  RIDER_METRIC_SETTLEMENT,
  type RiderMetricKey,
  type RiderOverviewFilters,
  type RiderOverviewSummary,
} from '../../services/riderOverview.service';
import type { Order } from '../../services/orders.service';
import { ORDER_STATUS_LABELS, getOrderStatusTone } from '../../utils/orderStatus';
import { toBsDate } from '../../utils/nepaliDate';
import { downloadExcel } from '../../utils/excel';
import { useCursorPagination } from '../../hooks/useCursorPagination';
import '../OrderManagement.css';
import '../MerchantOverview.css';
import './RiderOverview.css';

const PAGE_SIZE = 10;

const hubName = (loc: string) => loc.split(' - ')[0];
const getStatusTone = (status: string) => getOrderStatusTone(status as any);
const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const RiderOverview: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [riderId, setRiderId] = useState(() => searchParams.get('rider') || '');
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('dateFrom') || '');
  const [dateTo, setDateTo] = useState(() => searchParams.get('dateTo') || '');
  const [activeCard, setActiveCard] = useState<RiderMetricKey | null>(null);

  const [summary, setSummary] = useState<RiderOverviewSummary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<{ total?: number; totalPages?: number; hasNextPage?: boolean; hasPrevPage?: boolean; nextCursor?: string | null; prevCursor?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const pager = useCursorPagination();
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

  const filters: RiderOverviewFilters = useMemo(
    () => ({
      riderId: riderId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [riderId, dateFrom, dateTo],
  );

  // Keep the URL shareable.
  useEffect(() => {
    const next = new URLSearchParams();
    if (riderId) next.set('rider', riderId);
    if (dateFrom) next.set('dateFrom', dateFrom);
    if (dateTo) next.set('dateTo', dateTo);
    setSearchParams(next, { replace: true });
  }, [riderId, dateFrom, dateTo, setSearchParams]);

  useEffect(() => {
    let active = true;
    getRiderOverview(filters)
      .then((s) => { if (active) setSummary(s); })
      .catch(() => { /* stats are non-critical */ });
    return () => { active = false; };
  }, [filters]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const statusFilter = activeCard ? (RIDER_METRIC_STATUSES[activeCard] ?? undefined) : undefined;
    const settlementFilter = activeCard ? (RIDER_METRIC_SETTLEMENT[activeCard] ?? undefined) : undefined;
    fetchRiderOrders(filters, {
      pageSize: pageSizeChoice,
      cursor: pager.request.cursor,
      dir: pager.request.dir,
      status: statusFilter ?? undefined,
      settlement: settlementFilter ?? undefined,
    })
      .then((res) => {
        if (!active) return;
        setOrders(Array.isArray(res.data) ? res.data : []);
        setMeta(res.meta ?? null);
      })
      .catch(() => {
        if (active) setError('Failed to load rider overview.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [filters, pageSizeChoice, pager.request, activeCard]);

  useEffect(() => pager.reset(), [filters, activeCard, pager.reset]);
  useEffect(() => { setSelectedIds(new Set()); }, [pager.request, activeCard]);

  const totalCount = meta?.total ?? orders.length;
  const totalPages = meta?.totalPages ?? 1;

  const visibleOrderIds = orders.map((o) => o.id);
  const allVisibleSelected = visibleOrderIds.length > 0 && visibleOrderIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleOrderIds.some((id) => selectedIds.has(id));
  const selectedOrders = orders.filter((o) => selectedIds.has(o.id));

  const toggleRowSelection = (orderId: string | number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleOrderIds.forEach((id) => next.delete(id));
      else visibleOrderIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const columns = useMemo(
    () => [
      { header: 'ORDER ID', accessor: (o: Order) => `#${o.orderNumber}`, width: '70px' },
      {
        header: 'TRACKING ID',
        accessor: (o: Order) => (
          <Link to={`/orders/track/${encodeURIComponent(o.trackingId)}`} className="tracking-id-link" title={o.trackingId}>
            {o.trackingId}
          </Link>
        ),
        width: '170px',
        className: 'tracking-cell',
      },
      { header: 'CREATED', accessor: (o: Order) => toBsDate(o.createdAt) || '-', width: '110px' },
      { header: 'RIDER', accessor: (o: Order) => o.riderName || '-', width: '130px' },
      { header: 'ORIGIN', accessor: (o: Order) => (o.origin ? hubName(o.origin) : '-'), width: '110px' },
      { header: 'DESTINATION', accessor: (o: Order) => o.destination || '-', width: '130px' },
      {
        header: 'RECEIVER',
        accessor: (o: Order) => (
          <div className="party-cell"><span>{o.receiverName}</span><small>{o.receiverPhone}</small></div>
        ),
        width: '160px',
      },
      {
        header: 'FINANCE',
        accessor: (o: Order) => (
          <div className="finance-cell">
            <span>COD: {formatMoney(o.codAmount)}</span>
            <span>Collected: {formatMoney(o.collectedAmount)}</span>
          </div>
        ),
        width: '140px',
      },
      { header: 'WEIGHT', accessor: (o: Order) => (o.weightKg ? `${o.weightKg} Kg` : '-'), width: '90px' },
      {
        header: 'STATUS',
        accessor: (o: Order) => (
          <StatusChip tone={getStatusTone(o.status)}>{ORDER_STATUS_LABELS[o.status]}</StatusChip>
        ),
        width: '150px',
      },
    ],
    [],
  );

  const handleExport = useCallback(async () => {
    setExporting(true);
    let rows: Order[];
    try {
      if (selectedIds.size > 0) {
        rows = selectedOrders;
      } else {
        const statusFilter = activeCard ? (RIDER_METRIC_STATUSES[activeCard] ?? undefined) : undefined;
        const settlementFilter = activeCard ? (RIDER_METRIC_SETTLEMENT[activeCard] ?? undefined) : undefined;
        const res = await fetchRiderOrders(filters, { pageSize: 100, withArrival: true, status: statusFilter ?? undefined, settlement: settlementFilter ?? undefined });
        rows = res.data;
      }
    } catch {
      rows = selectedIds.size > 0 ? selectedOrders : orders;
    } finally {
      setExporting(false);
    }

    const headers = [
      'Order ID', 'Tracking ID', 'Created', 'Rider', 'Origin', 'Destination',
      'Receiver', 'Receiver Phone', 'COD', 'Collected', 'Weight', 'Status',
    ];
    const sheetRows = rows.map((o) => [
      `#${o.orderNumber}`,
      o.trackingId,
      toBsDate(o.createdAt) || '',
      o.riderName || '',
      o.origin ? hubName(o.origin) : '',
      o.destination || '',
      o.receiverName,
      o.receiverPhone || '',
      o.codAmount,
      o.collectedAmount,
      o.weightKg || '',
      ORDER_STATUS_LABELS[o.status],
    ]);
    downloadExcel('rider-overview.xlsx', 'Rider Overview', headers, sheetRows);
  }, [filters, orders, activeCard, selectedIds, selectedOrders]);

  return (
    <div className="order-management-container merchant-overview-page rider-overview-page">
      <PageHeader
        title="Rider Overview"
        subtitle="Order and cash-flow snapshot for a single rider, or all of them."
      />

      <RiderOverviewFilterBar
        riderId={riderId}
        onRiderChange={setRiderId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onClear={() => { setRiderId(''); setDateFrom(''); setDateTo(''); setActiveCard(null); }}
      />

      <MerchantOverviewCards
        summary={summary}
        loading={loading}
        activeKey={activeCard}
        onSelect={setActiveCard}
      />

      {error && <p className="order-load-error">{error}</p>}

      <div className="order-toolbar">
        <div className="order-toolbar-left">
          <span className="vendor-overview-count">
            {loading ? 'Loading…' : `${totalCount} order${totalCount === 1 ? '' : 's'}`}
            {selectedIds.size > 0 && <> · {selectedIds.size} selected</>}
          </span>
        </div>
        <div className="order-toolbar-right">
          <Button variant="primary" onClick={handleExport} disabled={loading || exporting || totalCount === 0}>
            <Download size={14} /> {exporting ? 'Preparing…' : selectedIds.size > 0 ? `Download (${selectedIds.size})` : 'Download'}
          </Button>
        </div>
      </div>

      <Table
        columns={columns}
        data={orders}
        selectedIds={selectedIds}
        onToggleRow={toggleRowSelection}
        allSelected={allVisibleSelected}
        someSelected={someVisibleSelected}
        onToggleAll={toggleVisibleSelection}
        loading={loading && orders.length === 0}
        loadingMessage="Loading orders..."
        emptyMessage="No orders found for this rider and range."
        minWidth="1450px"
        tableClassName="orders-table merchant-overview-table"
      />

      <Pagination
        ariaLabel="Rider orders pagination"
        page={pager.page}
        totalPages={totalPages}
        cursor={pager.controls(meta as unknown as import('../../hooks/useCursorPagination').CursorMetaLike)}
        pageSize={pageSizeChoice}
        pageSizeLabel="orders"
        onPageSizeChange={(size) => {
          setPageSizeChoice(size);
          pager.reset();
        }}
        summary={meta ? `${totalCount} order${totalCount === 1 ? '' : 's'}` : undefined}
      />
    </div>
  );
};

export default RiderOverview;
