import React, { useEffect, useMemo, useState } from 'react';
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
  getOrders,
  notifyOrderStatusChanged,
  subscribeToOrderStatusChanged,
  updateOrderStatus,
  type Order,
  type ParcelStatus,
} from '../services/orders.service';
import { getRiders } from '../services/users.service';
import './DispatchOperations.css';

type DispatchTab =
  | 'arrived_at_branch'
  | 'ready_to_deliver'
  | 'sent_for_delivery'
  | 'delivered'
  | 'failed'
  | 'cancelled';

const PAGE_SIZE = 10;

const TAB_LABELS: Record<DispatchTab, string> = {
  arrived_at_branch: 'Arrived at branch',
  ready_to_deliver: 'Ready for delivery',
  sent_for_delivery: 'Sent for delivery',
  delivered: 'Delivered',
  failed: 'Failed',
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

const MOCK_DISPATCHES: Order[] = [
  {
    id: 'dispatch-1',
    trackingId: 'TRK-8821935',
    status: 'arrived_at_branch',
    orderType: 'delivery',
    serviceType: 'btb',
    senderName: 'Aarav Store',
    senderPhone: '9811111111',
    receiverName: 'Mina Shrestha',
    receiverPhone: '9800000000',
    origin: 'Kathmandu Hub',
    destination: 'Pokhara Hub',
    pieces: 2,
    codAmount: 1200,
    deliveryCharge: 129,
    riderName: 'Sagar',
    createdAt: '2026-06-17',
  },
  {
    id: 'dispatch-2',
    trackingId: 'TRK-8821936',
    status: 'ready_to_deliver',
    orderType: 'exchange',
    serviceType: 'dtd',
    senderName: 'Nima Retail',
    senderPhone: '9822222222',
    receiverName: 'Amit Lama',
    receiverPhone: '9812345678',
    origin: 'Lalitpur',
    destination: 'Bhaktapur',
    pieces: 1,
    codAmount: 0,
    deliveryCharge: 99,
    riderName: 'Ram',
    createdAt: '2026-06-18',
  },
  {
    id: 'dispatch-3',
    trackingId: 'TRK-8821937',
    status: 'sent_for_delivery',
    orderType: 'delivery',
    serviceType: 'btd',
    senderName: 'Parcelmoover Vendor',
    senderPhone: '9844444444',
    receiverName: 'Suman Karki',
    receiverPhone: '9855555555',
    origin: 'Pokhara Hub',
    destination: 'Lakeside',
    pieces: 3,
    codAmount: 2200,
    deliveryCharge: 149,
    riderName: 'Sameer',
    createdAt: '2026-06-19',
  },
];

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
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<DispatchTab>('ready_to_deliver');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [usingMockData, setUsingMockData] = useState(false);
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

  const loadDispatches = async () => {
    setLoading(true);
    try {
      const res = await getOrders();
      if (res?.success && Array.isArray(res.data)) {
        setOrders(res.data);
        setUsingMockData(false);
      } else if (Array.isArray(res)) {
        setOrders(res);
        setUsingMockData(false);
      } else {
        setOrders(MOCK_DISPATCHES);
        setUsingMockData(true);
      }
    } catch {
      setOrders(MOCK_DISPATCHES);
      setUsingMockData(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(loadDispatches);
  }, []);

  useEffect(() => subscribeToOrderStatusChanged(loadDispatches), []);

  const filteredOrders = useMemo(() => {
    const tabStatuses = TAB_STATUSES[activeTab];
    const q = searchQuery.trim().toLowerCase();

    return orders
      .filter(order => tabStatuses.includes(order.status))
      .filter(order => {
        if (!q) return true;
        return (
          order.trackingId.toLowerCase().includes(q) ||
          order.receiverName.toLowerCase().includes(q) ||
          order.receiverPhone.toLowerCase().includes(q) ||
          order.destination.toLowerCase().includes(q) ||
          (order.riderName || '').toLowerCase().includes(q)
        );
      });
  }, [activeTab, orders, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const visibleOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const selectedIds = selectedIdsByTab[activeTab];
  const visibleOrderIds = visibleOrders.map(order => order.id);
  const allVisibleSelected = visibleOrderIds.length > 0 && visibleOrderIds.every(id => selectedIds.has(id));
  const someVisibleSelected = visibleOrderIds.some(id => selectedIds.has(id));
  const selectedOrders = filteredOrders.filter(order => selectedIds.has(order.id));
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
      if (!usingMockData) {
        await Promise.all(
          selectedOrders.map(order => updateOrderStatus(
            order.id,
            effectiveNextStatus,
            undefined,
            undefined,
            isRiderAssignAction ? riderId : undefined,
          )),
        );
        await loadDispatches();
      } else {
        setOrders(prev => prev.map(order => (
          selectedIds.has(order.id) ? { ...order, status: effectiveNextStatus } : order
        )));
        notifyOrderStatusChanged();
      }

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

  const downloadCsv = () => {
    const headers = ['Tracking ID', 'Receiver', 'Destination', 'Pieces', 'Status', 'Rider'];
    const rows = filteredOrders.map(order => [
      order.trackingId,
      order.receiverName,
      order.destination,
      order.pieces,
      STATUS_LABELS[order.status],
      order.riderName || '',
    ]);
    const csv = [headers, ...rows]
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
      header: 'TRACKING ID',
      accessor: (order: Order) => order.trackingId,
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
      <PageHeader title="Dispatch Operations" subtitle="Oversee and monitor your dispatch orders throughout the hub network." />

      <SegmentedTabs
        ariaLabel="Dispatch operation filters"
        value={activeTab}
        onChange={(tab) => {
          setActiveTab(tab);
          setPage(1);
          setIsActionOpen(false);
          setActionError('');
          setRiderId('');
        }}
        options={(Object.keys(TAB_LABELS) as DispatchTab[]).map(tab => ({ value: tab, label: TAB_LABELS[tab] }))}
      />

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
            setPage(1);
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
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  );
};

export default DispatchOperations;
