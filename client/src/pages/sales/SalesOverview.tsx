import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Pagination from '../../components/Pagination';
import StatusChip from '../../components/StatusChip';
import Button from '../../components/Button';
import SalesOverviewFilterBar from '../../components/sales/SalesOverviewFilterBar';
import MerchantOverviewCards from '../../components/merchant/MerchantOverviewCards';
import {
  getSalesOverview,
  fetchSalesOrders,
  SALES_METRIC_STATUSES,
  SALES_METRIC_SETTLEMENT,
  type SalesMetricKey,
  type SalesOverviewFilters,
  type SalesOverviewSummary,
} from '../../services/salesOverview.service';
import type { Order } from '../../services/orders.service';
import { ORDER_STATUS_LABELS, getOrderStatusTone } from '../../utils/orderStatus';
import { toBsDate } from '../../utils/nepaliDate';
import { downloadExcel } from '../../utils/excel';
import { useCursorPagination } from '../../hooks/useCursorPagination';
import '../OrderManagement.css';
import '../MerchantOverview.css';
import './SalesOverview.css';

const PAGE_SIZE = 10;

const getStatusTone = (status: string) => getOrderStatusTone(status as any);
const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const SalesOverview: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [salesUserId, setSalesUserId] = useState(() => searchParams.get('sales') || '');
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('dateFrom') || '');
  const [dateTo, setDateTo] = useState(() => searchParams.get('dateTo') || '');
  const [activeCard, setActiveCard] = useState<SalesMetricKey | null>(null);

  const [summary, setSummary] = useState<SalesOverviewSummary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<{ total?: number; totalPages?: number; hasNextPage?: boolean; hasPrevPage?: boolean; nextCursor?: string | null; prevCursor?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const pager = useCursorPagination();
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

  const filters: SalesOverviewFilters = useMemo(
    () => ({
      salesUserId: salesUserId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [salesUserId, dateFrom, dateTo],
  );

  // Keep the URL shareable.
  useEffect(() => {
    const next = new URLSearchParams();
    if (salesUserId) next.set('sales', salesUserId);
    if (dateFrom) next.set('dateFrom', dateFrom);
    if (dateTo) next.set('dateTo', dateTo);
    setSearchParams(next, { replace: true });
  }, [salesUserId, dateFrom, dateTo, setSearchParams]);

  useEffect(() => {
    let active = true;
    getSalesOverview(filters)
      .then((s) => { if (active) setSummary(s); })
      .catch(() => { /* stats are non-critical */ });
    return () => { active = false; };
  }, [filters]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const statusFilter = activeCard ? (SALES_METRIC_STATUSES[activeCard] ?? undefined) : undefined;
    const settlementFilter = activeCard ? (SALES_METRIC_SETTLEMENT[activeCard] ?? undefined) : undefined;
    fetchSalesOrders(filters, {
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
        if (active) setError('Failed to load sales overview.');
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
      { header: 'VENDOR', accessor: (o: Order) => o.vendorName || '-', width: '150px' },
      {
        header: 'RECEIVER',
        accessor: (o: Order) => (
          <div className="party-cell"><span>{o.receiverName}</span><small>{o.receiverPhone}</small></div>
        ),
        width: '160px',
      },
      { header: 'DESTINATION', accessor: (o: Order) => o.destination || '-', width: '130px' },
      {
        header: 'FINANCE',
        accessor: (o: Order) => (
          <div className="finance-cell">
            <span>COD: {formatMoney(o.codAmount)}</span>
            <span>D. Charge: {formatMoney(o.deliveryCharge)}</span>
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
        const statusFilter = activeCard ? (SALES_METRIC_STATUSES[activeCard] ?? undefined) : undefined;
        const settlementFilter = activeCard ? (SALES_METRIC_SETTLEMENT[activeCard] ?? undefined) : undefined;
        const res = await fetchSalesOrders(filters, { pageSize: 100, withArrival: true, status: statusFilter ?? undefined, settlement: settlementFilter ?? undefined });
        rows = res.data;
      }
    } catch {
      rows = selectedIds.size > 0 ? selectedOrders : orders;
    } finally {
      setExporting(false);
    }

    const headers = [
      'Order ID', 'Tracking ID', 'Created', 'Vendor', 'Receiver', 'Receiver Phone',
      'Destination', 'COD', 'Delivery Charge', 'Collected', 'Weight', 'Status',
    ];
    const sheetRows = rows.map((o) => [
      `#${o.orderNumber}`,
      o.trackingId,
      toBsDate(o.createdAt) || '',
      o.vendorName || '',
      o.receiverName,
      o.receiverPhone || '',
      o.destination || '',
      o.codAmount,
      o.deliveryCharge,
      o.collectedAmount,
      o.weightKg || '',
      ORDER_STATUS_LABELS[o.status],
    ]);
    downloadExcel('sales-overview.xlsx', 'Sales Overview', headers, sheetRows);
  }, [filters, orders, activeCard, selectedIds, selectedOrders]);

  return (
    <div className="order-management-container merchant-overview-page sales-overview-page">
      <PageHeader
        title="Sales Overview"
        subtitle="Order and cash-flow snapshot for a sales rep's vendors, or all of them."
      />

      <SalesOverviewFilterBar
        salesUserId={salesUserId}
        onSalesUserChange={setSalesUserId}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onClear={() => { setSalesUserId(''); setDateFrom(''); setDateTo(''); setActiveCard(null); }}
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
        emptyMessage="No orders found for this sales rep and range."
        minWidth="1500px"
        tableClassName="orders-table merchant-overview-table"
      />

      <Pagination
        ariaLabel="Sales orders pagination"
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

export default SalesOverview;
