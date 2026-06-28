import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, Download, FileUp, MessageSquareText, Plus, Printer, Search, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Button from '../../components/Button';
import FilterDropdown from '../../components/FilterDropdown';
import Pagination from '../../components/Pagination';
import StatusChip, { type StatusChipTone } from '../../components/StatusChip';
import QuickRemarkPopup from '../../components/QuickRemarkPopup';
import {
  bulkUpdateOrderStatus,
  getOrders,
  subscribeToOrderStatusChanged,
  type Order,
  type ParcelStatus,
} from '../../services/orders.service';
import { printLabels } from '../../utils/printLabels';
import './VendorOrders.css';

const STATUS_LABELS: Record<ParcelStatus, string> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Picked Up',
  arrived: 'Arrived',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'Out for Delivery',
  oov: 'Out of Vehicle',
  dispatched: 'Dispatched',
  arrived_at_branch: 'Arrived',
  hold: 'On Hold',
  loss_and_damage: 'Loss & Damage',
  delivered: 'Delivered',
  failed_pickup: 'Failed Pickup',
  failed_delivery: 'Failed Delivery',
  cancelled: 'Cancelled',
};

const ORDER_TYPE_LABELS: Record<Order['orderType'], string> = {
  delivery: 'Delivery',
  exchange: 'Exchange',
  return: 'Return',
};

const PAGE_SIZE = 10;

const getStatusTone = (status: ParcelStatus): StatusChipTone => {
  if (status === 'delivered') return 'success';
  if (['arrived', 'arrived_at_branch', 'rider_assigned'].includes(status)) return 'info';
  if (['failed_pickup', 'failed_delivery', 'loss_and_damage'].includes(status)) return 'danger';
  if (status === 'cancelled') return 'neutral';
  return 'warning';
};

const uniqueValues = (values: string[]) =>
  Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));

const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const formatDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
};

// Native <input type="date"> yields a YYYY-MM-DD string; comparing the order's
// own YYYY-MM-DD slice keeps the range check timezone-safe (no Date parsing).
const toIsoDay = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

interface VendorOrderFilters {
  fromDate: string;
  toDate: string;
  orderType: string;
  hub: string;
  status: string;
}

const EMPTY_FILTERS: VendorOrderFilters = { fromDate: '', toDate: '', orderType: '', hub: '', status: '' };

const VendorOrders: React.FC = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  // Draft holds in-progress selections; applied is what actually filters the list,
  // so the Apply/Clear buttons behave the way the order screen leads users to expect.
  const [draft, setDraft] = useState<VendorOrderFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<VendorOrderFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [remarkPopupOrder, setRemarkPopupOrder] = useState<Order | null>(null);
  const [trackingSearch, setTrackingSearch] = useState('');
  const [printWorking, setPrintWorking] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const res = await getOrders();
      if (res?.success && Array.isArray(res.data)) {
        setOrders(res.data);
      } else if (Array.isArray(res)) {
        setOrders(res as unknown as Order[]);
      } else {
        setOrders([]);
      }
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOrders(); }, []);
  useEffect(() => subscribeToOrderStatusChanged(loadOrders), []);
  useEffect(() => { setPage(1); }, [applied, trackingSearch]);

  const hubOptions = useMemo(
    () => uniqueValues(orders.map(order => order.destination)),
    [orders],
  );

  const filteredOrders = useMemo(() => {
    const q = trackingSearch.toLowerCase();
    const terms = q ? q.split(',').map(t => t.trim()).filter(Boolean) : [];
    return orders.filter(order => {
      const orderDay = toIsoDay(order.createdAt);
      const matchesDate =
        (!applied.fromDate || (orderDay && orderDay >= applied.fromDate)) &&
        (!applied.toDate || (orderDay && orderDay <= applied.toDate));
      const matchesSearch = terms.length === 0 || (
        terms.length > 1
          ? terms.some(t => order.trackingId.toLowerCase() === t)
          : (
              order.trackingId.toLowerCase().includes(terms[0]!) ||
              order.receiverName.toLowerCase().includes(terms[0]!) ||
              order.receiverPhone.toLowerCase().includes(terms[0]!)
            )
      );
      return matchesDate && matchesSearch &&
        (!applied.orderType || order.orderType === applied.orderType) &&
        (!applied.hub || order.destination === applied.hub) &&
        (!applied.status || order.status === applied.status);
    });
  }, [orders, applied, trackingSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const visibleOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const visibleOrderIds = visibleOrders.map(order => order.id);
  const allVisibleSelected = visibleOrderIds.length > 0 && visibleOrderIds.every(id => selectedIds.has(id));
  const someVisibleSelected = visibleOrderIds.some(id => selectedIds.has(id));
  const selectedOrders = orders.filter(order => selectedIds.has(order.id));
  const exportOrders = selectedOrders.length > 0 ? selectedOrders : filteredOrders;
  const firstResult = filteredOrders.length === 0 ? 0 : ((page - 1) * PAGE_SIZE) + 1;
  const lastResult = Math.min(page * PAGE_SIZE, filteredOrders.length);

  const applyFilters = () => setApplied(draft);
  const clearFilters = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  const toggleRowSelection = (orderId: string) => {
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

  const bulkCancel = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const confirmed = window.confirm(
      `Cancel ${ids.length} order${ids.length !== 1 ? 's' : ''}? This cannot be undone.`,
    );
    if (!confirmed) return;
    setBulkWorking(true);
    setBulkError('');
    try {
      await bulkUpdateOrderStatus(ids, 'cancelled', { remarks: 'Bulk cancelled by vendor' });
      setSelectedIds(new Set());
    } catch (err: any) {
      setBulkError(err?.response?.data?.message || err?.message || 'Bulk cancel failed');
    } finally {
      setBulkWorking(false);
    }
  };

  const handlePrintLabels = async () => {
    const labelOrders = selectedIds.size > 0
      ? orders.filter(o => selectedIds.has(o.id))
      : visibleOrders;
    if (labelOrders.length === 0) return;
    setPrintWorking(true);
    try {
      await printLabels(labelOrders);
    } finally {
      setPrintWorking(false);
    }
  };

  const downloadCsv = () => {
    const headers = ['Order ID', 'Status', 'Customer', 'Phone', 'Order Type', 'Destination Branch', 'COD Amount', 'Service Charge', 'Last Comment'];
    const rows = exportOrders.map(order => [
      order.trackingId,
      STATUS_LABELS[order.status],
      order.receiverName,
      order.receiverPhone,
      ORDER_TYPE_LABELS[order.orderType],
      order.destination,
      order.codAmount,
      order.deliveryCharge,
      order.remarks || '',
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'orders.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const columns = [
    {
      header: 'Order ID',
      accessor: (order: Order) => (
        <div className="vo-id-cell">
          <Link to={`/orders/track/${order.trackingId}`} className="vo-id-link">{order.trackingId}</Link>
          <span className="vo-id-ref">ref-</span>
          <span className="vo-id-date">{formatDate(order.createdAt)}</span>
        </div>
      ),
      width: '200px',
    },
    {
      header: 'Status',
      accessor: (order: Order) => (
        <div className="vo-status-cell">
          <StatusChip tone={getStatusTone(order.status)}>{STATUS_LABELS[order.status]}</StatusChip>
          <span className="vo-status-date">{formatDate(order.lastUpdatedAt || order.createdAt)}</span>
        </div>
      ),
      width: '160px',
    },
    {
      header: 'Customers',
      accessor: (order: Order) => (
        <div className="vo-customer-cell">
          <span className="vo-customer-name">{order.receiverName}</span>
          <span className="vo-customer-phone">{order.receiverPhone}</span>
          <span className="vo-customer-address">{order.destination}</span>
        </div>
      ),
      width: '260px',
    },
    {
      header: 'Product Description',
      accessor: (order: Order) => order.remarks?.trim() ? order.remarks : '-',
      width: '180px',
      className: 'vo-muted-cell',
    },
    {
      header: 'Order Type',
      accessor: (order: Order) => (
        <span className={`vo-type-chip vo-type-${order.orderType === 'return' ? 'in' : 'out'}`} title={ORDER_TYPE_LABELS[order.orderType]}>
          {order.orderType === 'return' ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
        </span>
      ),
      width: '120px',
      className: 'vo-center-cell',
    },
    {
      header: 'Destination Branch',
      accessor: (order: Order) => order.destination || '-',
      width: '160px',
    },
    {
      header: 'Amount',
      accessor: (order: Order) => (
        <div className="vo-amount-cell">
          <span>Cod Amount: NPR. {formatMoney(order.codAmount)}</span>
          <span>Service Charge: NPR. {formatMoney(order.deliveryCharge)}</span>
        </div>
      ),
      width: '200px',
    },
    {
      header: 'Last Comment',
      accessor: (order: Order) => (
        <span className="vo-comment-cell" title={order.remarks || ''}>
          {order.remarks?.trim() ? order.remarks : '-'}
        </span>
      ),
      width: '180px',
    },
    {
      header: 'Action',
      accessor: (order: Order) => (
        <Button
          variant="ghost"
          size="icon"
          className="vo-action-btn"
          onClick={() => setRemarkPopupOrder(order)}
          title="View remarks"
          aria-label={`View remarks for ${order.trackingId}`}
        >
          <MessageSquareText size={18} />
        </Button>
      ),
      width: '90px',
      className: 'vo-center-cell',
    },
  ];

  return (
    <div className="vendor-orders-page">
      <PageHeader title="Orders" subtitle="Track and manage your package orders across all hubs." />

      <div className="vo-filter-panel">
        <div className="vo-date-range">
          <span className="vo-field-label">Select Date Range</span>
          <div className="vo-date-range-inputs">
            <input
              type="date"
              aria-label="From date"
              value={draft.fromDate}
              max={draft.toDate || undefined}
              onChange={(event) => setDraft(prev => ({ ...prev, fromDate: event.target.value }))}
            />
            <span className="vo-date-range-sep">–</span>
            <input
              type="date"
              aria-label="To date"
              value={draft.toDate}
              min={draft.fromDate || undefined}
              onChange={(event) => setDraft(prev => ({ ...prev, toDate: event.target.value }))}
            />
          </div>
        </div>
        <FilterDropdown
          label="Order Type"
          value={draft.orderType}
          onChange={(value) => setDraft(prev => ({ ...prev, orderType: value }))}
          placeholder="Select Order Type"
          options={(Object.keys(ORDER_TYPE_LABELS) as Order['orderType'][]).map(value => ({
            value,
            label: ORDER_TYPE_LABELS[value],
          }))}
        />
        <FilterDropdown
          label="Hubs"
          value={draft.hub}
          onChange={(value) => setDraft(prev => ({ ...prev, hub: value }))}
          placeholder="Select Hub"
          options={hubOptions.map(value => ({ value, label: value }))}
        />
        <FilterDropdown
          label="Current Status"
          value={draft.status}
          onChange={(value) => setDraft(prev => ({ ...prev, status: value }))}
          placeholder="Select Status"
          options={(Object.keys(STATUS_LABELS) as ParcelStatus[]).map(value => ({
            value,
            label: STATUS_LABELS[value],
          }))}
        />
        <div className="vo-filter-actions">
          <Button variant="primary" onClick={applyFilters}>Apply</Button>
          <Button variant="outline" onClick={clearFilters}>Clear</Button>
        </div>
      </div>

      <div className="vo-toolbar">
        <Button variant="primary" onClick={() => navigate('/orders/create')}>
          Create New Order <Plus size={16} />
        </Button>
        <Button variant="secondary" onClick={() => navigate('/orders/bulk-create')}>
          Bulk Import <FileUp size={16} />
        </Button>
      </div>

      {selectedIds.size > 0 && (
        <div className="vo-bulk-bar">
          <span className="vo-bulk-count">{selectedIds.size} order{selectedIds.size !== 1 ? 's' : ''} selected</span>
          <div className="vo-bulk-actions">
            {bulkError && <span className="vo-bulk-error">{bulkError}</span>}
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setSelectedIds(new Set()); setBulkError(''); }}
              disabled={bulkWorking}
            >
              Clear Selection
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={bulkCancel}
              disabled={bulkWorking}
            >
              {bulkWorking ? 'Cancelling…' : `Cancel ${selectedIds.size} Order${selectedIds.size !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      )}

      <div className="vo-list-card">
        <div className="vo-list-header">
          <h2>Order List</h2>
          <label className="vo-search-box">
            <Search size={15} />
            <input
              ref={searchInputRef}
              value={trackingSearch}
              onChange={e => setTrackingSearch(e.target.value)}
              placeholder="TRK001 or TRK001, TRK002, TRK003"
              aria-label="Search by tracking ID"
            />
            {trackingSearch && (
              <button type="button" onClick={() => setTrackingSearch('')} aria-label="Clear search">
                <X size={13} />
              </button>
            )}
          </label>
          <div className="vo-list-actions">
            <Button variant="outline" onClick={handlePrintLabels} disabled={printWorking}>
              <Printer size={16} />
              {printWorking
                ? 'Preparing…'
                : selectedIds.size > 0
                  ? `Print ${selectedIds.size} Label${selectedIds.size !== 1 ? 's' : ''}`
                  : `Print ${visibleOrders.length} Label${visibleOrders.length !== 1 ? 's' : ''}`}
            </Button>
            <Button variant="outline" onClick={downloadCsv} disabled={exportOrders.length === 0}>
              <Download size={16} /> Export
            </Button>
          </div>
        </div>

        <Table
          columns={columns}
          data={visibleOrders}
          selectedIds={selectedIds}
          onToggleRow={(id) => toggleRowSelection(String(id))}
          allSelected={allVisibleSelected}
          someSelected={someVisibleSelected}
          onToggleAll={toggleVisibleSelection}
          getRowClassName={(order) => selectedIds.has(order.id) ? 'selected-row' : ''}
          loading={loading}
          loadingMessage="Loading orders..."
          emptyMessage="No orders found."
          minWidth="1640px"
          tableClassName="vo-table"
        />

        <Pagination
          ariaLabel="Orders pagination"
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          summary={`Showing ${firstResult}-${lastResult} of ${filteredOrders.length} results`}
        />
      </div>

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

export default VendorOrders;
