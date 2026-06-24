import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Printer, Search } from 'lucide-react';
import Table from '../components/Table';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import StatusChip from '../components/StatusChip';
import {
  bulkUpdateOrderStatus,
  getOrders,
  subscribeToOrderStatusChanged,
  type Order,
  type OrdersPageMeta,
  type ParcelStatus,
} from '../services/orders.service';
import './HoldOperations.css';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

// Held parcels are reverted back into the active flow. The backend doesn't
// persist the exact pre-hold status, so "previous status" is presented as the
// status the order will return to when released.
const REVERT_STATUS: ParcelStatus = 'ready_to_deliver';
const REVERT_STATUS_LABEL = 'Ready to deliver';

const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const ageInDays = (createdAt?: string) => {
  if (!createdAt) return '-';
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return '-';
  const days = Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000));
  return days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'}`;
};

const HoldOperations: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<OrdersPageMeta | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [actionError, setActionError] = useState('');

  // Debounce search input so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
    setActionError('');
  }, [debouncedSearch]);

  const loadHoldOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOrders({
        status: ['hold'],
        search: debouncedSearch || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      if (res?.success && Array.isArray(res.data)) {
        setOrders(res.data);
        setMeta(res.meta ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page]);

  useEffect(() => { loadHoldOrders(); }, [loadHoldOrders]);
  useEffect(() => subscribeToOrderStatusChanged(loadHoldOrders), [loadHoldOrders]);

  const visibleOrders = orders;
  const totalCount = meta?.total ?? visibleOrders.length;
  const totalPages = meta?.totalPages ?? 1;

  const visibleOrderIds = visibleOrders.map((order) => order.id);
  const allVisibleSelected = visibleOrderIds.length > 0 && visibleOrderIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleOrderIds.some((id) => selectedIds.has(id));

  const toggleRowSelection = (orderId: string | number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleOrderIds.forEach((id) => next.delete(id));
      } else {
        visibleOrderIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const changeToPreviousStatus = async () => {
    setActionError('');
    if (selectedIds.size === 0) {
      setActionError('Select at least one held order first.');
      return;
    }

    setStatusUpdating(true);
    try {
      const ids = Array.from(selectedIds).map(String);
      await bulkUpdateOrderStatus(ids, REVERT_STATUS);
      setSelectedIds(new Set());
      await loadHoldOrders();
    } catch (err: unknown) {
      const message =
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        typeof (err as { response?: { data?: { message?: unknown } } }).response?.data?.message === 'string'
          ? (err as { response: { data: { message: string } } }).response.data.message
          : 'Failed to change status.';
      setActionError(message);
    } finally {
      setStatusUpdating(false);
    }
  };

  const downloadCsv = async () => {
    let rows: Order[] = visibleOrders;
    try {
      const res = await getOrders({ status: ['hold'], search: debouncedSearch || undefined });
      if (res?.success && Array.isArray(res.data)) {
        rows = res.data;
      }
    } catch {
      // fall back to the currently loaded page
    }

    const headers = ['Date', 'Tracking ID', 'Sender', 'Receiver', 'Weight', 'COD', 'Age', 'Last Updated By', 'Last Updated', 'Last Remarks'];
    const csvRows = rows.map((order) => [
      order.createdAt,
      order.trackingId,
      order.senderName,
      order.receiverName,
      order.weightKg ? `${order.weightKg} Kg` : '',
      order.codAmount,
      ageInDays(order.createdAt),
      order.lastUpdatedBy || '',
      order.lastUpdatedAt || '',
      order.remarks || '',
    ]);
    const csv = [headers, ...csvRows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'hold-orders.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const holdColumns = useMemo(() => [
    {
      header: 'SN',
      accessor: (order: Order) => ((page - 1) * PAGE_SIZE) + visibleOrders.findIndex((row) => row.id === order.id) + 1,
      width: '34px',
      className: 'hold-sn-cell',
    },
    { header: 'DATE', accessor: (order: Order) => order.createdAt || '-', width: '100px' },
    { header: 'TRACKING ID', accessor: (order: Order) => order.trackingId, width: '124px', className: 'hold-tracking-cell' },
    {
      header: 'SENDER',
      accessor: (order: Order) => (
        <div className="hold-party-cell">
          <span>{order.senderName}</span>
          <small>{order.senderPhone}</small>
        </div>
      ),
      width: '173px',
    },
    {
      header: 'RECEIVER',
      accessor: (order: Order) => (
        <div className="hold-party-cell">
          <span>{order.receiverName}</span>
          <small>{order.receiverPhone}</small>
        </div>
      ),
      width: '172px',
    },
    { header: 'WEIGHT', accessor: (order: Order) => (order.weightKg ? `${order.weightKg} Kg` : '-'), width: '80px' },
    { header: 'COD', accessor: (order: Order) => formatMoney(order.codAmount), width: '113px' },
    { header: 'AGE', accessor: (order: Order) => ageInDays(order.createdAt), width: '113px' },
    {
      header: 'PREVIOUS STATUS',
      accessor: () => <StatusChip tone="info">{REVERT_STATUS_LABEL}</StatusChip>,
      width: '130px',
    },
    {
      header: 'LAST UPDATED BY',
      accessor: (order: Order) => order.lastUpdatedBy || '-',
      width: '155px',
    },
    { header: 'LAST UPDATED', accessor: (order: Order) => order.lastUpdatedAt || '-', width: '155px' },
    {
      header: 'LAST REMARKS',
      accessor: (order: Order) => order.remarks || '-',
      width: '155px',
      className: 'hold-remarks-cell',
    },
  ], [page, visibleOrders]);

  return (
    <div className="hold-operations-container">
      <PageHeader title="Hold" subtitle="Keep an eye on your dispatch orders across the whole hub network." />

      <div className="hold-toolbar">
        <div />
        <div className="hold-toolbar-actions">
          <Button
            variant="secondary"
            onClick={changeToPreviousStatus}
            disabled={selectedIds.size === 0 || statusUpdating}
          >
            {statusUpdating
              ? 'Updating...'
              : `Change to previous status${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
          </Button>
          <Button variant="secondary" onClick={downloadCsv}>
            <Download size={14} /> Download
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </Button>
        </div>
      </div>

      {actionError && <p className="hold-action-error">{actionError}</p>}

      <label className="hold-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search tracking id"
        />
      </label>

      <Table
        columns={holdColumns}
        data={visibleOrders}
        selectedIds={selectedIds}
        onToggleRow={toggleRowSelection}
        allSelected={allVisibleSelected}
        someSelected={someVisibleSelected}
        onToggleAll={toggleVisibleSelection}
        loading={loading}
        loadingMessage="Loading held orders..."
        emptyMessage="No held orders found."
        minWidth="1400px"
        tableClassName="hold-table"
      />

      <Pagination
        ariaLabel="Hold pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        summary={`${totalCount} order${totalCount === 1 ? '' : 's'}`}
      />
    </div>
  );
};

export default HoldOperations;
