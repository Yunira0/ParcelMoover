import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronDown,
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
import MultiFilterDropdown from '../components/MultiFilterDropdown';
import QuickRemarkPopup from '../components/QuickRemarkPopup';
import { toBsDate, toBsDateTime } from '../utils/nepaliDate';
import { downloadExcel } from '../utils/excel';
import NepaliDatePicker from '../components/NepaliDatePicker';
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
import { getCurrentUserRoles } from '../utils/auth';
import { commitScannedTerm, handleScannerPaste } from '../utils/scannerInput';
import { useCursorPagination } from '../hooks/useCursorPagination';
import './OrderManagement.css';

const STATUS_LABELS: Record<ParcelStatus, string> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Picked Up',
  arrived: 'Arrived at Origin',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'In Transit',
  oov: 'Transit',
  dispatched: 'In Transit',
  arrived_at_branch: 'Arrived at Destination',
  hold: 'On Hold',
  loss_and_damage: 'Loss & Damage',
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
  inprogress: ['picked_up', 'arrived', 'ready_to_deliver', 'sent_for_delivery', 'oov', 'dispatched', 'arrived_at_branch', 'hold', 'failed_delivery'],
  delivered: ['delivered', 'partially_delivered'],
  failed: ['failed_pickup', 'failed_delivery', 'loss_and_damage'],
  // Returns still being worked: not yet handed back to the vendor.
  return_process: ['follow_up', 'ready_to_return', 'sent_to_vendor'],
  rtv: ['follow_up', 'ready_to_return', 'sent_to_vendor', 'returned_to_vendor'],
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

const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const getStatusTone = (status: ParcelStatus): StatusChipTone => {
  if (status === 'delivered') return 'success';
  if (status === 'partially_delivered') return 'warning';
  if (['arrived', 'arrived_at_branch', 'rider_assigned'].includes(status)) return 'info';
  if (['failed_pickup', 'failed_delivery', 'loss_and_damage'].includes(status)) return 'danger';
  if (status === 'returned_to_vendor') return 'success';
  if (status === 'cancelled') return 'neutral';
  return 'warning';
};

interface SecondaryFilters {
  originHub: string;
  riderName: string;
  /** Free-text: matches a party name or any number (phone/tracking/order #). */
  keyword: string;
  destinationHub: string;
  /** Multi-select: an order matches if its status is any of these (empty = all). */
  currentStatus: string[];
  orderType: string;
  /** Which date the From/To range is compared against. */
  dateField: 'createdAt' | 'lastUpdatedAt';
  /** Inclusive AD dates (YYYY-MM-DD) compared against the selected dateField. */
  dateFrom: string;
  dateTo: string;
  /** Multi-select: an order matches if its vendor is any of these (empty = all). */
  vendor: string[];
  operationDept: string;
}

// Case-insensitive substring match of the keyword against the order's names
// and numbers, so "ram" finds a sender/receiver and "98" or "TRK" finds a phone,
// tracking id, or order number.
const matchesKeyword = (order: Order, keyword: string) => {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    order.senderName,
    order.receiverName,
    order.riderName,
    order.senderPhone,
    order.receiverPhone,
    order.trackingId,
    `#${order.orderNumber}`,
    String(order.orderNumber),
  ];
  return haystack.some(field => (field || '').toLowerCase().includes(needle));
};

// Filters the backend doesn't have a query param for (origin/rider/keyword/
// destination/date range/vendor/department) - applied client-side on top of
// whatever page the server already returned for the active tab + search.
// Nepal-local (UTC+5:45) AD date "YYYY-MM-DD" for an ISO timestamp - so the
// status-updated date lines up with the same local-day bucketing createdAt uses.
const toNepalDate = (iso?: string): string => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t + (5 * 60 + 45) * 60 * 1000).toISOString().slice(0, 10);
};

const matchesSecondaryFilters = (order: Order, filters: SecondaryFilters) => {
  // createdAt is already a Nepal-local "YYYY-MM-DD" string; lastUpdatedAt is a
  // raw ISO timestamp, so normalise it to the same local date. Either way the
  // inclusive range check is a plain lexicographic comparison.
  const compareDate = filters.dateField === 'lastUpdatedAt'
    ? toNepalDate(order.lastUpdatedAt)
    : order.createdAt;
  const matchesDateSpan =
    (!filters.dateFrom || (!!compareDate && compareDate >= filters.dateFrom)) &&
    (!filters.dateTo || (!!compareDate && compareDate <= filters.dateTo));
  const matchesOperation =
    !filters.operationDept ||
    (filters.operationDept === 'pickup' && ['pickup_ordered', 'rider_assigned', 'picked_up'].includes(order.status)) ||
    (filters.operationDept === 'delivery' && ['ready_to_deliver', 'sent_for_delivery', 'delivered', 'partially_delivered', 'failed_delivery'].includes(order.status)) ||
    (filters.operationDept === 'returns' && order.orderType === 'return');

  return (!filters.originHub || order.origin === filters.originHub) &&
    (!filters.riderName || order.riderName === filters.riderName) &&
    matchesKeyword(order, filters.keyword) &&
    (!filters.destinationHub || order.destination === filters.destinationHub) &&
    (filters.currentStatus.length === 0 || filters.currentStatus.includes(order.status)) &&
    (!filters.orderType || order.orderType === filters.orderType) &&
    matchesDateSpan &&
    (filters.vendor.length === 0 || filters.vendor.includes(order.vendorName || order.senderName)) &&
    matchesOperation;
};

const orderToCreateInput = (order: Order): CreateOrderInput => ({
  vendorId: order.vendorId || undefined,
  sender: {
    name: order.senderName,
    phone: order.senderPhone,
    address: order.origin,
  },
  receiver: {
    name: order.receiverName,
    phone: order.receiverPhone,
    alternatePhone: order.receiverAlternatePhone || undefined,
    address: order.receiverAddress || order.destination,
  },
  originLocationId: order.originLocationId || undefined,
  destinationLocationId: order.destinationLocationId || undefined,
  orderType: order.orderType,
  serviceType: order.serviceType,
  pieces: order.pieces,
  weightKg: order.weightKg,
  codAmount: order.codAmount,
  deliveryCharge: order.deliveryCharge,
  packageType: order.packageType || undefined,
  deliveryInstruction: order.deliveryInstruction || undefined,
  pickupAddress: order.origin,
});

const OrderManagement: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // One-shot success notice from the edit flow's redirect.
  const [notice, setNotice] = useState<string>(() => (location.state as { notice?: string } | null)?.notice || '');
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
  // Tracking ids confirmed by pressing Enter (typically a barcode scanner) -
  // kept separate from the live input buffer so rapid scans never race each
  // other (see utils/scannerInput.ts). Rendered as chips beside the input.
  const [scannedIds, setScannedIds] = useState<string[]>([]);
  const combinedSearch = useMemo(
    () => [...scannedIds, trackingSearch.trim()].filter(Boolean).join(', '),
    [scannedIds, trackingSearch],
  );
  const [debouncedSearch, setDebouncedSearch] = useState(combinedSearch);
  // Distinguishes a genuine external search navigation (TopNav search, back/
  // forward, a pasted URL) from the URL just echoing our own sync below -
  // without this, every scan's URL sync would immediately re-hydrate and dump
  // all prior scans back into the single edit buffer.
  const lastSyncedSearchRef = useRef<string | null>(null);
  const [originHub, setOriginHub] = useState(() => searchParams.get('originHub') || '');
  const [riderName, setRiderName] = useState(() => searchParams.get('riderName') || '');
  const [keyword, setKeyword] = useState(() => searchParams.get('keyword') || '');
  const [destinationHub, setDestinationHub] = useState(() => searchParams.get('destinationHub') || '');
  const [currentStatus, setCurrentStatus] = useState<string[]>(() => searchParams.getAll('currentStatus'));
  const [orderType, setOrderType] = useState(() => searchParams.get('orderType') || '');
  const [dateField, setDateField] = useState<'createdAt' | 'lastUpdatedAt'>(
    () => (searchParams.get('dateField') === 'lastUpdatedAt' ? 'lastUpdatedAt' : 'createdAt'),
  );
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('dateFrom') || '');
  const [dateTo, setDateTo] = useState(() => searchParams.get('dateTo') || '');
  const [vendor, setVendor] = useState<string[]>(() => searchParams.getAll('vendor'));
  const [operationDept, setOperationDept] = useState(() => searchParams.get('operationDept') || '');
  const pager = useCursorPagination();
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [sortBy, setSortBy] = useState<OrderSortField | undefined>(() => {
    const fromUrl = searchParams.get('sortBy');
    return fromUrl && (ORDER_SORT_FIELDS as readonly string[]).includes(fromUrl) ? (fromUrl as OrderSortField) : undefined;
  });
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(() => (searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc'));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openActionId, setOpenActionId] = useState<string | null>(null);
  const [remarkPopupOrder, setRemarkPopupOrder] = useState<Order | null>(null);
  const [printWorking, setPrintWorking] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(
    () => localStorage.getItem('order-filters-collapsed') === 'true',
  );

  const toggleFiltersCollapsed = () => {
    setFiltersCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('order-filters-collapsed', String(next));
      return next;
    });
  };

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
    originHub, riderName, keyword, destinationHub, currentStatus, orderType, dateField, dateFrom, dateTo, vendor, operationDept,
  };
  // Arrays are truthy even when empty, so check length for the multi-select filters.
  // dateField is a mode toggle (not itself a filter), so it never counts as active.
  const activeFilterCount = Object.entries(secondaryFilters).filter(([key, v]) =>
    key !== 'dateField' && (Array.isArray(v) ? v.length > 0 : Boolean(v)),
  ).length;
  const hasSecondaryFilters = activeFilterCount > 0;

  useEffect(() => {
    if (!notice) return;
    // Clear the router state so refresh/back doesn't resurrect the notice.
    window.history.replaceState({}, '');
    const handle = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(handle);
  }, [notice]);

  // Debounce search input so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(combinedSearch), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [combinedSearch]);

  // Scanning several parcels in a row fires one debounced search per scan -
  // without this, a slower-to-resolve earlier request can land after a later
  // one and stomp its results, making an already-scanned parcel vanish again.
  const loadRequestIdRef = useRef(0);

  const loadOrders = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    try {
      // A scanner builds up a comma-separated list of tracking ids - fetch
      // enough rows in one page to fit the whole scanned batch, instead of
      // silently cutting it off at the default page size.
      const scannedTermCount = debouncedSearch ? debouncedSearch.split(',').map(t => t.trim()).filter(Boolean).length : 0;
      const pageSize = scannedTermCount > 1 ? Math.min(100, Math.max(pageSizeChoice, scannedTermCount)) : pageSizeChoice;

      // The status set actually sent to the server. A `currentStatus` selection
      // is pushed down to the query (not just filtered client-side over one
      // page) so pagination stays correct and card drill-downs can target
      // statuses that span tabs (e.g. Pending deliveries includes
      // failed_delivery). Within a concrete tab it's intersected with that
      // tab's group; on "all" it's used directly.
      const effectiveStatus: ParcelStatus[] = currentStatus.length
        ? (TAB_GROUPS[filter].length
            ? TAB_GROUPS[filter].filter((s) => currentStatus.includes(s))
            : (currentStatus as ParcelStatus[]))
        : TAB_GROUPS[filter];
      const res = await getOrders({
        status: effectiveStatus,
        search: debouncedSearch || undefined,
        pageSize,
        cursor: pager.request.cursor,
        dir: pager.request.dir,
        sortBy,
        sortDir,
      });
      if (requestId !== loadRequestIdRef.current) return;
      if (res?.success && Array.isArray(res.data)) {
        setOrders(res.data);
        setMeta(res.meta ?? null);
        setLoadError('');
      }
    } catch {
      if (requestId !== loadRequestIdRef.current) return;
      setLoadError('Failed to load orders. Showing the last loaded data, if any.');
    } finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }, [filter, currentStatus, debouncedSearch, pager.request, sortBy, sortDir, pageSizeChoice]);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => subscribeToOrderStatusChanged(loadOrders), [loadOrders]);
  useEffect(() => { pager.reset(); }, [filter, debouncedSearch, originHub, riderName, keyword, destinationHub, currentStatus, orderType, dateField, dateFrom, dateTo, vendor, operationDept, sortBy, sortDir, pager.reset]);
  // Re-sync when the navbar search re-navigates here with a new ?search= param -
  // but not when the URL change is just our own sync below echoing back.
  useEffect(() => {
    const fromUrl = searchParams.get('search');
    if (fromUrl === null || fromUrl === lastSyncedSearchRef.current) return;
    setScannedIds([]);
    setTrackingSearch(fromUrl);
  }, [searchParams]);

  // Keep every filter bookmarkable/shareable - mirror them into the URL
  // (replacing history, not pushing, so the back button doesn't step through
  // every keystroke/dropdown change).
  useEffect(() => {
    const next = new URLSearchParams();
    if (filter !== 'all') next.set('tab', filter);
    if (combinedSearch) next.set('search', combinedSearch);
    if (originHub) next.set('originHub', originHub);
    if (riderName) next.set('riderName', riderName);
    if (keyword) next.set('keyword', keyword);
    if (destinationHub) next.set('destinationHub', destinationHub);
    currentStatus.forEach(value => next.append('currentStatus', value));
    if (orderType) next.set('orderType', orderType);
    if (dateField !== 'createdAt') next.set('dateField', dateField);
    if (dateFrom) next.set('dateFrom', dateFrom);
    if (dateTo) next.set('dateTo', dateTo);
    vendor.forEach(value => next.append('vendor', value));
    if (operationDept) next.set('operationDept', operationDept);
    if (sortBy) next.set('sortBy', sortBy);
    if (sortDir !== 'desc') next.set('sortDir', sortDir);
    lastSyncedSearchRef.current = combinedSearch;
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, combinedSearch, originHub, riderName, keyword, destinationHub, currentStatus, orderType, dateField, dateFrom, dateTo, vendor, operationDept, sortBy, sortDir]);

  // A separate, tab-scoped (unsearched, unpaginated) fetch purely to keep the
  // filter dropdown option lists representative - the paginated `orders` above
  // is usually only 10 rows, too few to populate origin/rider/etc options from.
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
    return {
      origins: uniqueValues(optionsOrders.map(order => order.origin)),
      riders: uniqueValues(optionsOrders.map(order => order.riderName || '')),
      destinations: uniqueValues(optionsOrders.map(order => order.destination)),
      vendors: uniqueValues(optionsOrders.map(order => order.vendorName || order.senderName)),
    };
  }, [optionsOrders]);

  // Status/search are already applied server-side; only the filters the
  // backend has no query param for are applied here, on top of the current page.
  const filteredOrders = useMemo(
    () => orders.filter(order => matchesSecondaryFilters(order, secondaryFilters)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, originHub, riderName, keyword, destinationHub, currentStatus, orderType, dateField, dateFrom, dateTo, vendor, operationDept],
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
    setKeyword('');
    setDestinationHub('');
    setCurrentStatus([]);
    setOrderType('');
    setDateField('createdAt');
    setDateFrom('');
    setDateTo('');
    setVendor([]);
    setOperationDept('');
  };

  // Who may create a single order - mirrors the /orders/create route's allowed
  // roles (the server scopes a sales actor to the vendors they own).
  const canCreateSingleOrder = getCurrentUserRoles().some((r) =>
    ['super_admin', 'admin', 'sales', 'vendor', 'vendor_staff'].includes(r),
  );

  const openCreateModal = () => {
    navigate('/orders/create');
  };

  const openPrefilledModal = (order: Order, mode: 'copy' | 'edit') => {
    setOpenActionId(null);
    navigate('/orders/create', {
      state: {
        initialData: orderToCreateInput(order),
        mode,
        // The create page needs the real parcel id (and tracking id for the
        // header) to PATCH instead of POST when mode is 'edit'.
        orderId: mode === 'edit' ? order.id : undefined,
        trackingId: mode === 'edit' ? order.trackingId : undefined,
      },
    });
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

  const downloadExcelExport = async () => {
    let exportOrders = selectedExportOrders;
    // The "arrived at origin" date is only fetched for exports (withArrival), so
    // pull the tab+search-scoped set fresh with that flag on.
    try {
      const res = await getOrders({ status: TAB_GROUPS[filter], search: debouncedSearch || undefined, withArrival: true });
      if (res?.success && Array.isArray(res.data)) {
        if (selectedOrders.length === 0) {
          // No explicit selection: export the full scoped set, narrowed by the
          // same client-side filters as the table.
          exportOrders = res.data.filter(order => matchesSecondaryFilters(order, secondaryFilters));
        } else {
          // Keep the exact selection, but enrich each row with its arrival date.
          const arrivalById = new Map(res.data.map(order => [order.id, order.arrivedAtOrigin]));
          exportOrders = selectedExportOrders.map(order => ({
            ...order,
            arrivedAtOrigin: arrivalById.get(order.id) ?? order.arrivedAtOrigin,
          }));
        }
      }
    } catch {
      // fall back to the currently loaded page / selection
    }

    const headers = ['#', 'Tracking ID', 'Origin', 'Sender', 'Receiver', 'Receiver Phone', 'Receiver Address', 'Destination', 'COD', 'Delivery Charge', 'Weight', 'Status', 'Rider', 'Remarks', 'Order Created Date', 'Arrived at Origin Date', 'Delivered At', 'Last Updated By', 'Last Updated At'];
    const rows = exportOrders.map(order => [
      `#${order.orderNumber}`,
      order.trackingId,
      order.origin,
      order.senderName,
      order.receiverName,
      order.receiverPhone || '',
      order.receiverAddress || '',
      order.destination,
      order.codAmount,
      order.deliveryCharge,
      order.weightKg || '',
      STATUS_LABELS[order.status],
      order.riderName || '',
      order.remarks || '',
      toBsDate(order.createdAt) || '',
      toBsDate(order.arrivedAtOrigin) || '',
      toBsDate(order.deliveredAt) || '',
      order.lastUpdatedBy || '',
      toBsDate(order.lastUpdatedAt) || '',
    ]);
    downloadExcel('orders.xlsx', 'Orders', headers, rows);
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
      header: 'ORDER ID',
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
      header: 'SENDER',
      accessor: (order: Order) => (
        <div className="party-cell">
          <span>{order.senderName}</span>
          <small>{order.senderPhone}</small>
        </div>
      ),
      width: '210px',
    },
    {
      header: 'RECEIVER',
      accessor: (order: Order) => (
        <div className="party-cell">
          <span>{order.receiverName}</span>
          <small>{order.receiverPhone}</small>
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
        {order.remarks || 'Add remark'}
      </button>
    ), width: '160px', className: 'remarks-cell' },
    {
      header: 'LAST UPDATED BY',
      accessor: (order: Order) => (
        <div className="updated-cell">
          <span>{order.lastUpdatedBy || 'Name'}</span>
          <span>{toBsDateTime(order.lastUpdatedAt) || 'date'}</span>
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
      {notice && <p className="order-update-notice">{notice}</p>}

      <section className="order-filter-panel">
        <button
          type="button"
          className="order-filter-toggle"
          onClick={toggleFiltersCollapsed}
          aria-expanded={!filtersCollapsed}
          aria-controls="order-filter-fields"
        >
          <span className="order-filter-toggle-label">Filters</span>
          {activeFilterCount > 0 && (
            <span className="order-filter-count">{activeFilterCount} active</span>
          )}
          <ChevronDown size={16} className="order-filter-chevron" aria-hidden="true" />
        </button>
        {!filtersCollapsed && (
          <div id="order-filter-fields" className="order-filter-fields">
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
            <label aria-label="Keyword filter">
              <span>KEYWORD</span>
              <input
                type="text"
                className="order-keyword-input"
                value={keyword}
                onChange={e => setKeyword(e.target.value)}
                placeholder="Name or number"
              />
            </label>
            <FilterDropdown
              label="DESTINATION HUB"
              value={destinationHub}
              onChange={setDestinationHub}
              placeholder="Select Hub"
              options={filterOptions.destinations.map(value => ({ value, label: value }))}
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
              label="DATE TYPE"
              value={dateField}
              onChange={(v) => setDateField(v === 'lastUpdatedAt' ? 'lastUpdatedAt' : 'createdAt')}
              placeholder="Order Created Date"
              options={[
                { value: 'createdAt', label: 'Order Created Date' },
                { value: 'lastUpdatedAt', label: 'Status Updated Date' },
              ]}
            />
            <label aria-label="From date">
              <span>FROM DATE</span>
              <NepaliDatePicker
                value={dateFrom}
                max={dateTo || undefined}
                onChange={setDateFrom}
                aria-label="From date"
              />
            </label>
            <label aria-label="To date">
              <span>TO DATE</span>
              <NepaliDatePicker
                value={dateTo}
                min={dateFrom || undefined}
                onChange={setDateTo}
                aria-label="To date"
              />
            </label>
            <MultiFilterDropdown
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
            <MultiFilterDropdown
              label="CURRENT STATUS"
              className="order-filter-span-2"
              value={currentStatus}
              onChange={setCurrentStatus}
              placeholder="Select status"
              options={(Object.keys(STATUS_LABELS) as ParcelStatus[]).map(value => ({ value, label: STATUS_LABELS[value] }))}
            />
            <Button variant="outline" className="clear-filter-btn" onClick={clearFilters}>
              Clear Filters
            </Button>
          </div>
        )}
      </section>

      <div className="order-toolbar">
        <div className="order-toolbar-left">
          {canCreateSingleOrder && (
            <Button variant="primary" onClick={openCreateModal}>
              New Order <Plus size={16} />
            </Button>
          )}
          <Button variant="secondary" onClick={() => navigate('/orders/bulk-create')}>Bulk Order</Button>
        </div>
        <div className="order-toolbar-right">
          <Button variant="primary" onClick={downloadExcelExport}>
            <Download size={14} /> Download
          </Button>
          <Button variant="primary" onClick={handlePrintLabels} disabled={printWorking}>
            <Printer size={14} />
            {printWorking
              ? 'Preparing…'
              : selectedIds.size > 0
                ? `Print ${selectedIds.size} Selected`
                : `Print All (${visibleOrders.length})`}
          </Button>
        </div>
      </div>

      <div className="tracking-search-wrap">
        <label className="tracking-search">
          <Search size={16} />
          <input
            value={trackingSearch}
            onChange={event => setTrackingSearch(event.target.value)}
            onKeyDown={event => commitScannedTerm(event, setScannedIds, setTrackingSearch)}
            onPaste={event => handleScannerPaste(event, setScannedIds, setTrackingSearch)}
            placeholder="TRK001 or TRK001, TRK002, TRK003"
          />
          {(trackingSearch || scannedIds.length > 0) && (
            <button type="button" onClick={() => { setTrackingSearch(''); setScannedIds([]); }} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </label>
        {scannedIds.length > 0 && (
          <div className="scan-chip-list">
            {scannedIds.map(id => (
              <span key={id} className="scan-chip">
                {id}
                <button
                  type="button"
                  onClick={() => setScannedIds(prev => prev.filter(x => x !== id))}
                  aria-label={`Remove ${id}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <Table
        columns={orderColumns}
        data={visibleOrders}
        selectedIds={selectedIds}
        onToggleRow={(id) => toggleRowSelection(String(id))}
        allSelected={allVisibleSelected}
        someSelected={someVisibleSelected}
        onToggleAll={toggleVisibleSelection}
        getRowClassName={(order) => selectedIds.has(order.id) ? 'selected-row' : ''}
        // Only blank the table for the very first load - re-searching (e.g.
        // one debounced request per scanned parcel) would otherwise flash the
        // whole table to "Loading..." and back on every single scan.
        loading={loading && orders.length === 0}
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
        pageSize={pageSizeChoice}
        pageSizeLabel="parcels"
        onPageSizeChange={(size) => {
          setPageSizeChoice(size);
          pager.reset();
        }}
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
