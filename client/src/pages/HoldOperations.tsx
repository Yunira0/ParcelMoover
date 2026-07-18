import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { AlertTriangle, Download, Printer, Search } from 'lucide-react';
import Table from '../components/Table';
import Button from '../components/Button';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import StatusChip from '../components/StatusChip';
import QuickRemarkPopup from '../components/QuickRemarkPopup';
import {
  bulkUpdateOrderStatus,
  getOrders,
  subscribeToOrderStatusChanged,
  type Order,
  type OrdersPageMeta,
  type ParcelStatus,
} from '../services/orders.service';
import { useCursorPagination } from '../hooks/useCursorPagination';
import { toBsDate } from '../utils/nepaliDate';
import { printLabels } from '../utils/printLabels';
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<OrdersPageMeta | null>(null);
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('search') || '');
  const pager = useCursorPagination();
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [actionError, setActionError] = useState('');
  const [remarkPopupOrder, setRemarkPopupOrder] = useState<Order | null>(null);

  // Debounce search input so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    pager.reset();
    setActionError('');
  }, [debouncedSearch, pager.reset]);

  // Keep search bookmarkable - mirror into the URL (replacing history, not
  // pushing, so the back button doesn't step through every keystroke).
  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedSearch) next.set('search', debouncedSearch);
    setSearchParams(next, { replace: true });
  }, [debouncedSearch, setSearchParams]);

  const loadHoldOrders = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await getOrders({
        status: ['hold'],
        search: debouncedSearch || undefined,
        pageSize: PAGE_SIZE,
        cursor: pager.request.cursor,
        dir: pager.request.dir,
      }, signal);
      if (res?.success && Array.isArray(res.data)) {
        setOrders(res.data);
        setMeta(res.meta ?? null);
      }
    } catch (err) {
      if (axios.isCancel(err)) return;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [debouncedSearch, pager.request]);

  // Cancel an in-flight fetch when a newer one supersedes it (fast page/search
  // changes) or the page unmounts, so a stale response can't overwrite fresher data.
  useEffect(() => {
    const controller = new AbortController();
    loadHoldOrders(controller.signal);
    return () => controller.abort();
  }, [loadHoldOrders]);
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

  // Held parcels leave this page one of two ways: released back into the
  // active flow (ready_to_deliver) or written off to Loss & Damage - the only
  // status the backend accepts loss_and_damage from is hold.
  const applyStatusToSelection = async (status: ParcelStatus, emptyMessage: string) => {
    setActionError('');
    if (selectedIds.size === 0) {
      setActionError(emptyMessage);
      return;
    }

    setStatusUpdating(true);
    try {
      const ids = Array.from(selectedIds).map(String);
      await bulkUpdateOrderStatus(ids, status);
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

  const changeToPreviousStatus = () =>
    applyStatusToSelection(REVERT_STATUS, 'Select at least one held order first.');

  const markLossAndDamage = () =>
    applyStatusToSelection('loss_and_damage', 'Select at least one held order to mark as loss & damage.');

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

    const headers = ['#', 'Date', 'Tracking ID', 'Sender', 'Receiver', 'Weight', 'COD', 'Age', 'Last Updated By', 'Last Updated', 'Last Remarks'];
    const csvRows = rows.map((order) => [
      `#${order.orderNumber}`,
      toBsDate(order.createdAt),
      order.trackingId,
      order.senderName,
      order.receiverName,
      order.weightKg ? `${order.weightKg} Kg` : '',
      order.codAmount,
      ageInDays(order.createdAt),
      order.lastUpdatedBy || '',
      toBsDate(order.lastUpdatedAt) || '',
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

  const selectedOrders = orders.filter((order) => selectedIds.has(order.id));

  const handlePrintLabels = () => {
    const labelOrders = selectedOrders.length > 0 ? selectedOrders : visibleOrders;
    void printLabels(labelOrders);
  };

  const holdColumns = useMemo(() => [
    {
      header: 'ORDER ID',
      accessor: (order: Order) => `#${order.orderNumber}`,
      width: '70px',
      className: 'hold-sn-cell',
    },
    { header: 'DATE', accessor: (order: Order) => toBsDate(order.createdAt) || '-', width: '100px' },
    {
      header: 'TRACKING ID',
      accessor: (order: Order) => (
        <Link to={`/orders/track/${order.trackingId}`} className="tracking-id-link">{order.trackingId}</Link>
      ),
      width: '124px',
      className: 'hold-tracking-cell',
    },
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
    { header: 'LAST UPDATED', accessor: (order: Order) => toBsDate(order.lastUpdatedAt) || '-', width: '155px' },
    {
      header: 'LAST REMARKS',
      accessor: (order: Order) => (
        <button
          type="button"
          className="hold-remarks-cell-btn"
          onClick={() => setRemarkPopupOrder(order)}
          title={order.remarks || 'Add remark'}
        >
          {order.remarks || '-'}
        </button>
      ),
      width: '155px',
      className: 'hold-remarks-cell',
    },
  ], [pager.request, visibleOrders]);

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
          <Button
            variant="danger"
            onClick={markLossAndDamage}
            disabled={selectedIds.size === 0 || statusUpdating}
          >
            <AlertTriangle size={14} />
            {`Mark Loss & Damage${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
          </Button>
          <Button variant="secondary" onClick={downloadCsv}>
            <Download size={14} /> Download
          </Button>
          <Button variant="secondary" onClick={handlePrintLabels} disabled={visibleOrders.length === 0}>
            <Printer size={14} /> {selectedOrders.length > 0 ? `Print ${selectedOrders.length} Selected` : `Print All (${visibleOrders.length})`}
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
        page={pager.page}
        totalPages={totalPages}
        cursor={pager.controls(meta)}
        summary={`${totalCount} order${totalCount === 1 ? '' : 's'}`}
      />

      {remarkPopupOrder && (
        <QuickRemarkPopup
          orderId={remarkPopupOrder.id}
          trackingId={remarkPopupOrder.trackingId}
          onClose={() => setRemarkPopupOrder(null)}
        />
      )}
    </div>
  );
};

export default HoldOperations;
