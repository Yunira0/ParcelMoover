import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import MerchantOverviewCards from '../components/merchant/MerchantOverviewCards';
import MerchantFilterBar from '../components/merchant/MerchantFilterBar';
import MerchantLastSettlement from '../components/merchant/MerchantLastSettlement';
import Table from '../components/Table';
import Pagination from '../components/Pagination';
import StatusChip from '../components/StatusChip';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import {
  getMerchantOverview,
  fetchMerchantOrders,
  MERCHANT_METRIC_STATUSES,
  MERCHANT_METRIC_SETTLEMENT,
  type MerchantMetricKey,
  type MerchantOverviewFilters,
  type MerchantOverviewSummary,
} from '../services/merchantOverview.service';
import type { Order } from '../services/orders.service';
import { ORDER_STATUS_LABELS, getOrderStatusTone } from '../utils/orderStatus';
import { toBsDate } from '../utils/nepaliDate';
import { downloadExcel } from '../utils/excel';
import { useCursorPagination } from '../hooks/useCursorPagination';
import './MerchantOverview.css';

const PAGE_SIZE = 10;

const getStatusTone = (status: string) => getOrderStatusTone(status as any);

const MerchantOverview: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const [vendorId, setVendorId] = useState(() => searchParams.get('vendor') || '');
  const [vendorLabel, setVendorLabel] = useState(() => searchParams.get('vendorName') || '');
  // DATE as a single filter that holds From ~ To (mirrors Vendor COD Settlement toolbar,
  // but as a range). Accepts legacy ?date single param for backward compat.
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('dateFrom') || searchParams.get('date') || '');
  const [dateTo, setDateTo] = useState(() => searchParams.get('dateTo') || searchParams.get('date') || '');
  const [activeCard, setActiveCard] = useState<MerchantMetricKey | null>(null);

  const [summary, setSummary] = useState<MerchantOverviewSummary | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<{ total?: number; totalPages?: number; hasNextPage?: boolean; hasPrevPage?: boolean; nextCursor?: string | null; prevCursor?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const pager = useCursorPagination();
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

  const filters: MerchantOverviewFilters = useMemo(
    () => ({
      vendorId: vendorId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [vendorId, dateFrom, dateTo],
  );

  // Keep the URL shareable.
  useEffect(() => {
    const next = new URLSearchParams();
    if (vendorId) next.set('vendor', vendorId);
    if (vendorLabel) next.set('vendorName', vendorLabel);
    if (dateFrom) next.set('dateFrom', dateFrom);
    if (dateTo) next.set('dateTo', dateTo);
    setSearchParams(next, { replace: true });
  }, [vendorId, vendorLabel, dateFrom, dateTo, setSearchParams]);

  // Fetch stats cards from the server-side aggregation endpoint.
  useEffect(() => {
    let active = true;
    getMerchantOverview(filters)
      .then((s) => { if (active) setSummary(s); })
      .catch(() => { /* stats are non-critical */ });
    return () => { active = false; };
  }, [filters]);

  // Fetch paginated orders for the table.
  // Deposited/Pending use authentic settlement filter: deposited = settled via settlement_items, pending = delivered not settled.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const statusFilter = activeCard ? (MERCHANT_METRIC_STATUSES[activeCard] ?? undefined) : undefined;
    const settlementFilter = activeCard ? (MERCHANT_METRIC_SETTLEMENT[activeCard] ?? undefined) : undefined;
    fetchMerchantOrders(filters, {
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
        if (active) setError('Failed to load vendor overview.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [filters, pageSizeChoice, pager.request, activeCard]);

  // Reset pagination when filters or card change.
  useEffect(() => pager.reset(), [filters, activeCard, pager.reset]);

  // Clear selection when page, filters, or card change.
  useEffect(() => { setSelectedIds(new Set()); }, [pager.request, activeCard]);

  const totalCount = meta?.total ?? orders.length;
  const totalPages = meta?.totalPages ?? 1;

  const visibleOrderIds = orders.map(o => o.id);
  const allVisibleSelected = visibleOrderIds.length > 0 && visibleOrderIds.every(id => selectedIds.has(id));
  const someVisibleSelected = visibleOrderIds.some(id => selectedIds.has(id));
  const selectedOrders = orders.filter(o => selectedIds.has(o.id));

  const toggleRowSelection = (orderId: string | number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleOrderIds.forEach(id => next.delete(id));
      else visibleOrderIds.forEach(id => next.add(id));
      return next;
    });
  };

  const hubNameOnly = (locationName: string) => locationName.split(' - ')[0];

  const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

  // Column widths mirror OrderManagement.tsx (client/src/pages/OrderManagement.tsx:823-892)
  // so the two tables share the same visual rhythm and never overlap.
  const columns = useMemo(
    () => [
      {
        header: 'ORDER ID',
        accessor: (o: Order) => <span className="merchant-order-id" title={`#${o.orderNumber}`}>#{o.orderNumber}</span>,
        width: '70px',
        className: 'merchant-order-id-cell',
      },
      {
        header: 'TRACKING ID',
        accessor: (o: Order) => (
          <Link to={`/orders/track/${encodeURIComponent(o.trackingId)}`} className="tracking-id-link" title={o.trackingId}>
            {o.trackingId}
          </Link>
        ),
        width: '180px',
        className: 'tracking-cell',
      },
      {
        header: 'CREATED DATE',
        accessor: (o: Order) => <span className="created-cell" title={toBsDate(o.createdAt) || '-'}>{toBsDate(o.createdAt) || '-'}</span>,
        width: '120px',
        className: 'merchant-created-cell',
      },
      {
        header: 'ORIGIN',
        accessor: (o: Order) => (
          <span className="merchant-origin-text" title={o.origin || '-'}>
            {o.origin ? hubNameOnly(o.origin) : '-'}
          </span>
        ),
        width: '100px',
        className: 'merchant-origin-cell',
      },
      {
        header: 'DESTINATION',
        accessor: (o: Order) => <span className="merchant-destination-text" title={o.destination || '-'}>{o.destination || '-'}</span>,
        width: '130px',
        className: 'destination-cell',
      },
      {
        header: 'SENDER',
        accessor: (o: Order) => (
          <div className="party-cell">
            <span title={o.senderName}>{o.senderName}</span>
            <small title={o.senderPhone}>{o.senderPhone}</small>
          </div>
        ),
        width: '180px',
        className: 'merchant-party-cell',
      },
      {
        header: 'RECEIVER',
        accessor: (o: Order) => (
          <div className="party-cell">
            <span title={o.receiverName}>{o.receiverName}</span>
            <small title={o.receiverPhone}>{o.receiverPhone}</small>
          </div>
        ),
        width: '140px',
        className: 'merchant-party-cell',
      },
      {
        header: 'FINANCE',
        accessor: (o: Order) => (
          <div className="finance-cell">
            <span title={`COD ${o.codAmount}`}>COD: {formatMoney(o.codAmount)}</span>
            <span title={`Delivery ${o.deliveryCharge}`}>D. Charge: {formatMoney(o.deliveryCharge)}</span>
            <span title={`Collected ${o.collectedAmount}`}>Collected: {formatMoney(o.collectedAmount)}</span>
          </div>
        ),
        width: '130px',
        className: 'merchant-finance-cell',
      },
      {
        header: 'WEIGHT',
        accessor: (o: Order) => (
          <span className="merchant-weight-text" title={o.weightKg ? `${o.weightKg} Kg` : '-'}>
            {o.weightKg ? `${o.weightKg} Kg` : '-'}
          </span>
        ),
        width: '120px',
        className: 'merchant-weight-cell',
      },
      {
        header: 'STATUS',
        accessor: (o: Order) => (
          <StatusChip tone={getStatusTone(o.status)}>
            {ORDER_STATUS_LABELS[o.status]}
          </StatusChip>
        ),
        width: '160px',
        className: 'merchant-status-cell',
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
        const statusFilter = activeCard ? (MERCHANT_METRIC_STATUSES[activeCard] ?? undefined) : undefined;
        const settlementFilter = activeCard ? (MERCHANT_METRIC_SETTLEMENT[activeCard] ?? undefined) : undefined;
        const res = await fetchMerchantOrders(filters, { pageSize: 100, withArrival: true, status: statusFilter ?? undefined, settlement: settlementFilter ?? undefined });
        rows = res.data;
      }
    } catch {
      rows = selectedIds.size > 0 ? selectedOrders : orders;
    } finally {
      setExporting(false);
    }

    const headers = [
      'Order ID', 'Tracking ID', 'Origin', 'Sender', 'Receiver', 'Receiver Phone',
      'Receiver Address', 'Destination', 'COD', 'Delivery Charge', 'Weight', 'Status',
    ];
    const sheetRows = rows.map((o) => [
      `#${o.orderNumber}`,
      o.trackingId,
      o.origin,
      o.senderName,
      o.receiverName,
      o.receiverPhone || '',
      o.receiverAddress || '',
      o.destination,
      o.codAmount,
      o.deliveryCharge,
      o.weightKg || '',
      ORDER_STATUS_LABELS[o.status],
    ]);
    const slug = (vendorLabel || 'all-vendors').toLowerCase().replace(/\s+/g, '-').slice(0, 24);
    downloadExcel(`vendor-overview-${slug}.xlsx`, 'Vendor Overview', headers, sheetRows);
  }, [filters, orders, vendorLabel, activeCard, selectedIds, selectedOrders]);

  return (
    <div className="order-management-container merchant-overview-page">
      <PageHeader
        title="Vendor Overview"
        subtitle="Order and cash-flow snapshot for a single vendor, or all of them."
      />

      <MerchantFilterBar
        vendorId={vendorId}
        vendorLabel={vendorLabel}
        onVendorChange={(id, label) => { setVendorId(id); setVendorLabel(label); }}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onClear={() => { setVendorId(''); setVendorLabel(''); setDateFrom(''); setDateTo(''); setActiveCard(null); }}
      />

      <MerchantOverviewCards
        summary={summary}
        loading={loading}
        activeKey={activeCard}
        onSelect={setActiveCard}
      />

      {summary?.codSettlement && (
        <MerchantLastSettlement
          data={summary.codSettlement}
          loading={loading}
        />
      )}

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
        emptyMessage="No orders found for this vendor and range."
        minWidth="1550px"
        tableClassName="orders-table merchant-overview-table"
      />

      <Pagination
        ariaLabel="Vendor orders pagination"
        page={pager.page}
        totalPages={totalPages}
        cursor={pager.controls(meta as unknown as import('../hooks/useCursorPagination').CursorMetaLike)}
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

export default MerchantOverview;
