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
import Pagination from '../components/Pagination';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import {
  bulkUpdateOrderStatus,
  getOrders,
  subscribeToOrderStatusChanged,
  type Order,
  type OrdersPageMeta,
  type ParcelStatus,
} from '../services/orders.service';
import { getRiders } from '../services/users.service';
import { useCursorPagination } from '../hooks/useCursorPagination';
import './DispatchOperations.css';

type DispatchTab =
  | 'arrived_at_branch'
  | 'ready_to_deliver'
  | 'sent_for_delivery'
  | 'delivered'
  | 'failed'
  | 'cancelled';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

const TAB_LABELS: Record<DispatchTab, string> = {
  arrived_at_branch: 'Arrived at branch',
  ready_to_deliver: 'Ready for delivery',
  sent_for_delivery: 'Sent for delivery',
  delivered: 'Delivered',
  failed: 'Failed Delivery',
  cancelled: 'Cancelled',
};

const TAB_STATUSES: Record<DispatchTab, ParcelStatus[]> = {
  arrived_at_branch: ['arrived_at_branch', 'arrived'],
  ready_to_deliver: ['ready_to_deliver'],
  sent_for_delivery: ['sent_for_delivery'],
  delivered: ['delivered'],
  failed: ['failed_delivery'],
  cancelled: ['cancelled'],
};

const STATUS_LABELS: Record<ParcelStatus, string> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Pickup Completed',
  arrived: 'Arrived',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'Sent for Delivery',
  oov: 'Transit',
  dispatched: 'Dispatched',
  arrived_at_branch: 'Arrived at Branch',
  hold: 'Hold',
  loss_and_damage: 'Loss and Damage',
  delivered: 'Delivered',
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
  sent_for_delivery: ['delivered', 'failed_delivery'],
  oov: ['dispatched', 'hold'],
  hold: ['ready_to_deliver', 'oov', 'loss_and_damage'],
  delivered: [],
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
  failed: new Set(),
  cancelled: new Set(),
});

const getStatusTone = (status: ParcelStatus): StatusChipTone => {
  if (status === 'delivered') return 'success';
  if (['failed_delivery', 'failed_pickup', 'loss_and_damage'].includes(status)) return 'danger';
  if (status === 'cancelled') return 'neutral';
  if (['sent_for_delivery', 'ready_to_deliver'].includes(status)) return 'info';
  return 'warning';
};

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

    setStatusUpdating(true);
    try {
      // One bulk call instead of N singles: the whole selection succeeds or
      // fails together, and a rider hand-off opens a single run sheet for the
      // batch rather than one sheet per parcel.
      await bulkUpdateOrderStatus(
        selectedOrders.map(order => order.id),
        effectiveNextStatus,
        isRiderAssignAction ? { riderId } : undefined,
      );
      await loadDispatches();

      setSelectedIdsByTab(prev => ({ ...prev, [activeTab]: new Set() }));
      setIsActionOpen(false);
      setSelectedNextStatus('');
      setRiderId('');
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

    const headers = ['#', 'Tracking ID', 'Receiver', 'Destination', 'Pieces', 'Status', 'Rider'];
    const csvRows = rows.map(order => [
      `#${order.orderNumber}`,
      order.trackingId,
      order.receiverName,
      order.destination,
      order.pieces,
      STATUS_LABELS[order.status],
      order.riderName || '',
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

  const dispatchColumns = [
    {
      header: '#',
      accessor: (order: Order) => `#${order.orderNumber}`,
      width: '70px',
    },
    {
      header: 'TRACKING ID',
      accessor: (order: Order) => (
        <Link to={`/orders/track/${order.trackingId}`} className="tracking-id-link">{order.trackingId}</Link>
      ),
      width: '160px',
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
      width: '150px',
    },
    {
      header: 'RECEIVER',
      accessor: (order: Order) => (
        <div className="dispatch-party-cell">
          <span>{order.receiverName}</span>
          <small>{order.receiverPhone}</small>
        </div>
      ),
      width: '220px',
    },
    { header: 'DESTINATION', accessor: (order: Order) => order.destination || '-', width: '180px' },
    { header: 'PIECES', accessor: (order: Order) => order.pieces, width: '90px' },
    {
      header: 'STATUS',
      accessor: (order: Order) => (
        <StatusChip tone={getStatusTone(order.status)}>
          {STATUS_LABELS[order.status]}
        </StatusChip>
      ),
      width: '170px',
    },
    { header: 'RIDER', accessor: (order: Order) => order.riderName || '-', width: '140px' },
  ];

  return (
    <div className="dispatch-operations-container">
      <PageHeader title="Local Dispatch" subtitle="Oversee and monitor your dispatch orders throughout the hub network." />

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
                {actionError && <p className="dispatch-action-error">{actionError}</p>}
                <div className="dispatch-status-submit-row">
                  <Button variant="secondary" className="dispatch-outline-btn" onClick={() => { setIsActionOpen(false); setRiderId(''); }}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="dispatch-apply-btn"
                    onClick={applyStatusChange}
                    disabled={statusUpdating || !effectiveNextStatus || (isRiderAssignAction && !riderId)}
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
          <Button variant="secondary" className="dispatch-outline-btn" onClick={() => window.print()}>
            <Printer size={14} /> Print
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
        minWidth="1130px"
        tableClassName="dispatch-table"
      />

      <Pagination
        ariaLabel="Dispatch pagination"
        page={pager.page}
        totalPages={totalPages}
        cursor={pager.controls(meta)}
        summary={meta ? `${meta.total} order${meta.total === 1 ? '' : 's'}` : undefined}
      />
    </div>
  );
};

export default DispatchOperations;
