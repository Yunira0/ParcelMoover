import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Copy,
  Download,
  Edit,
  MoreVertical,
  Plus,
  Printer,
  Search,
  X,
} from 'lucide-react';
import Table from '../components/Table';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import SegmentedTabs from '../components/SegmentedTabs';
import Pagination from '../components/Pagination';
import StatusChip, { type StatusChipTone } from '../components/StatusChip';
import FilterDropdown from '../components/FilterDropdown';
import QuickRemarkPopup from '../components/QuickRemarkPopup';
import {
  getOrders,
  subscribeToOrderStatusChanged,
  type CreateOrderInput,
  type Order,
  type ParcelStatus,
} from '../services/orders.service';
import { printLabels } from '../utils/printLabels';
import './OrderManagement.css';

const STATUS_LABELS: Record<ParcelStatus, string> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Picked Up',
  arrived: 'Arrived',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'In Transit',
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

type FilterTab =
  | 'all'
  | 'pickup_order'
  | 'ready_to_pick'
  | 'inprogress'
  | 'delivered'
  | 'failed'
  | 'rtv'
  | 'cancelled';

const TAB_GROUPS: Record<FilterTab, ParcelStatus[]> = {
  all: [],
  pickup_order: ['pickup_ordered'],
  ready_to_pick: ['rider_assigned'],
  inprogress: ['picked_up', 'arrived', 'ready_to_deliver', 'sent_for_delivery', 'oov', 'dispatched', 'arrived_at_branch', 'hold'],
  delivered: ['delivered'],
  failed: ['failed_pickup', 'failed_delivery', 'loss_and_damage'],
  rtv: ['failed_delivery', 'cancelled'],
  cancelled: ['cancelled'],
};

const TAB_LABELS: Record<FilterTab, string> = {
  all: 'All',
  pickup_order: 'Pickup order',
  ready_to_pick: 'Ready to pick',
  inprogress: 'Inprogress',
  delivered: 'Delivered',
  failed: 'Failed',
  rtv: 'RTV',
  cancelled: 'Cancelled',
};

const MOCK_ORDERS: Order[] = [
  {
    id: '1',
    trackingId: 'TRK-8821932',
    status: 'delivered',
    orderType: 'delivery',
    serviceType: 'dtd',
    senderName: 'Abishek Thapa',
    senderPhone: '+977 9841******',
    receiverName: 'Abishek Thapa',
    receiverPhone: '+977 9841******',
    origin: 'KTHMANDU',
    destination: 'Pokhara Hub',
    pieces: 1,
    weightKg: 1,
    codAmount: 1500,
    deliveryCharge: 129,
    riderName: 'Sagar',
    remarks: 'Fragile',
    lastUpdatedBy: 'Name',
    lastUpdatedAt: 'date',
    createdAt: '2026-06-15',
  },
  {
    id: '2',
    trackingId: 'TRK-8821932',
    status: 'arrived',
    orderType: 'delivery',
    serviceType: 'btd',
    senderName: 'Abishek Thapa',
    senderPhone: '+977 9841******',
    receiverName: 'Abishek Thapa',
    receiverPhone: '+977 9841******',
    origin: 'Lalitpur',
    destination: 'Butwal',
    pieces: 1,
    weightKg: 1,
    codAmount: 1200,
    deliveryCharge: 129,
    riderName: 'Ram',
    remarks: 'None',
    lastUpdatedBy: 'Name',
    lastUpdatedAt: 'date',
    createdAt: '2026-06-16',
  },
  {
    id: '3',
    trackingId: 'TRK-8821932',
    status: 'sent_for_delivery',
    orderType: 'delivery',
    serviceType: 'btb',
    senderName: 'Abishek Thapa',
    senderPhone: '+977 9841******',
    receiverName: 'Abishek Thapa',
    receiverPhone: '+977 9841******',
    origin: 'Pokhara Hub',
    destination: 'Pokhara Hub',
    pieces: 1,
    weightKg: 1,
    codAmount: 0,
    deliveryCharge: 129,
    riderName: 'sameer',
    remarks: 'Handle with care',
    lastUpdatedBy: 'Name',
    lastUpdatedAt: 'date',
    createdAt: '2026-06-17',
  },
];

const PAGE_SIZE = 10;

const uniqueValues = (values: string[]) =>
  Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));

const maskPhone = (phone: string) => {
  if (!phone) return '';
  if (phone.includes('*')) return phone;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return phone;
  return `+977 ${digits.slice(-10, -6)}******`;
};

const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const getStatusTone = (status: ParcelStatus): StatusChipTone => {
  if (status === 'delivered') return 'success';
  if (['arrived', 'arrived_at_branch', 'rider_assigned'].includes(status)) return 'info';
  if (['failed_pickup', 'failed_delivery', 'loss_and_damage'].includes(status)) return 'danger';
  if (status === 'cancelled') return 'neutral';
  return 'warning';
};

const orderToCreateInput = (order: Order): CreateOrderInput => ({
  sender: {
    name: order.senderName,
    phone: order.senderPhone,
    address: order.origin,
  },
  receiver: {
    name: order.receiverName,
    phone: order.receiverPhone,
    address: order.destination,
  },
  orderType: order.orderType,
  serviceType: order.serviceType,
  pieces: order.pieces,
  weightKg: order.weightKg,
  codAmount: order.codAmount,
  deliveryCharge: order.deliveryCharge,
  pickupAddress: order.origin,
});

const OrderManagement: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>('all');
  const [trackingSearch, setTrackingSearch] = useState(() => searchParams.get('search') || '');
  const [originHub, setOriginHub] = useState('');
  const [riderName, setRiderName] = useState('');
  const [route, setRoute] = useState('');
  const [destinationHub, setDestinationHub] = useState('');
  const [currentStatus, setCurrentStatus] = useState('');
  const [orderType, setOrderType] = useState('');
  const [dateRange, setDateRange] = useState('');
  const [vendor, setVendor] = useState('');
  const [operationDept, setOperationDept] = useState('');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [remarkPopupOrder, setRemarkPopupOrder] = useState<Order | null>(null);
  const [printWorking, setPrintWorking] = useState(false);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const res = await getOrders();
      if (res?.success && Array.isArray(res.data)) {
        setOrders(res.data);
      } else if (Array.isArray(res)) {
        setOrders(res);
      } else {
        setOrders(MOCK_ORDERS);
      }
    } catch {
      setOrders(MOCK_ORDERS);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadOrders(); }, []);
  useEffect(() => subscribeToOrderStatusChanged(loadOrders), []);
  useEffect(() => { setPage(1); }, [filter, trackingSearch, originHub, riderName, route, destinationHub, currentStatus, orderType, dateRange, vendor, operationDept]);
  // Re-sync when the navbar search re-navigates here with a new ?search= param.
  useEffect(() => {
    const fromUrl = searchParams.get('search');
    if (fromUrl !== null) setTrackingSearch(fromUrl);
  }, [searchParams]);

  const filterOptions = useMemo(() => {
    const routes = orders.map(order => `${order.origin} -> ${order.destination}`);
    return {
      origins: uniqueValues(orders.map(order => order.origin)),
      riders: uniqueValues(orders.map(order => order.riderName || '')),
      routes: uniqueValues(routes),
      destinations: uniqueValues(orders.map(order => order.destination)),
      vendors: uniqueValues(orders.map(order => order.vendorName || order.senderName)),
    };
  }, [orders]);

  const filteredOrders = useMemo(() => orders.filter(order => {
    const tabStatuses = TAB_GROUPS[filter];
    const q = trackingSearch.toLowerCase();
    const orderRoute = `${order.origin} -> ${order.destination}`;
    const created = new Date(order.createdAt);
    const now = new Date();
    const daysOld = Number.isNaN(created.getTime())
      ? Number.POSITIVE_INFINITY
      : Math.floor((now.getTime() - created.getTime()) / 86_400_000);

    const matchesTab = filter === 'all' || tabStatuses.includes(order.status);
    const terms = q ? q.split(',').map(t => t.trim()).filter(Boolean) : [];
    const matchesSearch = terms.length === 0 || (
      terms.length > 1
        ? terms.some(t => order.trackingId.toLowerCase() === t)
        : (
            order.trackingId.toLowerCase().includes(terms[0]!) ||
            order.senderName.toLowerCase().includes(terms[0]!) ||
            order.senderPhone.toLowerCase().includes(terms[0]!) ||
            order.receiverName.toLowerCase().includes(terms[0]!) ||
            order.receiverPhone.toLowerCase().includes(terms[0]!)
          )
    );
    const matchesDate =
      !dateRange ||
      (dateRange === 'today' && daysOld === 0) ||
      (dateRange === '7' && daysOld <= 7) ||
      (dateRange === '30' && daysOld <= 30);
    const matchesOperation =
      !operationDept ||
      (operationDept === 'pickup' && ['pickup_ordered', 'rider_assigned', 'picked_up'].includes(order.status)) ||
      (operationDept === 'delivery' && ['ready_to_deliver', 'sent_for_delivery', 'delivered', 'failed_delivery'].includes(order.status)) ||
      (operationDept === 'returns' && order.orderType === 'return');

    return matchesTab &&
      matchesSearch &&
      (!originHub || order.origin === originHub) &&
      (!riderName || order.riderName === riderName) &&
      (!route || orderRoute === route) &&
      (!destinationHub || order.destination === destinationHub) &&
      (!currentStatus || order.status === currentStatus) &&
      (!orderType || order.orderType === orderType) &&
      matchesDate &&
      (!vendor || (order.vendorName || order.senderName) === vendor) &&
      matchesOperation;
  }), [orders, filter, trackingSearch, originHub, riderName, route, destinationHub, currentStatus, orderType, dateRange, vendor, operationDept]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const visibleOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const visibleOrderIds = visibleOrders.map(order => order.id);
  const selectedOrders = orders.filter(order => selectedIds.has(order.id));
  const selectedExportOrders = selectedOrders.length > 0 ? selectedOrders : filteredOrders;
  const allVisibleSelected = visibleOrderIds.length > 0 && visibleOrderIds.every(id => selectedIds.has(id));
  const someVisibleSelected = visibleOrderIds.some(id => selectedIds.has(id));
  const firstResult = filteredOrders.length === 0 ? 0 : ((page - 1) * PAGE_SIZE) + 1;
  const lastResult = Math.min(page * PAGE_SIZE, filteredOrders.length);

  const handlePrintLabels = useCallback(async () => {
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
  }, [selectedIds, orders, visibleOrders]);

  const clearFilters = () => {
    setOriginHub('');
    setRiderName('');
    setRoute('');
    setDestinationHub('');
    setCurrentStatus('');
    setOrderType('');
    setDateRange('');
    setVendor('');
    setOperationDept('');
  };

  const openCreateModal = () => {
    navigate('/orders/create');
  };

  const openPrefilledModal = (order: Order, mode: 'copy' | 'edit') => {
    setOpenActionId(null);
    navigate('/orders/create', { state: { initialData: orderToCreateInput(order), mode } });
  };

  const toggleRowSelection = (orderId: string) => {
    setSelectedIds(prev => {
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
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleOrderIds.forEach(id => next.delete(id));
      } else {
        visibleOrderIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const downloadCsv = () => {
    const headers = ['Tracking ID', 'Origin', 'Sender', 'Receiver', 'Destination', 'COD', 'Delivery Charge', 'Weight', 'Status', 'Rider', 'Remarks', 'Last Updated By', 'Last Updated At'];
    const rows = selectedExportOrders.map(order => [
      order.trackingId,
      order.origin,
      order.senderName,
      order.receiverName,
      order.destination,
      order.codAmount,
      order.deliveryCharge,
      order.weightKg || '',
      STATUS_LABELS[order.status],
      order.riderName || '',
      order.remarks || '',
      order.lastUpdatedBy || '',
      order.lastUpdatedAt || '',
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'orders.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const orderColumns = [
    {
      header: 'TRACKING ID',
      accessor: (order: Order) => (
        <Link to={`/orders/track/${order.trackingId}`} className="tracking-id-link">{order.trackingId}</Link>
      ),
      width: '180px',
      className: 'tracking-cell',
    },
    { header: 'ORIGIN', accessor: (order: Order) => order.origin || '-', width: '150px' },
    {
      header: 'SENDOR',
      accessor: (order: Order) => (
        <div className="party-cell">
          <span>{order.senderName}</span>
          <small>{maskPhone(order.senderPhone)}</small>
        </div>
      ),
      width: '210px',
    },
    {
      header: 'RECEIVER',
      accessor: (order: Order) => (
        <div className="party-cell">
          <span>{order.receiverName}</span>
          <small>{maskPhone(order.receiverPhone)}</small>
        </div>
      ),
      width: '210px',
    },
    { header: 'DESTINATION', accessor: (order: Order) => order.destination || '-', width: '150px' },
    {
      header: 'FINANCE',
      accessor: (order: Order) => (
        <div className="finance-cell">
          <span>COD: {formatMoney(order.codAmount)}</span>
          <span>D. Charge: {formatMoney(order.deliveryCharge)}</span>
        </div>
      ),
      width: '160px',
    },
    { header: 'WEIGHT', accessor: (order: Order) => (order.weightKg ? `${order.weightKg} Kg` : '-'), width: '120px' },
    {
      header: 'STATUS',
      accessor: (order: Order) => (
        <StatusChip tone={getStatusTone(order.status)}>
          {STATUS_LABELS[order.status]}
        </StatusChip>
      ),
      width: '120px',
    },
    { header: 'RIDER', accessor: (order: Order) => order.riderName || '-', width: '120px' },
    { header: 'REMARKS', accessor: (order: Order) => (
      <button
        type="button"
        className="remarks-cell-btn"
        onClick={() => setRemarkPopupOrder(order)}
        title={order.remarks || 'Add remark'}
      >
        {order.remarks || '-'}
      </button>
    ), width: '160px', className: 'remarks-cell' },
    {
      header: 'LAST UPDATED BY',
      accessor: (order: Order) => (
        <div className="updated-cell">
          <span>{order.lastUpdatedBy || 'Name'}</span>
          <span>{order.lastUpdatedAt || 'date'}</span>
        </div>
      ),
      width: '160px',
    },
    {
      header: 'ACTION',
      accessor: (order: Order) => (
        <div className="actions-cell">
          <Button
            variant="ghost"
            size="icon"
            className="row-action-btn"
            onClick={() => setOpenActionId(value => value === order.id ? null : order.id)}
            aria-label={`Open actions for ${order.trackingId}`}
            aria-expanded={openActionId === order.id}
          >
            <MoreVertical size={16} />
          </Button>
          {openActionId === order.id && (
            <div className="row-action-menu">
              <button type="button" onClick={() => openPrefilledModal(order, 'edit')}>
                <Edit size={14} /> Edit
              </button>
              <button type="button" onClick={() => openPrefilledModal(order, 'copy')}>
                <Copy size={14} /> Copy Order
              </button>
            </div>
          )}
        </div>
      ),
      width: '124px',
      className: 'actions-column',
    },
  ];

  return (
    <div className="order-management-container">
      <PageHeader title="Orders" subtitle="Manage and track package orders across the network." />

      <SegmentedTabs
        ariaLabel="Order status filters"
        value={filter}
        onChange={setFilter}
        options={(Object.keys(TAB_GROUPS) as FilterTab[]).map(tab => ({ value: tab, label: TAB_LABELS[tab] }))}
      />

      <div className="order-filter-panel">
        <FilterDropdown
          label="ORIGIN HUB"
          value={originHub}
          onChange={setOriginHub}
          placeholder="Select Hub"
          options={filterOptions.origins.map(value => ({ value, label: value }))}
        />
        <FilterDropdown
          label="RIDER NAME"
          value={riderName}
          onChange={setRiderName}
          placeholder="Type name....."
          options={filterOptions.riders.map(value => ({ value, label: value }))}
        />
        <FilterDropdown
          label="ROUTE"
          value={route}
          onChange={setRoute}
          placeholder="Select Route"
          options={filterOptions.routes.map(value => ({ value, label: value }))}
        />
        <FilterDropdown
          label="DESTINATION HUB"
          value={destinationHub}
          onChange={setDestinationHub}
          placeholder="Select Hub"
          options={filterOptions.destinations.map(value => ({ value, label: value }))}
        />
        <FilterDropdown
          label="CURRENT STATUS"
          value={currentStatus}
          onChange={setCurrentStatus}
          placeholder="Select status"
          options={(Object.keys(STATUS_LABELS) as ParcelStatus[]).map(value => ({ value, label: STATUS_LABELS[value] }))}
        />
        <FilterDropdown
          label="ORDER TYPE"
          value={orderType}
          onChange={setOrderType}
          placeholder="Standard"
          options={[
            { value: 'delivery', label: 'Delivery' },
            { value: 'exchange', label: 'Exchange' },
            { value: 'return', label: 'Return' },
          ]}
        />
        <FilterDropdown
          label="DATE RANGE"
          value={dateRange}
          onChange={setDateRange}
          placeholder="17/05/2026"
          options={[
            { value: 'today', label: 'Today' },
            { value: '7', label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
          ]}
        />
        <FilterDropdown
          label="VENDOR"
          value={vendor}
          onChange={setVendor}
          placeholder="All Vendors"
          options={filterOptions.vendors.map(value => ({ value, label: value }))}
        />
        <FilterDropdown
          label="OPERATION DEPT"
          value={operationDept}
          onChange={setOperationDept}
          placeholder="All Departments"
          options={[
            { value: 'pickup', label: 'Pickup' },
            { value: 'delivery', label: 'Delivery' },
            { value: 'returns', label: 'Returns' },
          ]}
        />
        <Button variant="outline" className="clear-filter-btn" onClick={clearFilters}>
          Clear Filters
        </Button>
      </div>

      <div className="order-toolbar">
        <div className="order-toolbar-left">
          <Button variant="primary" onClick={openCreateModal}>
            New Order <Plus size={16} />
          </Button>
          <Button variant="secondary">Bulk Order</Button>
        </div>
        <div className="order-toolbar-right">
          <Button variant="primary" onClick={downloadCsv}>
            <Download size={14} /> Download
          </Button>
          <Button variant="primary" onClick={handlePrintLabels} disabled={printWorking}>
            <Printer size={14} />
            {printWorking
              ? 'Preparing…'
              : selectedIds.size > 0
                ? `Print ${selectedIds.size} Label${selectedIds.size !== 1 ? 's' : ''}`
                : `Print ${visibleOrders.length} Label${visibleOrders.length !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>

      <label className="tracking-search">
        <Search size={16} />
        <input
          value={trackingSearch}
          onChange={event => setTrackingSearch(event.target.value)}
          placeholder="TRK001 or TRK001, TRK002, TRK003"
        />
        {trackingSearch && (
          <button type="button" onClick={() => setTrackingSearch('')} aria-label="Clear search">
            <X size={14} />
          </button>
        )}
      </label>

      <Table
        columns={orderColumns}
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
        minWidth="2075px"
        tableClassName="orders-table"
      />

      <Pagination
        ariaLabel="Orders pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        summary={`showing  ${firstResult} of ${lastResult} of ${filteredOrders.length} results`}
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

export default OrderManagement;
