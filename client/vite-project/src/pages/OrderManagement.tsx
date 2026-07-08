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
import { toBsDate } from '../utils/nepaliDate';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import {
  getOrders,
  subscribeToOrderStatusChanged,
  ORDER_SORT_FIELDS,
  type CreateOrderInput,
  type Order,
  type OrdersPageMeta,
  type OrderSortField,
  type ParcelStatus,
} from '../services/orders.service';
import { printLabels } from '../utils/printLabels';
import { useCursorPagination } from '../hooks/useCursorPagination';
import './OrderManagement.css';

const STATUS_LABELS: Record<ParcelStatus, string> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Picked Up',
  arrived: 'Arrived',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'In Transit',
  oov: 'Transit',
  dispatched: 'Dispatched',
  arrived_at_branch: 'Arrived',
  hold: 'On Hold',
  loss_and_damage: 'Loss & Damage',
  delivered: 'Delivered',
  failed_pickup: 'Failed Pickup',
  failed_delivery: 'Failed Delivery',
  cancelled: 'Cancelled',
  follow_up: 'Follow Up',
  ready_to_return: 'Ready to Return',
  sent_to_vendor: 'Sent to Vendor',
  returned_to_vendor: 'Returned to Vendor',
};

type FilterTab =
  | 'all'
  | 'ready_to_pick'
  | 'inprogress'
  | 'delivered'
  | 'failed'
  | 'return_process'
  | 'rtv'
  | 'cancelled';

const TAB_GROUPS: Record<FilterTab, ParcelStatus[]> = {
  all: [],
  // Everything still waiting to be picked up: ordered + rider assigned.
  ready_to_pick: ['pickup_ordered', 'rider_assigned'],
  inprogress: ['picked_up', 'arrived', 'ready_to_deliver', 'sent_for_delivery', 'oov', 'dispatched', 'arrived_at_branch', 'hold'],
  delivered: ['delivered'],
  failed: ['failed_pickup', 'failed_delivery', 'loss_and_damage'],
  // Returns still being worked: not yet handed back to the vendor.
  return_process: ['follow_up', 'ready_to_return', 'sent_to_vendor'],
  rtv: ['failed_delivery', 'follow_up', 'ready_to_return', 'sent_to_vendor', 'returned_to_vendor'],
  cancelled: ['cancelled'],
};

const TAB_LABELS: Record<FilterTab, string> = {
  all: 'All',
  ready_to_pick: 'Ready to pick',
  inprogress: 'Inprogress',
  delivered: 'Delivered',
  failed: 'Failed',
  return_process: 'Return process',
  rtv: 'RTV',
  cancelled: 'Cancelled',
};

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

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
  if (status === 'returned_to_vendor') return 'success';
  if (status === 'cancelled') return 'neutral';
  return 'warning';
};

interface SecondaryFilters {
  originHub: string;
  riderName: string;
  route: string;
  destinationHub: string;
  currentStatus: string;
  orderType: string;
  /** Inclusive AD dates (YYYY-MM-DD) compared against order.createdAt. */
  dateFrom: string;
  dateTo: string;
  vendor: string;
  operationDept: string;
}

// Filters the backend doesn't have a query param for (origin/rider/route/
// destination/date range/vendor/department) - applied client-side on top of
// whatever page the server already returned for the active tab + search.
const matchesSecondaryFilters = (order: Order, filters: SecondaryFilters) => {
  const orderRoute = `${order.origin} -> ${order.destination}`;
  // createdAt is a Nepal-local "YYYY-MM-DD" string, so an inclusive range
  // check is a plain lexicographic comparison - no timezone math needed.
  const matchesDateSpan =
    (!filters.dateFrom || order.createdAt >= filters.dateFrom) &&
    (!filters.dateTo || order.createdAt <= filters.dateTo);
  const matchesOperation =
    !filters.operationDept ||
    (filters.operationDept === 'pickup' && ['pickup_ordered', 'rider_assigned', 'picked_up'].includes(order.status)) ||
    (filters.operationDept === 'delivery' && ['ready_to_deliver', 'sent_for_delivery', 'delivered', 'failed_delivery'].includes(order.status)) ||
    (filters.operationDept === 'returns' && order.orderType === 'return');

  return (!filters.originHub || order.origin === filters.originHub) &&
    (!filters.riderName || order.riderName === filters.riderName) &&
    (!filters.route || orderRoute === filters.route) &&
    (!filters.destinationHub || order.destination === filters.destinationHub) &&
    (!filters.currentStatus || order.status === filters.currentStatus) &&
    (!filters.orderType || order.orderType === filters.orderType) &&
    matchesDateSpan &&
    (!filters.vendor || (order.vendorName || order.senderName) === filters.vendor) &&
    matchesOperation;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<OrdersPageMeta | null>(null);
  const [optionsOrders, setOptionsOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [filter, setFilter] = useState<FilterTab>(() => {
    const fromUrl = searchParams.get('tab');
    return fromUrl && fromUrl in TAB_GROUPS ? (fromUrl as FilterTab) : 'all';
  });
  const [trackingSearch, setTrackingSearch] = useState(() => searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(trackingSearch);
  const [originHub, setOriginHub] = useState(() => searchParams.get('originHub') || '');
  const [riderName, setRiderName] = useState(() => searchParams.get('riderName') || '');
  const [route, setRoute] = useState(() => searchParams.get('route') || '');
  const [destinationHub, setDestinationHub] = useState(() => searchParams.get('destinationHub') || '');
  const [currentStatus, setCurrentStatus] = useState(() => searchParams.get('currentStatus') || '');
  const [orderType, setOrderType] = useState(() => searchParams.get('orderType') || '');
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('dateFrom') || '');
  const [dateTo, setDateTo] = useState(() => searchParams.get('dateTo') || '');
  const [vendor, setVendor] = useState(() => searchParams.get('vendor') || '');
  const [operationDept, setOperationDept] = useState(() => searchParams.get('operationDept') || '');
  const pager = useCursorPagination();
  const [sortBy, setSortBy] = useState<OrderSortField | undefined>(() => {
    const fromUrl = searchParams.get('sortBy');
    return fromUrl && (ORDER_SORT_FIELDS as readonly string[]).includes(fromUrl) ? (fromUrl as OrderSortField) : undefined;
  });
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => (searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc'));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [remarkPopupOrder, setRemarkPopupOrder] = useState<Order | null>(null);
  const [printWorking, setPrintWorking] = useState(false);

  const toggleSort = (field: OrderSortField) => {
    if (sortBy !== field) {
      setSortBy(field);
      setSortDir('desc');
    } else if (sortDir === 'desc') {
      setSortDir('asc');
    } else {
      // Third click clears the sort, back to the default (newest first).
      setSortBy(undefined);
      setSortDir('desc');
    }
  };

  const secondaryFilters: SecondaryFilters = {
    originHub, riderName, route, destinationHub, currentStatus, orderType, dateFrom, dateTo, vendor, operationDept,
  };
  const hasSecondaryFilters = Object.values(secondaryFilters).some(Boolean);

  // Debounce search input so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(trackingSearch.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [trackingSearch]);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getOrders({
        status: TAB_GROUPS[filter],
        search: debouncedSearch || undefined,
        pageSize: PAGE_SIZE,
        cursor: pager.request.cursor,
        dir: pager.request.dir,
        sortBy,
        sortDir,
      });
      if (res?.success && Array.isArray(res.data)) {
        setOrders(res.data);
        setMeta(res.meta ?? null);
        setLoadError('');
      }
    } catch {
      setLoadError('Failed to load orders. Showing the last loaded data, if any.');
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedSearch, pager.request, sortBy, sortDir]);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => subscribeToOrderStatusChanged(loadOrders), [loadOrders]);
  useEffect(() => { pager.reset(); }, [filter, debouncedSearch, originHub, riderName, route, destinationHub, currentStatus, orderType, dateFrom, dateTo, vendor, operationDept, sortBy, sortDir, pager.reset]);
  // Re-sync when the navbar search re-navigates here with a new ?search= param.
  useEffect(() => {
    const fromUrl = searchParams.get('search');
    if (fromUrl !== null) setTrackingSearch(fromUrl);
  }, [searchParams]);

  // Keep every filter bookmarkable/shareable - mirror them into the URL
  // (replacing history, not pushing, so the back button doesn't step through
  // every keystroke/dropdown change).
  useEffect(() => {
    const next = new URLSearchParams();
    if (filter !== 'all') next.set('tab', filter);
    if (trackingSearch) next.set('search', trackingSearch);
    if (originHub) next.set('originHub', originHub);
    if (riderName) next.set('riderName', riderName);
    if (route) next.set('route', route);
    if (destinationHub) next.set('destinationHub', destinationHub);
    if (currentStatus) next.set('currentStatus', currentStatus);
    if (orderType) next.set('orderType', orderType);
    if (dateFrom) next.set('dateFrom', dateFrom);
    if (dateTo) next.set('dateTo', dateTo);
    if (vendor) next.set('vendor', vendor);
    if (operationDept) next.set('operationDept', operationDept);
    if (sortBy) next.set('sortBy', sortBy);
    if (sortDir !== 'desc') next.set('sortDir', sortDir);
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, trackingSearch, originHub, riderName, route, destinationHub, currentStatus, orderType, dateFrom, dateTo, vendor, operationDept, sortBy, sortDir]);

  // A separate, tab-scoped (unsearched, unpaginated) fetch purely to keep the
  // filter dropdown option lists representative - the paginated `orders` above
  // is usually only 10 rows, too few to populate origin/rider/route/etc options from.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getOrders({ status: TAB_GROUPS[filter] });
        if (!cancelled && res?.success && Array.isArray(res.data)) {
          setOptionsOrders(res.data);
        }
      } catch {
        // dropdown options just won't refresh; not fatal
      }
    })();
    return () => { cancelled = true; };
  }, [filter]);

  const filterOptions = useMemo(() => {
    const routes = optionsOrders.map(order => `${order.origin} -> ${order.destination}`);
    return {
      origins: uniqueValues(optionsOrders.map(order => order.origin)),
      riders: uniqueValues(optionsOrders.map(order => order.riderName || '')),
      routes: uniqueValues(routes),
      destinations: uniqueValues(optionsOrders.map(order => order.destination)),
      vendors: uniqueValues(optionsOrders.map(order => order.vendorName || order.senderName)),
    };
  }, [optionsOrders]);

  // Status/search are already applied server-side; only the filters the
  // backend has no query param for are applied here, on top of the current page.
  const filteredOrders = useMemo(
    () => orders.filter(order => matchesSecondaryFilters(order, secondaryFilters)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, originHub, riderName, route, destinationHub, currentStatus, orderType, dateFrom, dateTo, vendor, operationDept],
  );

  const totalPages = meta?.totalPages ?? 1;
  const visibleOrders = filteredOrders;
  const visibleOrderIds = visibleOrders.map(order => order.id);
  const selectedOrders = orders.filter(order => selectedIds.has(order.id));
  const selectedExportOrders = selectedOrders.length > 0 ? selectedOrders : visibleOrders;
  const allVisibleSelected = visibleOrderIds.length > 0 && visibleOrderIds.every(id => selectedIds.has(id));
  const someVisibleSelected = visibleOrderIds.some(id => selectedIds.has(id));

  // Selection is scoped to a single loaded page - clear it on page/tab change
  // so a bulk action never silently drops ids that scrolled out of view.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter, pager.request]);

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
    setDateFrom('');
    setDateTo('');
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

  const downloadCsv = async () => {
    let exportOrders = selectedExportOrders;
    // No explicit selection: export the full tab+search-scoped set (not just
    // the currently loaded page), then narrow by the same client-side filters.
    if (selectedOrders.length === 0) {
      try {
        const res = await getOrders({ status: TAB_GROUPS[filter], search: debouncedSearch || undefined });
        if (res?.success && Array.isArray(res.data)) {
          exportOrders = res.data.filter(order => matchesSecondaryFilters(order, secondaryFilters));
        }
      } catch {
        // fall back to the currently loaded page
      }
    }

    const headers = ['#', 'Tracking ID', 'Origin', 'Sender', 'Receiver', 'Destination', 'COD', 'Delivery Charge', 'Weight', 'Status', 'Rider', 'Remarks', 'Last Updated By', 'Last Updated At'];
    const rows = exportOrders.map(order => [
      `#${order.orderNumber}`,
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
      toBsDate(order.lastUpdatedAt) || '',
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

  const sortableHeader = (label: string, field: OrderSortField) => (
    <button type="button" className="sortable-column-header" onClick={() => toggleSort(field)}>
      {label}
      {sortBy === field
        ? (sortDir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />)
        : <ArrowUpDown size={12} className="sortable-column-header-idle" />}
    </button>
  );

  const orderColumns = [
    {
      header: '#',
      accessor: (order: Order) => `#${order.orderNumber}`,
      width: '70px',
    },
    {
      header: sortableHeader('TRACKING ID', 'trackingId'),
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
      header: sortableHeader('FINANCE', 'codAmount'),
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
      header: sortableHeader('STATUS', 'status'),
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
          <span>{toBsDate(order.lastUpdatedAt) || 'date'}</span>
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

      {loadError && <p className="order-load-error">{loadError}</p>}

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
        <label aria-label="Created from date">
          <span>FROM DATE</span>
          <input
            type="date"
            className="order-date-input"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={e => setDateFrom(e.target.value)}
          />
        </label>
        <label aria-label="Created to date">
          <span>TO DATE</span>
          <input
            type="date"
            className="order-date-input"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={e => setDateTo(e.target.value)}
          />
        </label>
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

      {hasSecondaryFilters && (
        <p className="order-filter-scope-note">
          Origin/rider/route/destination/status/date/vendor/department filters only narrow the current page — use the tabs or tracking search to find matches across the whole list.
        </p>
      )}

      <div className="order-toolbar">
        <div className="order-toolbar-left">
          <Button variant="primary" onClick={openCreateModal}>
            New Order <Plus size={16} />
          </Button>
          <Button variant="secondary" onClick={() => navigate('/orders/bulk-create')}>Bulk Order</Button>
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
        page={pager.page}
        totalPages={totalPages}
        cursor={pager.controls(meta)}
        summary={meta
          ? hasSecondaryFilters
            ? `${visibleOrders.length} of ${orders.length} on this page match your filters — ${meta.total} total in "${TAB_LABELS[filter]}"`
            : `${meta.total} order${meta.total === 1 ? '' : 's'}`
          : undefined}
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
