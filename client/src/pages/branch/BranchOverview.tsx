import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import StatusChip from '../../components/StatusChip';
import Button from '../../components/Button';
import BranchOverviewFilterBar from '../../components/branch/BranchOverviewFilterBar';
import BranchOverviewCards from '../../components/branch/BranchOverviewCards';
import AddBranchModal from '../../components/branch/AddBranchModal';
import { useBranchScope } from '../../context/BranchScopeContext';
import { useBranchAccess } from '../../hooks/useBranchAccess';
import { BRANCH_METRIC_STATUSES, type BranchMetricKey } from '../../services/branchTracking.service';
import { getOrders, type Order } from '../../services/orders.service';
import { ORDER_STATUS_LABELS, getOrderStatusTone } from '../../utils/orderStatus';
import { toBsDate } from '../../utils/nepaliDate';
import { formatMoneyCompact } from '../../utils/format';
import { downloadExcel } from '../../utils/excel';
import '../OrderManagement.css';
import '../MerchantOverview.css';
import './BranchOverview.css';

const hubName = (loc: string) => loc.split(' - ')[0];

// Vendor Overview, scoped to a branch pair instead of a vendor. Card counts are
// unwired (no hub-scoped summary yet); the table is live off the orders list,
// filtered client-side by origin/destination hub.
const BranchOverview: React.FC = () => {
  const { fromBranchId, toBranchId, setFromBranchId, setToBranchId, branches, refreshBranches } = useBranchScope();
  const { isSuperAdmin } = useBranchAccess();
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [activeCard, setActiveCard] = useState<BranchMetricKey | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [addBranchOpen, setAddBranchOpen] = useState(false);

  const nameOf = (id: string) => (id === 'all' ? null : branches.find((b) => b.id === id)?.name ?? null);
  const fromName = nameOf(fromBranchId);
  const toName = nameOf(toBranchId);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    try {
      const status = activeCard ? BRANCH_METRIC_STATUSES[activeCard] : undefined;
      const res = await getOrders(
        {
          pageSize: 100,
          ...(status ? { status } : {}),
          ...(dateFrom || dateTo ? { dateField: 'createdAt' as const } : {}),
          ...(dateFrom ? { dateFrom } : {}),
          ...(dateTo ? { dateTo } : {}),
        },
        signal,
      );
      setOrders(res?.success && Array.isArray(res.data) ? res.data : []);
      setError('');
    } catch {
      setError('Failed to load branch overview.');
    } finally {
      setLoading(false);
    }
  }, [activeCard, dateFrom, dateTo]);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  const rows = useMemo(
    () =>
      orders.filter(
        (o) =>
          (!fromName || (o.origin && hubName(o.origin) === fromName)) &&
          (!toName || (o.destination && hubName(o.destination) === toName)),
      ),
    [orders, fromName, toName],
  );

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

  const handleDownload = () => {
    const picked = selectedIds.size ? rows.filter((o) => selectedIds.has(o.id)) : rows;
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
  };

  const columns = [
    { header: 'ORDER ID', accessor: (o: Order) => `#${o.orderNumber}`, width: '70px' },
    {
      header: 'TRACKING ID',
      accessor: (o: Order) => (
        <Link to={`/orders/track/${encodeURIComponent(o.trackingId)}`} className="tracking-id-link">
          {o.trackingId}
        </Link>
      ),
      width: '170px',
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

      <BranchOverviewCards activeKey={activeCard} onSelect={setActiveCard} loading={loading} />

      {error && <p className="order-load-error">{error}</p>}

      <div className="order-toolbar">
        <div className="order-toolbar-left">
          <span className="vendor-overview-count">
            {loading ? 'Loading…' : `${rows.length} order${rows.length === 1 ? '' : 's'}`}
            {selectedIds.size > 0 && <> · {selectedIds.size} selected</>}
          </span>
        </div>
        <div className="order-toolbar-right">
          <Button variant="primary" onClick={handleDownload} disabled={loading || rows.length === 0}>
            <Download size={14} /> {selectedIds.size > 0 ? `Download (${selectedIds.size})` : 'Download'}
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
        emptyMessage="No orders for this branch pair and range on the latest page."
        minWidth="1450px"
        tableClassName="orders-table merchant-overview-table"
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
