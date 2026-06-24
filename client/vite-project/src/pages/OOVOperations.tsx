import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Download,
  Printer,
  Search,
} from 'lucide-react';
import Table from '../components/Table';
import Button from '../components/Button';
import SegmentedTabs from '../components/SegmentedTabs';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import QuickRemarkPopup from '../components/QuickRemarkPopup';
import {
  bulkUpdateOrderStatus,
  getOrders,
  notifyOrderStatusChanged,
  subscribeToOrderStatusChanged,
  type Order,
  type OrdersPageMeta,
  type ParcelStatus,
} from '../services/orders.service';
import { getLocations, getRiders } from '../services/users.service';
import './OOVOperations.css';

type OOVTab = 'oov' | 'dispatch_manifest' | 'dispatched' | 'arrived_at_branch';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

const TAB_LABELS: Record<OOVTab, string> = {
  oov: 'OOV',
  dispatch_manifest: 'Dispatch manifest',
  dispatched: 'Dispatched',
  arrived_at_branch: 'Arrived at branch',
};

const TAB_STATUSES: Record<OOVTab, ParcelStatus[]> = {
  oov: ['oov'],
  dispatch_manifest: ['oov', 'dispatched', 'arrived_at_branch'],
  dispatched: ['dispatched'],
  arrived_at_branch: ['arrived_at_branch', 'arrived'],
};

const STATUS_LABELS: Record<ParcelStatus, string> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Pickup Completed',
  arrived: 'Arrived',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'Sent for Delivery',
  oov: 'OOV',
  dispatched: 'Dispatched',
  arrived_at_branch: 'Arrived at Branch',
  hold: 'Hold',
  loss_and_damage: 'Loss and Damage',
  delivered: 'Delivered',
  failed_pickup: 'Failed Pickup',
  failed_delivery: 'Failed Delivery',
  cancelled: 'Cancelled',
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
  failed_pickup: [],
  failed_delivery: [],
  cancelled: [],
  loss_and_damage: ['ready_to_deliver', 'arrived_at_branch'],
};

const MOCK_OOV_ORDERS: Order[] = [
  {
    id: 'oov-1',
    trackingId: 'TRK-8821940',
    status: 'oov',
    orderType: 'delivery',
    serviceType: 'btb',
    senderName: 'Aarav Store',
    senderPhone: '9811111111',
    receiverName: 'Mina Shrestha',
    receiverPhone: '9800000000',
    origin: 'Kathmandu Hub',
    destination: 'Pokhara Hub',
    pieces: 2,
    weightKg: 3,
    codAmount: 1200,
    deliveryCharge: 129,
    riderName: 'Sagar',
    remarks: 'Handle with care',
    lastUpdatedBy: 'Sagar',
    lastUpdatedAt: '2026-06-19',
    createdAt: '2026-06-17',
  },
  {
    id: 'oov-2',
    trackingId: 'TRK-8821941',
    status: 'dispatched',
    orderType: 'exchange',
    serviceType: 'dtd',
    senderName: 'Nima Retail',
    senderPhone: '9822222222',
    receiverName: 'Amit Lama',
    receiverPhone: '9812345678',
    origin: 'Lalitpur',
    destination: 'Bhaktapur',
    pieces: 1,
    weightKg: 1,
    codAmount: 0,
    deliveryCharge: 99,
    riderName: 'Ram',
    remarks: '-',
    lastUpdatedBy: 'Ram',
    lastUpdatedAt: '2026-06-20',
    createdAt: '2026-06-18',
  },
  {
    id: 'oov-3',
    trackingId: 'TRK-8821942',
    status: 'arrived_at_branch',
    orderType: 'delivery',
    serviceType: 'btd',
    senderName: 'Parcelmoover Vendor',
    senderPhone: '9844444444',
    receiverName: 'Suman Karki',
    receiverPhone: '9855555555',
    origin: 'Pokhara Hub',
    destination: 'Lakeside',
    pieces: 3,
    weightKg: 5,
    codAmount: 2200,
    deliveryCharge: 149,
    riderName: 'Sameer',
    remarks: 'Fragile',
    lastUpdatedBy: 'Sameer',
    lastUpdatedAt: '2026-06-21',
    createdAt: '2026-06-19',
  },
];

const createEmptySelections = (): Record<OOVTab, Map<string, Order>> => ({
  oov: new Map(),
  dispatch_manifest: new Map(),
  dispatched: new Map(),
  arrived_at_branch: new Map(),
});

const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const matchesSearch = (order: Order, q: string) =>
  !q ||
  order.trackingId.toLowerCase().includes(q) ||
  order.senderName.toLowerCase().includes(q) ||
  order.receiverName.toLowerCase().includes(q) ||
  order.destination.toLowerCase().includes(q);

const OOVOperations: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<OrdersPageMeta | null>(null);
  const [mockOrders, setMockOrders] = useState<Order[]>(MOCK_OOV_ORDERS);
  const [activeTab, setActiveTab] = useState<OOVTab>('oov');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [usingMockData, setUsingMockData] = useState(false);
  const [selectionByTab, setSelectionByTab] = useState<Record<OOVTab, Map<string, Order>>>(createEmptySelections);
  const [isActionOpen, setIsActionOpen] = useState(false);
  const [selectedNextStatus, setSelectedNextStatus] = useState<ParcelStatus | ''>('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [actionError, setActionError] = useState('');
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [riders, setRiders] = useState<{ id: string; name: string }[]>([]);
  const [toLocationId, setToLocationId] = useState('');
  const [riderId, setRiderId] = useState('');
  const [remarkPopupOrder, setRemarkPopupOrder] = useState<Order | null>(null);

  // Debounce search input so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
    setIsActionOpen(false);
    setActionError('');
  }, [activeTab, debouncedSearch]);

  useEffect(() => {
    // Hub/rider selects only matter for the "dispatched" manifest action.
    (async () => {
      try {
        const [locRes, riderRes] = await Promise.all([getLocations(), getRiders()]);
        if (locRes?.success && Array.isArray(locRes.data)) setLocations(locRes.data);
        if (riderRes?.success && Array.isArray(riderRes.data)) {
          setRiders(riderRes.data.filter((r: { status: string }) => r.status === 'active'));
        }
      } catch {
        // Manifest fields will just be empty selects; not fatal for the page.
      }
    })();
  }, []);

  const loadOovOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOrders({
        status: TAB_STATUSES[activeTab],
        search: debouncedSearch || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      if (res?.success && Array.isArray(res.data)) {
        setOrders(res.data);
        setMeta(res.meta ?? null);
        setUsingMockData(false);
      } else {
        setUsingMockData(true);
      }
    } catch {
      setUsingMockData(true);
    } finally {
      setLoading(false);
    }
  }, [activeTab, debouncedSearch, page]);

  useEffect(() => {
    loadOovOrders();
  }, [loadOovOrders]);

  useEffect(() => subscribeToOrderStatusChanged(loadOovOrders), [loadOovOrders]);

  const mockFilteredOrders = useMemo(() => {
    if (!usingMockData) return [];
    const tabStatuses = TAB_STATUSES[activeTab];
    const q = debouncedSearch.toLowerCase();
    return mockOrders
      .filter(order => tabStatuses.includes(order.status))
      .filter(order => matchesSearch(order, q));
  }, [usingMockData, mockOrders, activeTab, debouncedSearch]);

  const visibleOrders = usingMockData
    ? mockFilteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    : orders;

  const totalCount = usingMockData ? mockFilteredOrders.length : meta?.total ?? visibleOrders.length;
  const totalPages = usingMockData
    ? Math.max(1, Math.ceil(mockFilteredOrders.length / PAGE_SIZE))
    : meta?.totalPages ?? 1;

  const selectionMap = selectionByTab[activeTab];
  const selectedIds = useMemo(() => new Set<string | number>(selectionMap.keys()), [selectionMap]);
  const selectedOrders = useMemo(() => Array.from(selectionMap.values()), [selectionMap]);
  const visibleOrderIds = visibleOrders.map(order => order.id);
  const allVisibleSelected = visibleOrderIds.length > 0 && visibleOrderIds.every(id => selectedIds.has(id));
  const someVisibleSelected = visibleOrderIds.some(id => selectedIds.has(id));

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

  const isDispatchAction = effectiveNextStatus === 'dispatched';

  const toggleRowSelection = (orderId: string | number) => {
    const order = visibleOrders.find(o => o.id === orderId);
    if (!order) return;

    setSelectionByTab(prev => {
      const nextMap = new Map(prev[activeTab]);
      if (nextMap.has(String(orderId))) {
        nextMap.delete(String(orderId));
      } else {
        nextMap.set(String(orderId), order);
      }
      return { ...prev, [activeTab]: nextMap };
    });
  };

  const toggleVisibleSelection = () => {
    setSelectionByTab(prev => {
      const nextMap = new Map(prev[activeTab]);
      if (allVisibleSelected) {
        visibleOrders.forEach(order => nextMap.delete(String(order.id)));
      } else {
        visibleOrders.forEach(order => nextMap.set(String(order.id), order));
      }
      return { ...prev, [activeTab]: nextMap };
    });
  };

  const openStatusAction = () => {
    const nextOpen = !isActionOpen;
    setIsActionOpen(nextOpen);

    if (selectedOrders.length === 0) {
      setActionError('Select at least one OOV order first.');
      return;
    }

    setActionError(allowedStatusOptions.length > 0 ? '' : 'No valid status transition is available for the selected order status.');
    setSelectedNextStatus(effectiveNextStatus);
  };

  const applyStatusChange = async () => {
    setActionError('');

    if (selectedOrders.length === 0) {
      setActionError('Select at least one OOV order first.');
      return;
    }

    if (!effectiveNextStatus || !allowedStatusOptions.includes(effectiveNextStatus)) {
      setActionError('Selected status is not allowed for the current order status.');
      return;
    }

    if (isDispatchAction && !toLocationId) {
      setActionError('Select a destination hub to dispatch this manifest.');
      return;
    }

    setStatusUpdating(true);
    try {
      const ids = selectedOrders.map(order => String(order.id));

      if (!usingMockData) {
        await bulkUpdateOrderStatus(ids, effectiveNextStatus, {
          toLocationId: isDispatchAction ? toLocationId : undefined,
          riderId: isDispatchAction ? riderId || undefined : undefined,
        });
        await loadOovOrders();
      } else {
        setMockOrders(prev => prev.map(order => (
          selectedIds.has(order.id) ? { ...order, status: effectiveNextStatus } : order
        )));
        notifyOrderStatusChanged();
      }

      setSelectionByTab(prev => ({ ...prev, [activeTab]: new Map() }));
      setIsActionOpen(false);
      setSelectedNextStatus('');
      setToLocationId('');
      setRiderId('');
    } catch (err: unknown) {
      const message =
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        typeof (err as { response?: { data?: { message?: unknown } } }).response?.data?.message === 'string'
          ? (err as { response: { data: { message: string } } }).response.data.message
          : 'Failed to change OOV status.';
      setActionError(message);
    } finally {
      setStatusUpdating(false);
    }
  };

  const buildCsv = (rows: Order[]) => {
    const headers = ['Date', 'Tracking ID', 'Order Type', 'Sender', 'Receiver', 'Location', 'Weight', 'COD', 'Last Updated', 'Remarks'];
    const csvRows = rows.map(order => [
      order.createdAt,
      order.trackingId,
      order.orderType,
      order.senderName,
      order.receiverName,
      order.destination,
      order.weightKg ? `${order.weightKg} Kg` : '',
      order.codAmount,
      order.lastUpdatedAt || '',
      order.remarks || '',
    ]);
    return [headers, ...csvRows]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
  };

  const downloadCsv = async () => {
    let rows: Order[] = visibleOrders;

    if (usingMockData) {
      rows = mockFilteredOrders;
    } else {
      try {
        const res = await getOrders({ status: TAB_STATUSES[activeTab], search: debouncedSearch || undefined });
        if (res?.success && Array.isArray(res.data)) {
          rows = res.data;
        }
      } catch {
        // fall back to the currently loaded page
      }
    }

    const csv = buildCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'oov-orders.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const oovColumns = [
    {
      header: 'SN',
      accessor: (order: Order) => ((page - 1) * PAGE_SIZE) + visibleOrders.findIndex(row => row.id === order.id) + 1,
      width: '34px',
      className: 'oov-sn-cell',
    },
    { header: 'DATE', accessor: (order: Order) => order.createdAt || '-', width: '100px' },
    {
      header: 'TRACKING ID',
      accessor: (order: Order) => (
        <Link to={`/orders/track/${order.trackingId}`} className="tracking-id-link">{order.trackingId}</Link>
      ),
      width: '124px',
      className: 'oov-tracking-cell',
    },
    {
      header: 'ORDER TYPE',
      accessor: (order: Order) => <span className="oov-order-type">{order.orderType}</span>,
      width: '131px',
    },
    {
      header: 'SENDER',
      accessor: (order: Order) => (
        <div className="oov-party-cell">
          <span>{order.senderName}</span>
          <small>{order.senderPhone}</small>
        </div>
      ),
      width: '239px',
    },
    {
      header: 'RECEIVER',
      accessor: (order: Order) => (
        <div className="oov-party-cell">
          <span>{order.receiverName}</span>
          <small>{order.receiverPhone}</small>
        </div>
      ),
      width: '238px',
    },
    { header: 'LOCATION', accessor: (order: Order) => order.destination || '-', width: '130px' },
    { header: 'WEIGHT', accessor: (order: Order) => (order.weightKg ? `${order.weightKg} Kg` : '-'), width: '80px' },
    { header: 'COD', accessor: (order: Order) => formatMoney(order.codAmount), width: '113px' },
    {
      header: 'LAST UPDATED',
      accessor: (order: Order) => (
        <div className="oov-updated-cell">
          <span>{order.lastUpdatedBy || '-'}</span>
          <span>{order.lastUpdatedAt || '-'}</span>
        </div>
      ),
      width: '155px',
    },
    { header: 'REMARKS', accessor: (order: Order) => (
      <button
        type="button"
        className="oov-remarks-cell-btn"
        onClick={() => setRemarkPopupOrder(order)}
        title={order.remarks || 'Add remark'}
      >
        {order.remarks || '-'}
      </button>
    ), width: '84px', className: 'oov-remarks-cell' },
  ];

  return (
    <div className="oov-operations-container">
      <PageHeader title="Out of the valley (OOV)" subtitle="Keep track of your dispatch orders across the entire hub network." />

      <SegmentedTabs
        ariaLabel="OOV operation filters"
        value={activeTab}
        onChange={setActiveTab}
        options={(Object.keys(TAB_LABELS) as OOVTab[]).map(tab => ({ value: tab, label: TAB_LABELS[tab] }))}
      />

      <div className="oov-toolbar">
        <div />
        <div className="oov-toolbar-actions">
          <div className="oov-action-anchor">
            <Button variant="secondary" className="oov-outline-btn" onClick={openStatusAction}>
              Action{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </Button>
            {isActionOpen && (
              <div className="oov-status-popover">
                <div className="oov-status-popover-header">
                  <span>Next status</span>
                  <button type="button" onClick={() => setIsActionOpen(false)} aria-label="Close status action">
                    &times;
                  </button>
                </div>
                <div className="oov-status-options">
                  {allowedStatusOptions.length === 0 ? (
                    <p className="oov-status-empty">No valid transitions</p>
                  ) : allowedStatusOptions.map(status => (
                    <button
                      key={status}
                      type="button"
                      className={`oov-status-option ${effectiveNextStatus === status ? 'selected' : ''}`}
                      onClick={() => setSelectedNextStatus(status)}
                      disabled={statusUpdating}
                    >
                      {STATUS_LABELS[status]}
                    </button>
                  ))}
                </div>
                {isDispatchAction && (
                  <div className="oov-manifest-fields">
                    <label>
                      Destination hub
                      <select
                        value={toLocationId}
                        onChange={event => setToLocationId(event.target.value)}
                        disabled={statusUpdating}
                      >
                        <option value="">Select destination hub</option>
                        {locations.map(loc => (
                          <option key={loc.id} value={loc.id}>{loc.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Rider / vehicle (optional)
                      <select
                        value={riderId}
                        onChange={event => setRiderId(event.target.value)}
                        disabled={statusUpdating}
                      >
                        <option value="">Unassigned</option>
                        {riders.map(rider => (
                          <option key={rider.id} value={rider.id}>{rider.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {actionError && <p className="oov-action-error">{actionError}</p>}
                <div className="oov-status-submit-row">
                  <Button variant="secondary" className="oov-outline-btn" onClick={() => setIsActionOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="oov-apply-btn"
                    onClick={applyStatusChange}
                    disabled={statusUpdating || !effectiveNextStatus}
                  >
                    {statusUpdating ? 'Applying...' : 'Submit'}
                  </Button>
                </div>
              </div>
            )}
          </div>
          <Button variant="secondary" className="oov-outline-btn" onClick={downloadCsv}>
            <Download size={14} /> Download
          </Button>
          <Button variant="secondary" className="oov-outline-btn" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </Button>
        </div>
      </div>

      <label className="oov-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={event => setSearchQuery(event.target.value)}
          placeholder="Search tracking id"
        />
      </label>

      <Table
        columns={oovColumns}
        data={visibleOrders}
        selectedIds={selectedIds}
        onToggleRow={toggleRowSelection}
        allSelected={allVisibleSelected}
        someSelected={someVisibleSelected}
        onToggleAll={toggleVisibleSelection}
        loading={loading}
        loadingMessage="Loading OOV orders..."
        emptyMessage="No OOV orders found."
        minWidth="1480px"
        tableClassName="oov-table"
      />

      <Pagination
        ariaLabel="OOV pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
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

export default OOVOperations;
