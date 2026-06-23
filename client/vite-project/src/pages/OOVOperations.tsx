import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
  Search,
} from 'lucide-react';
import Table from '../components/Table';
import {
  getOrders,
  notifyOrderStatusChanged,
  subscribeToOrderStatusChanged,
  updateOrderStatus,
  type Order,
  type ParcelStatus,
} from '../services/orders.service';
import './OOVOperations.css';

type OOVTab = 'oov' | 'dispatch_manifest' | 'dispatched' | 'arrived_at_branch';

const PAGE_SIZE = 10;

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

const createEmptyTabSelections = (): Record<OOVTab, Set<string | number>> => ({
  oov: new Set(),
  dispatch_manifest: new Set(),
  dispatched: new Set(),
  arrived_at_branch: new Set(),
});

const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const OOVOperations: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<OOVTab>('oov');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [usingMockData, setUsingMockData] = useState(false);
  const [selectedIdsByTab, setSelectedIdsByTab] = useState<Record<OOVTab, Set<string | number>>>(createEmptyTabSelections);
  const [isActionOpen, setIsActionOpen] = useState(false);
  const [selectedNextStatus, setSelectedNextStatus] = useState<ParcelStatus | ''>('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [actionError, setActionError] = useState('');

  const loadOovOrders = async () => {
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
        setOrders(MOCK_OOV_ORDERS);
        setUsingMockData(true);
      }
    } catch {
      setOrders(MOCK_OOV_ORDERS);
      setUsingMockData(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOovOrders();
  }, []);

  useEffect(() => subscribeToOrderStatusChanged(loadOovOrders), []);

  useEffect(() => {
    setPage(1);
    setIsActionOpen(false);
    setActionError('');
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
          order.receiverName.toLowerCase().includes(q) ||
          order.destination.toLowerCase().includes(q)
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

    setStatusUpdating(true);
    try {
      if (!usingMockData) {
        await Promise.all(
          selectedOrders.map(order => updateOrderStatus(order.id, effectiveNextStatus)),
        );
        await loadOovOrders();
      } else {
        setOrders(prev => prev.map(order => (
          selectedIds.has(order.id) ? { ...order, status: effectiveNextStatus } : order
        )));
        notifyOrderStatusChanged();
      }

      setSelectedIdsByTab(prev => ({ ...prev, [activeTab]: new Set() }));
      setIsActionOpen(false);
      setSelectedNextStatus('');
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

  const downloadCsv = () => {
    const headers = ['Date', 'Tracking ID', 'Order Type', 'Sender', 'Receiver', 'Location', 'Weight', 'COD', 'Last Updated', 'Remarks'];
    const rows = filteredOrders.map(order => [
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
    const csv = [headers, ...rows]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
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
    { header: 'TRACKING ID', accessor: (order: Order) => order.trackingId, width: '124px', className: 'oov-tracking-cell' },
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
    { header: 'REMARKS', accessor: (order: Order) => order.remarks || '-', width: '84px', className: 'oov-remarks-cell' },
  ];

  return (
    <div className="oov-operations-container">
      <div className="oov-title-row">
        <div>
          <h1>Out of the valley (OOV)</h1>
          <p>Keep track of your dispatch orders across the entire hub network.</p>
        </div>
      </div>

      <div className="oov-tabs" role="tablist" aria-label="OOV operation filters">
        {(Object.keys(TAB_LABELS) as OOVTab[]).map(tab => (
          <button
            key={tab}
            type="button"
            className={`oov-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      <label className="oov-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={event => setSearchQuery(event.target.value)}
          placeholder="Search tracking id"
        />
      </label>

      <div className="oov-toolbar">
        <div />
        <div className="oov-toolbar-actions">
          <div className="oov-action-anchor">
            <button type="button" className="oov-outline-btn" onClick={openStatusAction}>
              Action{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </button>
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
                {actionError && <p className="oov-action-error">{actionError}</p>}
                <div className="oov-status-submit-row">
                  <button type="button" className="oov-outline-btn" onClick={() => setIsActionOpen(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="oov-apply-btn"
                    onClick={applyStatusChange}
                    disabled={statusUpdating || !effectiveNextStatus}
                  >
                    {statusUpdating ? 'Applying...' : 'Submit'}
                  </button>
                </div>
              </div>
            )}
          </div>
          <button type="button" className="oov-outline-btn" onClick={downloadCsv}>
            <Download size={14} /> Download
          </button>
          <button type="button" className="oov-outline-btn" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </button>
        </div>
      </div>

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

      <div className="oov-pagination-row">
        <span />
        <nav className="oov-pagination" aria-label="OOV pagination">
          <button type="button" disabled={page === 1} onClick={() => setPage(value => Math.max(1, value - 1))}>
            <ChevronLeft size={18} />
          </button>
          {Array.from({ length: Math.min(totalPages, 3) }, (_, index) => index + 1).map(pageNumber => (
            <button
              key={pageNumber}
              type="button"
              className={page === pageNumber ? 'active' : ''}
              onClick={() => setPage(pageNumber)}
            >
              {pageNumber}
            </button>
          ))}
          <button type="button" disabled={page === totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>
            <ChevronRight size={18} />
          </button>
        </nav>
      </div>
    </div>
  );
};

export default OOVOperations;
