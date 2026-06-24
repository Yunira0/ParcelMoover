import React, { useEffect, useMemo, useState } from 'react';
import {
  Download,
  PackageCheck,
  Printer,
  Search,
  Truck,
} from 'lucide-react';
import Table from '../components/Table';
import SearchableSelect from '../components/SearchableSelect';
import Button from '../components/Button';
import SegmentedTabs from '../components/SegmentedTabs';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import {
  getOrders,
  notifyOrderStatusChanged,
  subscribeToOrderStatusChanged,
  updateOrderStatus,
  type Order,
  type ParcelStatus,
} from '../services/orders.service';
import { getRiders } from '../services/users.service';
import './PickupOperations.css';

type PickupTab = 'pickup_ordered' | 'rider_assigned' | 'picked_up' | 'arrived' | 'failed' | 'cancelled';

const PAGE_SIZE = 10;

const TAB_LABELS: Record<PickupTab, string> = {
  pickup_ordered: 'Pickup order',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Pickup Completed',
  arrived: 'Arrived',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const TAB_STATUSES: Record<PickupTab, ParcelStatus[]> = {
  pickup_ordered: ['pickup_ordered'],
  rider_assigned: ['rider_assigned'],
  picked_up: ['picked_up'],
  arrived: ['arrived', 'arrived_at_branch'],
  failed: ['failed_pickup'],
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

const MOCK_PICKUPS: Order[] = [
  {
    id: 'pickup-1',
    trackingId: 'TRK-8821932',
    status: 'pickup_ordered',
    orderType: 'delivery',
    serviceType: 'dtd',
    senderName: 'Sender name',
    senderPhone: '970000000',
    receiverName: 'Receiver name',
    receiverPhone: '980000000',
    origin: 'Lalitpur',
    destination: 'Kathmandu',
    pieces: 6,
    codAmount: 0,
    deliveryCharge: 0,
    riderName: 'Rider name',
    createdAt: '2026-06-17',
  },
  {
    id: 'pickup-2',
    trackingId: 'TRK-8821933',
    status: 'failed_pickup',
    orderType: 'return',
    serviceType: 'btd',
    senderName: 'Aarav Store',
    senderPhone: '9811111111',
    receiverName: 'Receiver name',
    receiverPhone: '980000000',
    origin: 'Bhaktapur',
    destination: 'Kathmandu',
    pieces: 2,
    codAmount: 0,
    deliveryCharge: 0,
    riderName: 'Sagar',
    createdAt: '2026-06-17',
  },
  {
    id: 'pickup-3',
    trackingId: 'TRK-8821934',
    status: 'rider_assigned',
    orderType: 'exchange',
    serviceType: 'dtb',
    senderName: 'Nima Retail',
    senderPhone: '9822222222',
    receiverName: 'Receiver name',
    receiverPhone: '980000000',
    origin: 'Lalitpur',
    destination: 'Pokhara Hub',
    pieces: 1,
    codAmount: 0,
    deliveryCharge: 0,
    riderName: 'Rider name',
    createdAt: '2026-06-17',
  },
];

const getOrderTypeTone = (order: Order) => {
  if (order.status === 'failed_pickup') return 'danger';
  if (order.status === 'rider_assigned') return 'warning';
  return 'success';
};

const createEmptyTabSelections = (): Record<PickupTab, Set<string | number>> => ({
  pickup_ordered: new Set(),
  rider_assigned: new Set(),
  picked_up: new Set(),
  arrived: new Set(),
  failed: new Set(),
  cancelled: new Set(),
});

const PickupOperations: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<PickupTab>('pickup_ordered');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [usingMockData, setUsingMockData] = useState(false);
  const [selectedIdsByTab, setSelectedIdsByTab] = useState<Record<PickupTab, Set<string | number>>>(createEmptyTabSelections);
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

  const loadPickups = async () => {
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
        setOrders(MOCK_PICKUPS);
        setUsingMockData(true);
      }
    } catch {
      setOrders(MOCK_PICKUPS);
      setUsingMockData(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPickups();
  }, []);

  useEffect(() => subscribeToOrderStatusChanged(loadPickups), []);

  useEffect(() => {
    setPage(1);
    setIsActionOpen(false);
    setActionError('');
    setRiderId('');
  }, [activeTab, searchQuery]);

  const filteredOrders = useMemo(() => {
    const tabStatuses = TAB_STATUSES[activeTab];
    const q = searchQuery.trim().toLowerCase();

    return orders
      .filter(order => tabStatuses.includes(order.status))
      .filter(order => {
        if (!q) return true;
        return (
          order.trackingId.toLowerCase().includes(q) ||
          order.senderName.toLowerCase().includes(q) ||
          order.senderPhone.toLowerCase().includes(q) ||
          (order.riderName || '').toLowerCase().includes(q) ||
          order.origin.toLowerCase().includes(q)
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

  useEffect(() => {
    if (!isActionOpen) return;

    setSelectedNextStatus(allowedStatusOptions[0] || '');
  }, [allowedStatusOptions, isActionOpen]);

  const isRiderAssignAction = selectedNextStatus === 'rider_assigned';

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
      setActionError('Select at least one pickup order first.');
      return;
    }

    setActionError(allowedStatusOptions.length > 0 ? '' : 'No valid status transition is available for the selected order status.');
    setSelectedNextStatus(allowedStatusOptions[0] || '');
  };

  const applyStatusChange = async () => {
    setActionError('');

    if (selectedOrders.length === 0) {
      setActionError('Select at least one pickup order first.');
      return;
    }

    if (!selectedNextStatus || !allowedStatusOptions.includes(selectedNextStatus)) {
      setActionError('Selected status is not allowed for the current order status.');
      return;
    }

    if (isRiderAssignAction && !riderId) {
      setActionError('Select a rider to assign this pickup.');
      return;
    }

    setStatusUpdating(true);
    try {
      if (!usingMockData) {
        await Promise.all(
          selectedOrders.map(order => updateOrderStatus(
            order.id,
            selectedNextStatus,
            undefined,
            undefined,
            isRiderAssignAction ? riderId : undefined,
          )),
        );
        await loadPickups();
      } else {
        setOrders(prev => prev.map(order => (
          selectedIds.has(order.id) ? { ...order, status: selectedNextStatus } : order
        )));
        notifyOrderStatusChanged();
      }

      setSelectedIdsByTab(prev => ({ ...prev, [activeTab]: new Set() }));
      setIsActionOpen(false);
      setSelectedNextStatus('');
      setRiderId('');
    } catch (err: any) {
      setActionError(err.response?.data?.message || 'Failed to change pickup status.');
    } finally {
      setStatusUpdating(false);
    }
  };

  const moveSelectedStatus = (direction: 1 | -1) => {
    if (allowedStatusOptions.length === 0) return;

    const currentIndex = allowedStatusOptions.findIndex(status => status === selectedNextStatus);
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (safeIndex + direction + allowedStatusOptions.length) % allowedStatusOptions.length;
    setSelectedNextStatus(allowedStatusOptions[nextIndex]);
  };

  const handleStatusPopoverKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyStatusChange();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSelectedStatus(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelectedStatus(-1);
      return;
    }

    if (event.key === 'Tab' && allowedStatusOptions.length > 1) {
      const activeElement = document.activeElement;
      const shouldCycleStatus =
        activeElement instanceof HTMLElement &&
        activeElement.classList.contains('pickup-status-option');

      if (shouldCycleStatus) {
        event.preventDefault();
        moveSelectedStatus(event.shiftKey ? -1 : 1);
      }
    }
  };

  const pickupColumns = [
    {
      header: 'SN',
      accessor: (order: Order) => ((page - 1) * PAGE_SIZE) + visibleOrders.findIndex(row => row.id === order.id) + 1,
      width: '34px',
      className: 'pickup-sn-cell',
    },
    {
      header: 'ORDER TYPE',
      accessor: (order: Order) => (
        <span className={`pickup-order-type ${getOrderTypeTone(order)}`}>
          {order.orderType === 'return' ? <Truck size={18} /> : <PackageCheck size={18} />}
        </span>
      ),
      width: '100px',
    },
    {
      header: 'SERVICE TYPE',
      accessor: (order: Order) => order.serviceType.toUpperCase(),
      width: '168px',
      className: 'pickup-strong-cell',
    },
    {
      header: 'SENDER',
      accessor: (order: Order) => (
        <div className="pickup-sender-cell">
          <span>{order.senderName}</span>
          <small>{order.senderPhone}</small>
        </div>
      ),
      width: '246px',
    },
    {
      header: 'ADDRESS',
      accessor: (order: Order) => order.origin || '-',
      width: '165px',
      className: 'pickup-strong-cell pickup-capitalize-cell',
    },
    {
      header: 'PIECES',
      accessor: (order: Order) => order.pieces,
      width: '80px',
      className: 'pickup-strong-cell',
    },
    {
      header: 'PICKUP RIDER',
      accessor: (order: Order) => order.riderName || '-',
      width: '155px',
      className: 'pickup-strong-cell',
    },
    {
      header: 'ACTION',
      accessor: () => (
        <Button variant="primary" className="pickup-details-btn">
          view details
        </Button>
      ),
      width: '156px',
    },
  ];

  return (
    <div className="pickup-operations-container">
      <PageHeader title="Pickup Operations" subtitle="Manage and track your pickup orders across the hub network." />

      <SegmentedTabs
        ariaLabel="Pickup operation filters"
        value={activeTab}
        onChange={setActiveTab}
        options={(Object.keys(TAB_LABELS) as PickupTab[]).map(tab => ({ value: tab, label: TAB_LABELS[tab] }))}
      />

      <div className="pickup-toolbar">
        <div />
        <div className="pickup-toolbar-actions">
          <div className="pickup-action-anchor">
            <Button variant="secondary" className="pickup-outline-btn" onClick={openStatusAction}>
              Action{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </Button>
            {isActionOpen && (
              <div className="pickup-status-popover" onKeyDown={handleStatusPopoverKeyDown}>
                <div className="pickup-status-popover-header">
                  <button type="button" onClick={() => setIsActionOpen(false)} aria-label="Close status action">
                    &times;
                  </button>
                </div>
                <div className="pickup-status-current">
                  <span>Next status</span>
                  <div className="pickup-status-options">
                    {allowedStatusOptions.length === 0 ? (
                      <p className="pickup-status-empty">No valid transitions</p>
                    ) : allowedStatusOptions.map(status => (
                      status === 'rider_assigned' ? (
                        <div
                          key={status}
                          className={`pickup-status-option-rider ${selectedNextStatus === status ? 'selected' : ''}`}
                        >
                          <SearchableSelect
                            options={riders.map(r => ({ id: r.id, label: r.name }))}
                            value={riderId}
                            onChange={id => {
                              setRiderId(id);
                              setSelectedNextStatus('rider_assigned');
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
                          className={`pickup-status-option ${selectedNextStatus === status ? 'selected' : ''}`}
                          onClick={() => setSelectedNextStatus(status)}
                          disabled={statusUpdating}
                          tabIndex={selectedNextStatus === status ? 0 : -1}
                        >
                          {STATUS_LABELS[status]}
                        </button>
                      )
                    ))}
                  </div>
                </div>
                {actionError && <p className="pickup-action-error">{actionError}</p>}
                <div className="pickup-status-submit-row">
                  <Button variant="secondary" className="pickup-outline-btn" onClick={() => { setIsActionOpen(false); setRiderId(''); }}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="pickup-apply-btn"
                    onClick={applyStatusChange}
                    disabled={statusUpdating || !selectedNextStatus || (isRiderAssignAction && !riderId)}
                  >
                    {statusUpdating ? 'Applying...' : 'Submit'}
                  </Button>
                </div>
              </div>
            )}
          </div>
          <Button variant="secondary" className="pickup-outline-btn">
            <Download size={14} /> Download
          </Button>
          <Button variant="secondary" className="pickup-outline-btn" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </Button>
        </div>
      </div>

      <label className="pickup-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={event => setSearchQuery(event.target.value)}
          placeholder="Search tracking id"
        />
      </label>

      <Table
        columns={pickupColumns}
        data={visibleOrders}
        selectedIds={selectedIds}
        onToggleRow={toggleRowSelection}
        allSelected={allVisibleSelected}
        someSelected={someVisibleSelected}
        onToggleAll={toggleVisibleSelection}
        loading={loading}
        loadingMessage="Loading pickup orders..."
        emptyMessage="No pickup orders found."
        minWidth="1122px"
        tableClassName="pickup-table"
      />

      <Pagination
        ariaLabel="Pickup pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  );
};

export default PickupOperations;
