import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { downloadExcel } from '../utils/excel';
import { toBsDate, toBsDateTime } from '../utils/nepaliDate';
import { printLabels } from '../utils/printLabels';
import { useCursorPagination } from '../hooks/useCursorPagination';
import './LossAndDamageOperations.css';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

// Loss-and-damage parcels are reverted back into the active flow. The backend
// doesn't persist the exact pre-flag status, so "previous status" is presented
// as the status the order will return to when released.
const REVERT_STATUS: ParcelStatus = 'ready_to_deliver';
const REVERT_STATUS_LABEL = 'Ready to deliver';

const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const LossAndDamageOperations: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<OrdersPageMeta | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const pager = useCursorPagination();
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
    pager.reset();
    setActionError('');
  }, [debouncedSearch, pager.reset]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOrders({
        status: ['loss_and_damage'],
        search: debouncedSearch || undefined,
        pageSize: PAGE_SIZE,
        cursor: pager.request.cursor,
        dir: pager.request.dir,
      });
      if (res?.success && Array.isArray(res.data)) {
        setOrders(res.data);
        setMeta(res.meta ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, pager.request]);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => subscribeToOrderStatusChanged(loadOrders), [loadOrders]);

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
      setActionError('Select at least one order first.');
      return;
    }

    setStatusUpdating(true);
    try {
      const ids = Array.from(selectedIds).map(String);
      await bulkUpdateOrderStatus(ids, REVERT_STATUS);
      setSelectedIds(new Set());
      await loadOrders();
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
      const res = await getOrders({ status: ['loss_and_damage'], search: debouncedSearch || undefined });
      if (res?.success && Array.isArray(res.data)) {
        rows = res.data;
      }
    } catch {
      // fall back to the currently loaded page
    }

    const headers = ['#', 'Date', 'Tracking ID', 'Sender', 'Receiver', 'Weight', 'COD', 'Package', 'Last Updated By', 'Last Updated'];
    const csvRows = rows.map((order) => [
      `#${order.orderNumber}`,
      toBsDate(order.createdAt),
      order.trackingId,
      order.senderName,
      order.receiverName,
      order.weightKg ? `${order.weightKg} Kg` : '',
      order.codAmount,
      `${order.pieces} pcs`,
      order.lastUpdatedBy || '',
      toBsDate(order.lastUpdatedAt) || '',
    ]);
    downloadExcel('loss-and-damage-orders.xlsx', 'Loss and Damage', headers, csvRows);
  };

  const selectedOrders = orders.filter((order) => selectedIds.has(order.id));

  const handlePrintLabels = () => {
    const labelOrders = selectedOrders.length > 0 ? selectedOrders : visibleOrders;
    void printLabels(labelOrders);
  };

  const columns = useMemo(() => [
    {
      header: 'ORDER ID',
      accessor: (order: Order) => `#${order.orderNumber}`,
      width: '70px',
      className: 'lossdamage-sn-cell',
    },
    { header: 'DATE', accessor: (order: Order) => toBsDate(order.createdAt) || '-', width: '100px' },
    {
      header: 'TRACKING ID',
      accessor: (order: Order) => (
        <Link to={`/orders/track/${order.trackingId}`} className="tracking-id-link">{order.trackingId}</Link>
      ),
      width: '124px',
      className: 'lossdamage-tracking-cell',
    },
    {
      header: 'SENDER',
      accessor: (order: Order) => (
        <div className="lossdamage-party-cell">
          <span>{order.senderName}</span>
          <small>{order.senderPhone}</small>
        </div>
      ),
      width: '173px',
    },
    {
      header: 'RECEIVER',
      accessor: (order: Order) => (
        <div className="lossdamage-party-cell">
          <span>{order.receiverName}</span>
          <small>{order.receiverPhone}</small>
        </div>
      ),
      width: '172px',
    },
    { header: 'WEIGHT', accessor: (order: Order) => (order.weightKg ? `${order.weightKg} Kg` : '-'), width: '80px' },
    { header: 'COD', accessor: (order: Order) => formatMoney(order.codAmount), width: '113px' },
    { header: 'PACKAGE', accessor: (order: Order) => `${order.pieces} pcs`, width: '113px' },
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
    { header: 'LAST UPDATED', accessor: (order: Order) => toBsDateTime(order.lastUpdatedAt) || '-', width: '170px' },
  ], [pager.request, visibleOrders]);

  return (
    <div className="lossdamage-operations-container">
      <PageHeader
        title="Loss and damage"
        subtitle="Stay vigilant regarding your dispatch orders throughout the entire hub network to prevent loss and damage."
      />

      <div className="lossdamage-toolbar">
        <div />
        <div className="lossdamage-toolbar-actions">
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
          <Button variant="secondary" onClick={handlePrintLabels} disabled={visibleOrders.length === 0}>
            <Printer size={14} /> {selectedOrders.length > 0 ? `Print ${selectedOrders.length} Selected` : `Print All (${visibleOrders.length})`}
          </Button>
        </div>
      </div>

      {actionError && <p className="lossdamage-action-error">{actionError}</p>}

      <label className="lossdamage-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search tracking id"
        />
      </label>

      <Table
        columns={columns}
        data={visibleOrders}
        selectedIds={selectedIds}
        onToggleRow={toggleRowSelection}
        allSelected={allVisibleSelected}
        someSelected={someVisibleSelected}
        onToggleAll={toggleVisibleSelection}
        loading={loading}
        loadingMessage="Loading loss & damage orders..."
        emptyMessage="No loss or damage orders found."
        minWidth="1400px"
        tableClassName="lossdamage-table"
      />

      <Pagination
        ariaLabel="Loss and damage pagination"
        page={pager.page}
        totalPages={totalPages}
        cursor={pager.controls(meta)}
        summary={`${totalCount} order${totalCount === 1 ? '' : 's'}`}
      />
    </div>
  );
};

export default LossAndDamageOperations;
