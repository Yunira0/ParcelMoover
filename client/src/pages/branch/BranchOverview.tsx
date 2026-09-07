import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Pagination from '../../components/Pagination';
import StatusChip from '../../components/StatusChip';
import Button from '../../components/Button';
import BranchOverviewFilterBar from '../../components/branch/BranchOverviewFilterBar';
import BranchOverviewCards from '../../components/branch/BranchOverviewCards';
import AddBranchModal from '../../components/branch/AddBranchModal';
import { useBranchScope } from '../../context/BranchScopeContext';
import { useBranchAccess } from '../../hooks/useBranchAccess';
import {
  exportBranchOrders,
  getBranchOrders,
  getBranchOverview,
  type BranchFilters,
  type BranchMetricKey,
  type BranchMetrics,
} from '../../services/branchTracking.service';
import type { Order, OrdersPageMeta } from '../../services/orders.service';
import { ORDER_STATUS_LABELS, getOrderStatusTone } from '../../utils/orderStatus';
import { toBsDate } from '../../utils/nepaliDate';
import { formatMoneyCompact } from '../../utils/format';
import { downloadExcel } from '../../utils/excel';
import { useCursorPagination } from '../../hooks/useCursorPagination';
import '../OrderManagement.css';
import '../MerchantOverview.css';
import './BranchOverview.css';

const hubName = (loc: string) => loc.split(' - ')[0];

const PAGE_SIZE = 20;

const BranchOverview: React.FC = () => {
  const { fromBranchId, toBranchId, setFromBranchId, setToBranchId, refreshBranches } = useBranchScope();
  const { isSuperAdmin } = useBranchAccess();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activeCard, setActiveCard] = useState<BranchMetricKey | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [metrics, setMetrics] = useState<BranchMetrics | null>(null);
  const [meta, setMeta] = useState<OrdersPageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [addBranchOpen, setAddBranchOpen] = useState(false);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const pager = useCursorPagination();

  const filters: BranchFilters = useMemo(() => ({
    ...(fromBranchId !== 'all' ? { fromBranchId } : {}),
    ...(toBranchId !== 'all' ? { toBranchId } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  }), [fromBranchId, toBranchId, dateFrom, dateTo]);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    try {
      const res = await getBranchOrders({ ...filters, ...(activeCard ? { metric: activeCard } : {}),
        page: pager.request.page, pageSize, cursor: pager.request.cursor, dir: pager.request.dir }, signal);
      setOrders(Array.isArray(res.data) ? res.data : []);
      setMeta(res.meta ?? null);
      setSelectedIds(new Set());
      setError('');
    } catch {
      setError('Failed to load branch overview.');
    } finally {
      setLoading(false);
    }
  }, [activeCard, filters, pageSize, pager.request]);

  useEffect(() => {
    const c = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- request lifecycle owns loading
    load(c.signal);
    return () => c.abort();
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    getBranchOverview(filters, controller.signal).then(setMetrics).catch(() => setMetrics(null));
    return () => controller.abort();
  }, [filters]);

  useEffect(() => {
    pager.reset();
    // pager is a memoized facade whose identity also tracks request state; reset is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, activeCard, pager.reset]);

  const rows = orders;

  const rowIds = rows.map((o) => o.id);
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));
  const someSelected = rowIds.some((id) => selectedIds.has(id));

  const toggleRow = (id: string | number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      rowIds.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });

  const handleDownload = async () => {
    setExporting(true);
    setError('');
    try {
      const picked = selectedIds.size
        ? rows.filter((o) => selectedIds.has(o.id))
        : (await exportBranchOrders({ ...filters, ...(activeCard ? { metric: activeCard } : {}) })).data;
    const headers = [
      'Order ID', 'Tracking ID', 'Created', 'Origin', 'Destination', 'Sender',
      'Receiver', 'Receiver Phone', 'COD', 'Collected', 'Weight', 'Status',
    ];
    const body = picked.map((o) => [
      `#${o.orderNumber}`,
      o.trackingId,
      toBsDate(o.createdAt) || '',
      o.origin ? hubName(o.origin) : '',
      o.destination || '',
      o.senderName,
      o.receiverName,
      o.receiverPhone || '',
      o.codAmount,
      o.collectedAmount,
      o.weightKg || '',
      ORDER_STATUS_LABELS[o.status],
    ]);
      downloadExcel('branch-overview.xlsx', 'Branch Overview', headers, body);
    } catch {
      setError('Failed to export branch orders.');
    } finally {
      setExporting(false);
    }
  };

  const columns = [
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
    { header: 'ORIGIN', accessor: (o: Order) => (o.origin ? hubName(o.origin) : '-'), width: '110px' },
    { header: 'DESTINATION', accessor: (o: Order) => o.destination || '-', width: '130px' },
    {
      header: 'SENDER',
      accessor: (o: Order) => (
        <div className="party-cell"><span>{o.senderName}</span><small>{o.senderPhone}</small></div>
      ),
      width: '170px',
    },
    {
      header: 'RECEIVER',
      accessor: (o: Order) => (
        <div className="party-cell"><span>{o.receiverName}</span><small>{o.receiverPhone}</small></div>
      ),
      width: '150px',
    },
    {
      header: 'FINANCE',
      accessor: (o: Order) => (
        <div className="finance-cell">
          <span>COD: {formatMoneyCompact(o.codAmount)}</span>
          <span>Collected: {formatMoneyCompact(o.collectedAmount)}</span>
        </div>
      ),
      width: '140px',
    },
    { header: 'WEIGHT', accessor: (o: Order) => (o.weightKg ? `${o.weightKg} Kg` : '-'), width: '90px' },
    {
      header: 'STATUS',
      accessor: (o: Order) => (
        <StatusChip tone={getOrderStatusTone(o.status)}>{ORDER_STATUS_LABELS[o.status]}</StatusChip>
      ),
      width: '150px',
    },
  ];

  return (
    <div className="order-management-container merchant-overview-page branch-overview-page">
      <PageHeader
        title="Branch Overview"
        subtitle="Order and cash-flow snapshot for a branch pair, or all branches."
        actionLabel={isSuperAdmin ? 'New Branch' : undefined}
        actionIcon={<Plus size={16} />}
        onAction={() => setAddBranchOpen(true)}
      />

      <BranchOverviewFilterBar
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onClear={() => {
          setFromBranchId('all');
          setToBranchId('all');
          setDateFrom('');
          setDateTo('');
          setActiveCard(null);
        }}
      />

      <BranchOverviewCards metrics={metrics ?? undefined} activeKey={activeCard} onSelect={setActiveCard} loading={loading && !metrics} />

      {error && <p className="order-load-error">{error}</p>}

      <div className="order-toolbar">
        <div className="order-toolbar-left">
          <span className="vendor-overview-count">
            {loading ? 'Loading…' : `${meta?.total ?? rows.length} order${(meta?.total ?? rows.length) === 1 ? '' : 's'}`}
            {selectedIds.size > 0 && <> · {selectedIds.size} selected</>}
          </span>
        </div>
        <div className="order-toolbar-right">
          <Button variant="primary" onClick={handleDownload} disabled={loading || exporting || rows.length === 0}>
            <Download size={14} /> {exporting ? 'Exporting…' : selectedIds.size > 0 ? `Download (${selectedIds.size})` : 'Download all'}
          </Button>
        </div>
      </div>

      <Table
        columns={columns}
        data={rows}
        selectedIds={selectedIds}
        onToggleRow={toggleRow}
        allSelected={allSelected}
        someSelected={someSelected}
        onToggleAll={toggleAll}
        loading={loading && orders.length === 0}
        loadingMessage="Loading orders..."
        emptyMessage="No orders for this branch pair and range."
        minWidth="1450px"
        tableClassName="orders-table merchant-overview-table"
      />

      <Pagination
        ariaLabel="Branch orders pagination"
        page={pager.page}
        totalPages={meta?.totalPages ?? 1}
        cursor={pager.controls(meta)}
        pageSize={pageSize}
        pageSizeOptions={[10, 20, 50, 100]}
        pageSizeLabel="orders"
        onPageSizeChange={(size) => { setPageSize(size); pager.reset(); }}
        summary={meta ? `${meta.total} orders` : undefined}
      />

      <AddBranchModal
        isOpen={addBranchOpen}
        onClose={() => setAddBranchOpen(false)}
        onSuccess={refreshBranches}
      />
    </div>
  );
};

export default BranchOverview;
