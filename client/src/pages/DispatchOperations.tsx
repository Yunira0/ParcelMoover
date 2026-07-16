import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Download,
  Printer,
  Search,
  Send,
} from 'lucide-react';
import Table from '../components/Table';
import SearchableSelect from '../components/SearchableSelect';
import Button from '../components/Button';
import SegmentedTabs from '../components/SegmentedTabs';
import PageHeader from '../components/PageHeader';
import TicketCategoryButton from '../components/TicketCategoryButton';
import Pagination from '../components/Pagination';
import QuickRemarkPopup from '../components/QuickRemarkPopup';
import {
  bulkUpdateOrderStatus,
  getOrders,
  subscribeToOrderStatusChanged,
  type Order,
  type OrdersPageMeta,
  type ParcelStatus,
} from '../services/orders.service';
import { getRiders } from '../services/users.service';
import { printLabels } from '../utils/printLabels';
import { useCursorPagination } from '../hooks/useCursorPagination';
import { toBsDate } from '../utils/nepaliDate';
import './DispatchOperations.css';

const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

type DispatchTab =
  | 'arrived_at_branch'
  | 'ready_to_deliver'
  | 'sent_for_delivery'
  | 'delivered'
  | 'partially_delivered'
  | 'failed';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

const TAB_LABELS: Record<DispatchTab, string> = {
  arrived_at_branch: 'Arrived at Destination',
  ready_to_deliver: 'Ready for delivery',
  sent_for_delivery: 'Sent for delivery',
  delivered: 'Delivered',
  partially_delivered: 'Partially Delivered',
  failed: 'Failed Delivery',
};

const TAB_STATUSES: Record<DispatchTab, ParcelStatus[]> = {
  arrived_at_branch: ['arrived_at_branch', 'arrived'],
  ready_to_deliver: ['ready_to_deliver'],
  sent_for_delivery: ['sent_for_delivery'],
  delivered: ['delivered'],
  partially_delivered: ['partially_delivered'],
  failed: ['failed_delivery'],
};

const STATUS_LABELS: Record<ParcelStatus, string> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Pickup Completed',
  arrived: 'Arrived at Origin',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'Sent for Delivery',
  oov: 'Transit',
  dispatched: 'In Transit',
  arrived_at_branch: 'Arrived at Destination',
  hold: 'Hold',
  loss_and_damage: 'Loss and Damage',
  delivered: 'Delivered',
  partially_delivered: 'Partially Delivered',
  failed_pickup: 'Failed Pickup',
  failed_delivery: 'Failed Delivery',
  cancelled: 'Cancelled',
  follow_up: 'Follow Up',
  ready_to_return: 'Ready to Return',
  sent_to_vendor: 'Sent to Vendor',
  returned_to_vendor: 'Returned to Vendor',
};

const STATUS_TRANSITIONS: Record<ParcelStatus, ParcelStatus[]> = {
  pickup_ordered: ['rider_assigned', 'cancelled'],
  rider_assigned: ['picked_up', 'failed_pickup', 'cancelled'],
  picked_up: ['arrived'],
  arrived: ['ready_to_deliver', 'oov'],
  dispatched: ['arrived_at_branch'],
  arrived_at_branch: ['ready_to_deliver'],
  ready_to_deliver: ['sent_for_delivery', 'hold'],
  sent_for_delivery: ['delivered', 'partially_delivered', 'failed_delivery'],
  oov: ['dispatched', 'hold'],
  hold: ['ready_to_deliver', 'oov', 'loss_and_damage'],
  delivered: [],
  partially_delivered: ['ready_to_deliver', 'follow_up', 'ready_to_return'],
  failed_pickup: ['pickup_ordered', 'cancelled'],
  failed_delivery: ['ready_to_deliver', 'follow_up', 'ready_to_return'],
  cancelled: [],
  loss_and_damage: ['ready_to_deliver', 'arrived_at_branch'],
  follow_up: ['ready_to_deliver', 'ready_to_return'],
  ready_to_return: [],
  sent_to_vendor: [],
  returned_to_vendor: [],
};

const createEmptyTabSelections = (): Record<DispatchTab, Set<string | number>> => ({
  arrived_at_branch: new Set(),
  ready_to_deliver: new Set(),
  sent_for_delivery: new Set(),
  delivered: new Set(),
  partially_delivered: new Set(),
  failed: new Set(),
});

// Cancelling or failing an order requires a reason remark.
const REASON_REQUIRED_STATUSES: ParcelStatus[] = ['cancelled', 'failed_pickup', 'failed_delivery'];

const DispatchOperations: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<OrdersPageMeta | null>(null);
  const [activeTab, setActiveTab] = useState<DispatchTab>(() => {
    const fromUrl = searchParams.get('tab');
    return fromUrl && fromUrl in TAB_LABELS ? (fromUrl as DispatchTab) : 'ready_to_deliver';
  });
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('search') || '');
  const pager = useCursorPagination();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedIdsByTab, setSelectedIdsByTab] = useState<Record<DispatchTab, Set<string | number>>>(createEmptyTabSelections);
  const [isActionOpen, setIsActionOpen] = useState(false);
  const [selectedNextStatus, setSelectedNextStatus] = useState<ParcelStatus | ''>('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [actionError, setActionError] = useState('');
  const [riders, setRiders] = useState<{ id: string; name: string }[]>([]);
  const [riderId, setRiderId] = useState('');
  const [partialRemarks, setPartialRemarks] = useState('');
  const [partialCodCollected, setPartialCodCollected] = useState('');
  const [reasonRemarks, setReasonRemarks] = useState('');
  const [remarkPopupOrder, setRemarkPopupOrder] = useState<Order | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await getRiders();
        if (res?.success && Array.isArray(res.data)) {
          setRiders(res.data.filter((r: { status: string }) => r.status === 'active'));
        }
      } catch {
        // rider dropdown will just be empty; not fatal for the rest of the page
      }
    })();
  }, []);

  // Debounce search input so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    pager.reset();
  }, [activeTab, debouncedSearch, pager.reset]);

  // Keep tab/search bookmarkable - mirror into the URL (replacing history,
  // not pushing, so the back button doesn't step through every keystroke).
  useEffect(() => {
    const next = new URLSearchParams();
    if (activeTab !== 'ready_to_deliver') next.set('tab', activeTab);
    if (debouncedSearch) next.set('search', debouncedSearch);
    setSearchParams(next, { replace: true });
  }, [activeTab, debouncedSearch, setSearchParams]);

  const loadDispatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOrders({
        status: TAB_STATUSES[activeTab],
        search: debouncedSearch || undefined,
        pageSize: PAGE_SIZE,
        cursor: pager.request.cursor,
        dir: pager.request.dir,
      });
      if (res?.success && Array.isArray(res.data)) {
        setOrders(res.data);
        setMeta(res.meta ?? null);
        setLoadError('');
      }
    } catch {
      setLoadError('Failed to load dispatch orders. Showing the last loaded data, if any.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, debouncedSearch, pager.request]);

  useEffect(() => { loadDispatches(); }, [loadDispatches]);
  useEffect(() => subscribeToOrderStatusChanged(loadDispatches), [loadDispatches]);

  const visibleOrders = orders;
  const totalPages = meta?.totalPages ?? 1;
  const selectedIds = selectedIdsByTab[activeTab];
  const visibleOrderIds = visibleOrders.map(order => order.id);
  const allVisibleSelected = visibleOrderIds.length > 0 && visibleOrderIds.every(id => selectedIds.has(id));
  const someVisibleSelected = visibleOrderIds.some(id => selectedIds.has(id));
  const selectedOrders = visibleOrders.filter(order => selectedIds.has(order.id));

  // Selection is scoped to a single loaded page - clear it when the page or
  // tab changes so a bulk action never silently drops ids that scrolled out
  // of the currently-fetched page.
  useEffect(() => {
    setSelectedIdsByTab(prev => ({ ...prev, [activeTab]: new Set() }));
  }, [activeTab, pager.request]);
  const allowedStatusOptions = useMemo(() => {
    if (selectedOrders.length === 0) return [];

    const [firstOrder, ...remainingOrders] = selectedOrders;
    const firstAllowed = new Set(STATUS_TRANSITIONS[firstOrder.status]);

    return Array.from(firstAllowed).filter(status =>
      remainingOrders.every(order => STATUS_TRANSITIONS[order.status].includes(status)),
    );
  }, [selectedOrders]);

  const effectiveNextStatus =
    selectedNextStatus && allowedStatusOptions.includes(selectedNextStatus)
      ? selectedNextStatus
      : allowedStatusOptions[0] || '';

  const isRiderAssignAction = effectiveNextStatus === 'sent_for_delivery';
  const isPartialDeliveryAction = effectiveNextStatus === 'partially_delivered';
  const isReasonRequiredAction = REASON_REQUIRED_STATUSES.includes(effectiveNextStatus as ParcelStatus);

  const toggleRowSelection = (orderId: string | number) => {
    setSelectedIdsByTab(prev => {
      const next = new Set(prev[activeTab]);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return { ...prev, [activeTab]: next };
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedIdsByTab(prev => {
      const next = new Set(prev[activeTab]);
      if (allVisibleSelected) {
        visibleOrderIds.forEach(id => next.delete(id));
      } else {
        visibleOrderIds.forEach(id => next.add(id));
      }
      return { ...prev, [activeTab]: next };
    });
  };

  const openStatusAction = () => {
    const nextOpen = !isActionOpen;
    setIsActionOpen(nextOpen);

    if (selectedOrders.length === 0) {
      setActionError('Select at least one dispatch order first.');
      return;
    }

    setActionError(allowedStatusOptions.length > 0 ? '' : 'No valid status transition is available for the selected order status.');
    setSelectedNextStatus(effectiveNextStatus);
  };

  const applyStatusChange = async () => {
    setActionError('');

    if (selectedOrders.length === 0) {
      setActionError('Select at least one dispatch order first.');
      return;
    }

    if (!effectiveNextStatus || !allowedStatusOptions.includes(effectiveNextStatus)) {
      setActionError('Selected status is not allowed for the current order status.');
      return;
    }

    if (isRiderAssignAction && !riderId) {
      setActionError('Select a rider to send this order for delivery.');
      return;
    }

    if (isReasonRequiredAction && !reasonRemarks.trim()) {
      setActionError('A reason remark is required to cancel or fail an order.');
      return;
    }

    if (isPartialDeliveryAction) {
      if (!partialRemarks.trim()) {
        setActionError('Remarks are required for partial delivery.');
        return;
      }
      const codValue = parseFloat(partialCodCollected);
      if (isNaN(codValue) || codValue < 0) {
        setActionError('COD collected must be non-negative.');
        return;
      }
      // Validate COD doesn't exceed any selected parcel's total COD
      for (const order of selectedOrders) {
        if (codValue > order.codAmount) {
          setActionError(`COD collected (${codValue}) cannot exceed parcel ${order.trackingId}'s total COD (${order.codAmount}).`);
          return;
        }
      }
    }

    setStatusUpdating(true);
    try {
      const options = isRiderAssignAction
        ? { riderId }
        : isPartialDeliveryAction
          ? { remarks: partialRemarks, codCollected: parseFloat(partialCodCollected) }
          : isReasonRequiredAction
            ? { remarks: reasonRemarks.trim() }
            : undefined;
      await bulkUpdateOrderStatus(
        selectedOrders.map(order => order.id),
        effectiveNextStatus,
        options,
      );
      await loadDispatches();

      setSelectedIdsByTab(prev => ({ ...prev, [activeTab]: new Set() }));
      setIsActionOpen(false);
      setSelectedNextStatus('');
      setRiderId('');
      setPartialRemarks('');
      setPartialCodCollected('');
      setReasonRemarks('');
    } catch (err: unknown) {
      const message =
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        typeof (err as { response?: { data?: { message?: unknown } } }).response?.data?.message === 'string'
          ? (err as { response: { data: { message: string } } }).response.data.message
          : 'Failed to change dispatch status.';
      setActionError(message);
    } finally {
      setStatusUpdating(false);
    }
  };

  const downloadCsv = async () => {
    let rows: Order[] = visibleOrders;
    try {
      const res = await getOrders({ status: TAB_STATUSES[activeTab], search: debouncedSearch || undefined });
      if (res?.success && Array.isArray(res.data)) {
        rows = res.data;
      }
    } catch {
      // fall back to the currently loaded page
    }

    const headers = ['SN', 'Date', 'Tracking ID', 'Order Type', 'Sender', 'Receiver', 'Location', 'Weight', 'COD', 'Attempt', 'Delivery Rider', 'Last Updated', 'Remarks'];
    const csvRows = rows.map(order => [
      `#${order.orderNumber}`,
      toBsDate(order.createdAt) || '',
      order.trackingId,
      order.orderType,
      order.senderName,
      order.receiverName,
      order.destination,
      order.weightKg ? `${order.weightKg} Kg` : '',
      formatMoney(order.codAmount),
      order.attemptCount,
      order.riderName || '',
      toBsDate(order.lastUpdatedAt) || '',
      order.remarks || '',
    ]);
    const csv = [headers, ...csvRows]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dispatch-orders.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintLabels = () => {
    const labelOrders = selectedOrders.length > 0 ? selectedOrders : visibleOrders;
    void printLabels(labelOrders);
  };

  const dispatchColumns = [
    {
      header: 'SN',
      accessor: (order: Order) => `#${order.orderNumber}`,
      width: '70px',
    },
    { header: 'DATE', accessor: (order: Order) => toBsDate(order.createdAt) || '-', width: '95px' },
    {
      header: 'TRACKING ID',
      accessor: (order: Order) => (
        <Link to={`/orders/track/${order.trackingId}`} className="tracking-id-link">{order.trackingId}</Link>
      ),
      width: '140px',
      className: 'dispatch-tracking-cell',
    },
    {
      header: 'ORDER TYPE',
      accessor: (order: Order) => (
        <span className="dispatch-order-type">
          <Send size={16} />
          {order.orderType}
        </span>
      ),
      width: '130px',
    },
    {
      header: 'SENDER',
      accessor: (order: Order) => (
        <div className="dispatch-party-cell">
          <span>{order.senderName}</span>
          <small>{order.senderPhone}</small>
        </div>
      ),
      width: '170px',
    },
    {
      header: 'RECEIVER',
      accessor: (order: Order) => (
        <div className="dispatch-party-cell">
          <span>{order.receiverName}</span>
          <small>{order.receiverPhone}</small>
        </div>
      ),
      width: '170px',
    },
    { header: 'LOCATION', accessor: (order: Order) => order.destination || '-', width: '140px' },
    { header: 'WEIGHT', accessor: (order: Order) => (order.weightKg ? `${order.weightKg} Kg` : '-'), width: '90px' },
    { header: 'COD', accessor: (order: Order) => formatMoney(order.codAmount), width: '100px' },
    { header: 'ATTEMPT', accessor: (order: Order) => order.attemptCount, width: '90px' },
    { header: 'DELIVERY RIDER', accessor: (order: Order) => order.riderName || '-', width: '150px' },
    { header: 'LAST UPDATED', accessor: (order: Order) => toBsDate(order.lastUpdatedAt) || '-', width: '135px' },
    {
      header: 'REMARKS',
      accessor: (order: Order) => (
        <button
          type="button"
          className="dispatch-remarks-cell-btn"
          onClick={() => setRemarkPopupOrder(order)}
          title={order.remarks || 'Add remark'}
        >
          {order.remarks || '-'}
        </button>
      ),
      width: '160px',
      className: 'dispatch-remarks-cell',
    },
  ];

  return (
    <div className="dispatch-operations-container">
      <PageHeader title="Local Dispatch" subtitle="Oversee and monitor your dispatch orders throughout the hub network.">
        <TicketCategoryButton category="delivery" notificationType="dispatch" />
      </PageHeader>

      <SegmentedTabs
        ariaLabel="Dispatch operation filters"
        value={activeTab}
        onChange={(tab) => {
          setActiveTab(tab);
          pager.reset();
          setIsActionOpen(false);
          setActionError('');
          setRiderId('');
        }}
        options={(Object.keys(TAB_LABELS) as DispatchTab[]).map(tab => ({ value: tab, label: TAB_LABELS[tab] }))}
      />

      {loadError && <p className="dispatch-action-error">{loadError}</p>}

      <div className="dispatch-toolbar">
        <div />
        <div className="dispatch-toolbar-actions">
          <div className="dispatch-action-anchor">
            <Button variant="secondary" className="dispatch-outline-btn" onClick={openStatusAction}>
              Action{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </Button>
            {isActionOpen && (
              <div className="dispatch-status-popover">
                <div className="dispatch-status-popover-header">
                  <span>Next status</span>
                  <button type="button" onClick={() => setIsActionOpen(false)} aria-label="Close status action">
                    &times;
                  </button>
                </div>
                <div className="dispatch-status-options">
                  {allowedStatusOptions.length === 0 ? (
                    <p className="dispatch-status-empty">No valid transitions</p>
                  ) : allowedStatusOptions.map(status => (
                    status === 'sent_for_delivery' ? (
                      <div
                        key={status}
                        className={`dispatch-status-option-rider ${effectiveNextStatus === status ? 'selected' : ''}`}
                      >
                        <SearchableSelect
                          options={riders.map(r => ({ id: r.id, label: r.name }))}
                          value={riderId}
                          onChange={id => {
                            setRiderId(id);
                            setSelectedNextStatus('sent_for_delivery');
                          }}
                          placeholder="Select rider"
                          searchPlaceholder="Search rider by name..."
                          emptyMessage="No active riders found."
                          disabled={statusUpdating}
                        />
                      </div>
                    ) : (
                      <button
                        key={status}
                        type="button"
                        className={`dispatch-status-option ${effectiveNextStatus === status ? 'selected' : ''}`}
                        onClick={() => setSelectedNextStatus(status)}
                        disabled={statusUpdating}
                      >
                        {STATUS_LABELS[status]}
                      </button>
                    )
                  ))}
                </div>
                {isPartialDeliveryAction && (
                  <div className="dispatch-partial-form">
                    <div className="dispatch-partial-field">
                      <label className="dispatch-partial-label">
                        Remarks <span className="dispatch-partial-required">*</span>
                      </label>
                      <textarea
                        rows={2}
                        value={partialRemarks}
                        onChange={e => setPartialRemarks(e.target.value)}
                        placeholder="Reason for partial delivery..."
                        className="dispatch-partial-textarea"
                        disabled={statusUpdating}
                      />
                    </div>
                    <div className="dispatch-partial-field">
                      <label className="dispatch-partial-label">
                        COD Collected <span className="dispatch-partial-required">*</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={partialCodCollected}
                        onChange={e => setPartialCodCollected(e.target.value)}
                        placeholder="Amount collected"
                        className="dispatch-partial-input"
                        disabled={statusUpdating}
                      />
                    </div>
                  </div>
                )}
                {isReasonRequiredAction && (
                  <div className="dispatch-partial-form">
                    <div className="dispatch-partial-field">
                      <label className="dispatch-partial-label">
                        Reason <span className="dispatch-partial-required">*</span>
                      </label>
                      <textarea
                        rows={2}
                        value={reasonRemarks}
                        onChange={e => setReasonRemarks(e.target.value)}
                        placeholder={`Reason to ${STATUS_LABELS[effectiveNextStatus as ParcelStatus]?.toLowerCase() || 'cancel/fail'}...`}
                        className="dispatch-partial-textarea"
                        disabled={statusUpdating}
                      />
                    </div>
                  </div>
                )}
                {actionError && <p className="dispatch-action-error">{actionError}</p>}
                <div className="dispatch-status-submit-row">
                  <Button variant="secondary" className="dispatch-outline-btn" onClick={() => { setIsActionOpen(false); setRiderId(''); setReasonRemarks(''); }}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="dispatch-apply-btn"
                    onClick={applyStatusChange}
                    disabled={statusUpdating || !effectiveNextStatus || (isRiderAssignAction && !riderId) || (isPartialDeliveryAction && (!partialRemarks.trim() || !partialCodCollected)) || (isReasonRequiredAction && !reasonRemarks.trim())}
                  >
                    {statusUpdating ? 'Applying...' : 'Submit'}
                  </Button>
                </div>
              </div>
            )}
          </div>
          <Button variant="secondary" className="dispatch-outline-btn" onClick={downloadCsv}>
            <Download size={14} /> Download
          </Button>
          <Button variant="secondary" className="dispatch-outline-btn" onClick={handlePrintLabels} disabled={visibleOrders.length === 0}>
            <Printer size={14} /> {selectedOrders.length > 0 ? `Print ${selectedOrders.length} Selected` : `Print All (${visibleOrders.length})`}
          </Button>
        </div>
      </div>

      <label className="dispatch-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={event => {
            setSearchQuery(event.target.value);
            pager.reset();
            setIsActionOpen(false);
            setActionError('');
            setRiderId('');
          }}
          placeholder="Search tracking id"
        />
      </label>

      <Table
        columns={dispatchColumns}
        data={visibleOrders}
        selectedIds={selectedIds}
        onToggleRow={toggleRowSelection}
        allSelected={allVisibleSelected}
        someSelected={someVisibleSelected}
        onToggleAll={toggleVisibleSelection}
        loading={loading}
        loadingMessage="Loading dispatch orders..."
        emptyMessage="No dispatch orders found."
        minWidth="1680px"
        tableClassName="dispatch-table"
      />

      <Pagination
        ariaLabel="Dispatch pagination"
        page={pager.page}
        totalPages={totalPages}
        cursor={pager.controls(meta)}
        summary={meta ? `${meta.total} order${meta.total === 1 ? '' : 's'}` : undefined}
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

export default DispatchOperations;
