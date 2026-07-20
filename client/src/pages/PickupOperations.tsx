import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Printer,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import Table from '../components/Table';
import SearchableSelect from '../components/SearchableSelect';
import Button from '../components/Button';
import QuickRemarkPopup from '../components/QuickRemarkPopup';
import SegmentedTabs from '../components/SegmentedTabs';
import PageHeader from '../components/PageHeader';
import TicketCategoryButton from '../components/TicketCategoryButton';
import Pagination from '../components/Pagination';
import {
  getOrders,
  subscribeToOrderStatusChanged,
  updateOrderStatus,
  type Order,
  type ParcelStatus,
} from '../services/orders.service';
import { getRiders } from '../services/users.service';
import { printLabels } from '../utils/printLabels';
import { toBsDate, toNptTime } from '../utils/nepaliDate';
import { formatCurrency } from '../utils/format';
import { commitScannedTerm, handleScannerPaste } from '../utils/scannerInput';
import './PickupOperations.css';

type PickupTab = 'pickup_ordered' | 'rider_assigned' | 'picked_up' | 'arrived' | 'failed' | 'cancelled';

// Groups (pickups) per page in the outer table.
const PAGE_SIZE = 10;
// The whole tab is fetched up front (server pages of 100) so vendor groups are
// complete - a pickup's Details panel must show every parcel in it, and piece
// counts must cover the full pickup, which parcel-level server paging broke.
const SERVER_FETCH_PAGE_SIZE = 100;
const MAX_FETCH_PAGES = 30; // safety cap: 3000 parcels per tab
const SEARCH_DEBOUNCE_MS = 300;

const TAB_LABELS: Record<PickupTab, string> = {
  pickup_ordered: 'Pickup order',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Pickup Completed',
  arrived: 'Arrived at Origin',
  failed: 'Failed Pickup',
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

// Fringe areas that sit just outside the valley boundary but are close enough
// to deliver directly from origin without a Transit (OOV) leg.
const DIRECT_DELIVERY_FRINGE_AREAS = ['kavresthali', 'thali', 'chapagaun', 'budhanilkantha', 'thankot'];

// From "Arrived at Origin", whether a parcel should skip Transit and go
// straight to Ready to Deliver (inside valley + fringe areas) or must go
// through Transit/OOV first (everywhere else).
const destinationSkipsTransit = (order: Order): boolean => {
  if (order.destinationValley === 'inside') return true;
  const name = (order.destinationName || '').toLowerCase();
  return DIRECT_DELIVERY_FRINGE_AREAS.some(area => name.includes(area));
};

// Small custom ostrich glyph (lucide has none). Stroke style matches the other
// icons so it sits well inside the coloured order-type box.
const OstrichIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M11.5 13.5c-1-1.3-1.6-2.6-1.4-4C10.3 7.8 9.2 6.5 8 6" />
    <circle cx="7" cy="5.2" r="1.2" fill="currentColor" stroke="none" />
    <path d="M5.9 5.1 4.4 4.7" />
    <ellipse cx="14" cy="13" rx="4.5" ry="3.8" />
    <path d="M12.5 16.5 11.6 21" />
    <path d="M15.6 16.6 16.6 21" />
    <path d="M11.6 21h-1.3M11.6 21l1 .9" />
    <path d="M16.6 21h1.3M16.6 21l-1 .9" />
  </svg>
);

// Colour the order-type box by order type: delivery = green, return = red,
// exchange = yellow.
const getOrderTypeTone = (order: Order) => {
  if (order.orderType === 'return') return 'danger';
  if (order.orderType === 'exchange') return 'warning';
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

const SERVICE_TYPE_FULL_LABELS: Record<Order['serviceType'], string> = {
  home_delivery: 'Home Delivery',
  branch_delivery: 'Branch Delivery',
};

const ORDER_TYPE_LABELS: Record<Order['orderType'], string> = {
  delivery: 'Delivery Order',
  exchange: 'Exchange Order',
  return: 'Return Order',
};

// A vendor often hands over several parcels for pickup in one trip - group
// them into a single row instead of listing every parcel separately. Orders
// with no vendor (legacy/no-vendor flows) fall back to sender identity so
// they still group sensibly rather than colliding into one bucket.
interface PickupGroup {
  id: string;
  sn: number;
  senderName: string;
  senderPhone: string;
  location: string;
  orderType: Order['orderType'];
  mixedOrderType: boolean;
  serviceType: Order['serviceType'];
  mixedServiceType: boolean;
  riderName: string;
  totalPieces: number;
  orders: Order[];
}

const groupOrdersByVendor = (orders: Order[]): PickupGroup[] => {
  const groups = new Map<string, Order[]>();
  for (const order of orders) {
    const key = order.vendorId || `sender:${order.senderName}|${order.senderPhone}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(order);
    else groups.set(key, [order]);
  }

  return Array.from(groups.entries()).map(([id, groupOrders], index) => {
    const first = groupOrders[0]!;
    const orderTypes = new Set(groupOrders.map(o => o.orderType));
    const serviceTypes = new Set(groupOrders.map(o => o.serviceType));
    const riders = new Set(groupOrders.map(o => o.riderName || ''));

    return {
      id,
      sn: index + 1,
      senderName: first.senderName,
      senderPhone: first.senderPhone,
      // Every order in a group shares one vendor (grouping key is vendorId),
      // so the vendor's own pickup Location - not the order's destination -
      // is what a rider actually needs to find the sender.
      location: first.vendorLocation || first.origin || '-',
      orderType: first.orderType,
      mixedOrderType: orderTypes.size > 1,
      serviceType: first.serviceType,
      mixedServiceType: serviceTypes.size > 1,
      riderName: riders.size === 1 ? first.riderName || '' : 'Mixed',
      totalPieces: groupOrders.reduce((sum, o) => sum + o.pieces, 0),
      orders: groupOrders,
    };
  });
};

const DateTimeCell: React.FC<{ iso: string }> = ({ iso }) => (
  <div className="pickup-datetime">
    <span>{toBsDate(iso)}</span>
    <small>{toNptTime(iso, true)}</small>
  </div>
);

const groupDetailColumns = (group: PickupGroup, onRemarkClick: (order: Order) => void) => [
  {
    header: 'SN',
    accessor: (order: Order) => `${group.sn}.${group.orders.indexOf(order) + 1}`,
    width: '60px',
  },
  {
    header: 'ORDER ID',
    accessor: (order: Order) => `#${order.orderNumber}`,
    width: '70px',
  },
  {
    header: 'DATE & TIME',
    accessor: (order: Order) => <DateTimeCell iso={order.createdAtRaw} />,
    width: '110px',
  },
  {
    header: 'SENDER DETAILS',
    accessor: (order: Order) => (
      <div className="pickup-group-cell">
        <span>{order.senderName}</span>
        <small>{order.senderPhone}</small>
      </div>
    ),
    width: '170px',
  },
  {
    header: 'RECEIVER DETAILS',
    accessor: (order: Order) => (
      <div className="pickup-group-cell">
        <span>{order.receiverName}</span>
        {order.receiverAddress && <small>{order.receiverAddress}</small>}
        <small>{order.receiverPhone}</small>
      </div>
    ),
    width: '200px',
  },
  { header: 'PICKUP RIDER', accessor: (order: Order) => order.riderName || '-', width: '120px' },
  {
    header: 'TRACKING CODE',
    accessor: (order: Order) => (
      <Link to={`/orders/track/${order.trackingId}`} className="tracking-id-link">{order.trackingId}</Link>
    ),
    width: '170px',
    className: 'pickup-group-tracking-cell',
  },
  { header: 'WEIGHT (KG)', accessor: (order: Order) => order.weightKg ?? '-', width: '100px' },
  {
    header: 'HUB/LOCATION',
    accessor: (order: Order) => (
      <div className="pickup-group-cell">
        <span>{order.origin || '-'}</span>
        <small>{order.destination || '-'}</small>
      </div>
    ),
    width: '170px',
  },
  { header: 'DELIVERY CHARGE', accessor: (order: Order) => formatCurrency(order.deliveryCharge, 0), width: '130px' },
  { header: 'COD AMOUNT', accessor: (order: Order) => formatCurrency(order.codAmount, 0), width: '120px' },
  { header: 'LAST HANDLE BY', accessor: (order: Order) => order.lastUpdatedBy || '-', width: '140px' },
  { header: 'ORDER TYPE', accessor: (order: Order) => ORDER_TYPE_LABELS[order.orderType], width: '130px' },
  {
    header: 'REMARKS',
    accessor: (order: Order) => (
      <button
        type="button"
        className="pickup-remarks-cell-btn"
        onClick={() => onRemarkClick(order)}
        title={order.remarks || 'Add remark'}
      >
        {order.remarks || '-'}
      </button>
    ),
    width: '160px',
    className: 'pickup-remarks-cell',
  },
];

// Rendered inline as the expanded row of the outer Table (via renderExpandedRow) -
// a drill-down panel within the same table, not a separate one. Row checkboxes
// here toggle the exact same order-scoped selection the outer group checkbox
// and bulk "Action" bar use, so a specific order can be picked out of a
// multi-order pickup instead of only ever selecting the whole group.
const PickupGroupDetailPanel: React.FC<{
  group: PickupGroup;
  selectedIds: Set<string | number>;
  onToggleOrder: (orderId: string | number) => void;
  onToggleAll: () => void;
  onRemarkClick: (order: Order) => void;
}> = ({ group, selectedIds, onToggleOrder, onToggleAll, onRemarkClick }) => {
  const columns = useMemo(() => groupDetailColumns(group, onRemarkClick), [group, onRemarkClick]);
  const allSelected = group.orders.every(order => selectedIds.has(order.id));
  const someSelected = group.orders.some(order => selectedIds.has(order.id));

  return (
    <Table
      columns={columns}
      data={group.orders}
      selectedIds={selectedIds}
      onToggleRow={onToggleOrder}
      allSelected={allSelected}
      someSelected={someSelected}
      onToggleAll={onToggleAll}
      minWidth="1650px"
      tableClassName="pickup-group-table"
      emptyMessage="No orders in this pickup."
    />
  );
};

// Cancelling or failing an order requires a reason remark.
const REASON_REQUIRED_STATUSES: ParcelStatus[] = ['cancelled', 'failed_pickup', 'failed_delivery'];

const PickupOperations: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [capped, setCapped] = useState(false);
  const [activeTab, setActiveTab] = useState<PickupTab>(() => {
    const fromUrl = searchParams.get('tab');
    return fromUrl && fromUrl in TAB_LABELS ? (fromUrl as PickupTab) : 'pickup_ordered';
  });
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  // Tracking ids confirmed by pressing Enter (typically a barcode scanner) -
  // kept separate from the live input buffer so rapid scans never race each
  // other (see utils/scannerInput.ts). Rendered as chips beside the input.
  const [scannedIds, setScannedIds] = useState<string[]>([]);
  const combinedSearch = useMemo(
    () => [...scannedIds, searchQuery.trim()].filter(Boolean).join(', '),
    [scannedIds, searchQuery],
  );
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('search') || '');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedIdsByTab, setSelectedIdsByTab] = useState<Record<PickupTab, Set<string | number>>>(createEmptyTabSelections);
  const [isActionOpen, setIsActionOpen] = useState(false);
  const [selectedNextStatus, setSelectedNextStatus] = useState<ParcelStatus | ''>('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [actionError, setActionError] = useState('');
  const [riders, setRiders] = useState<{ id: string; name: string }[]>([]);
  const [riderId, setRiderId] = useState('');
  const [reasonRemarks, setReasonRemarks] = useState('');
  const [expandedGroupId, setExpandedGroupId] = useState('');
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
    const handle = setTimeout(() => setDebouncedSearch(combinedSearch), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [combinedSearch]);

  // Guards against a slow multi-page fetch landing after the user has already
  // switched tab or typed a new search - only the latest request may setState.
  const fetchSeqRef = useRef(0);

  const loadPickups = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    setLoading(true);
    try {
      const all: Order[] = [];
      let cursor: string | undefined;
      let hasMore = false;
      for (let i = 0; i < MAX_FETCH_PAGES; i++) {
        const res = await getOrders({
          status: TAB_STATUSES[activeTab],
          search: debouncedSearch || undefined,
          pageSize: SERVER_FETCH_PAGE_SIZE,
          cursor,
          dir: 'next',
        });
        if (seq !== fetchSeqRef.current) return;
        if (!res?.success || !Array.isArray(res.data)) {
          throw new Error('Unexpected orders response');
        }
        all.push(...res.data);
        hasMore = !!res.meta?.hasNextPage && !!res.meta?.nextCursor;
        if (!hasMore) break;
        cursor = res.meta!.nextCursor!;
      }
      setOrders(all);
      setCapped(hasMore);
      setLoadError('');
    } catch {
      if (seq !== fetchSeqRef.current) return;
      setLoadError('Failed to load pickup orders. Showing the last loaded data, if any.');
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false);
    }
  }, [activeTab, debouncedSearch]);

  useEffect(() => { loadPickups(); }, [loadPickups]);
  useEffect(() => subscribeToOrderStatusChanged(loadPickups), [loadPickups]);

  useEffect(() => {
    setPage(1);
    setExpandedGroupId('');
    setIsActionOpen(false);
    setActionError('');
    setRiderId('');
  }, [activeTab, debouncedSearch]);

  // Keep tab/search bookmarkable - mirror into the URL (replacing history,
  // not pushing, so the back button doesn't step through every keystroke).
  useEffect(() => {
    const next = new URLSearchParams();
    if (activeTab !== 'pickup_ordered') next.set('tab', activeTab);
    if (debouncedSearch) next.set('search', debouncedSearch);
    setSearchParams(next, { replace: true });
  }, [activeTab, debouncedSearch, setSearchParams]);

  // Every order of the tab stays loaded while flipping through group pages, so
  // selection can safely span pages - only a tab/search change resets it.
  useEffect(() => {
    setSelectedIdsByTab(prev => ({ ...prev, [activeTab]: new Set() }));
  }, [activeTab, debouncedSearch]);

  const visibleOrders = orders;
  const selectedIds = selectedIdsByTab[activeTab];
  const groups = useMemo(() => groupOrdersByVendor(visibleOrders), [visibleOrders]);
  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  // Clamp instead of resetting so a reload that shrinks the list doesn't strand
  // the pager past the last page.
  const currentPage = Math.min(page, totalPages);
  const pagedGroups = groups.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  // A group's row checkbox reads as checked only once every order inside it
  // is selected - the underlying selection stays order-scoped so bulk status
  // changes keep applying per-order exactly as before grouping was added.
  const checkedGroupIds = new Set(
    groups.filter(group => group.orders.every(order => selectedIds.has(order.id))).map(group => group.id),
  );
  // The header checkbox works on the visible page of groups, not the whole tab.
  const allGroupsSelected = pagedGroups.length > 0 && pagedGroups.every(group => checkedGroupIds.has(group.id));
  const someGroupsSelected = pagedGroups.some(group => group.orders.some(order => selectedIds.has(order.id)));
  const selectedOrders = visibleOrders.filter(order => selectedIds.has(order.id));
  const isOptionValidForOrder = (status: ParcelStatus, order: Order) => {
    if (!STATUS_TRANSITIONS[order.status].includes(status)) return false;
    // From "Arrived at Origin", only one of Ready to Deliver / Transit is
    // actually valid, decided by the destination.
    if (order.status === 'arrived' && (status === 'ready_to_deliver' || status === 'oov')) {
      const skipsTransit = destinationSkipsTransit(order);
      if (skipsTransit && status === 'oov') return false;
      if (!skipsTransit && status === 'ready_to_deliver') return false;
    }
    return true;
  };

  const allowedStatusOptions = useMemo(() => {
    if (selectedOrders.length === 0) return [];

    const [firstOrder, ...remainingOrders] = selectedOrders;
    const firstAllowed = new Set(
      STATUS_TRANSITIONS[firstOrder.status].filter(status => isOptionValidForOrder(status, firstOrder)),
    );

    return Array.from(firstAllowed).filter(status =>
      remainingOrders.every(order => isOptionValidForOrder(status, order)),
    );
  }, [selectedOrders]);

  useEffect(() => {
    if (!isActionOpen) return;

    if (!selectedNextStatus || !allowedStatusOptions.includes(selectedNextStatus)) {
      setSelectedNextStatus(allowedStatusOptions[0] || '');
    }
  }, [allowedStatusOptions, isActionOpen]);

  // Focus the popover when it opens so Up/Down/Enter drive it straight away,
  // without the user having to Tab into an option first.
  const statusPopoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isActionOpen) statusPopoverRef.current?.focus();
  }, [isActionOpen]);

  const isRiderAssignAction = selectedNextStatus === 'rider_assigned';
  const isReasonRequiredAction = !!selectedNextStatus && REASON_REQUIRED_STATUSES.includes(selectedNextStatus);

  const toggleGroupSelection = (groupId: string | number) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    const groupIsFullySelected = group.orders.every(order => selectedIds.has(order.id));
    setSelectedIdsByTab(prev => {
      const next = new Set(prev[activeTab]);
      group.orders.forEach(order => {
        if (groupIsFullySelected) next.delete(order.id);
        else next.add(order.id);
      });
      return { ...prev, [activeTab]: next };
    });
  };

  const toggleAllGroups = () => {
    setSelectedIdsByTab(prev => {
      const next = new Set(prev[activeTab]);
      pagedGroups.forEach(group => group.orders.forEach(order => {
        if (allGroupsSelected) next.delete(order.id);
        else next.add(order.id);
      }));
      return { ...prev, [activeTab]: next };
    });
  };

  const toggleOrderSelection = (orderId: string | number) => {
    setSelectedIdsByTab(prev => {
      const next = new Set(prev[activeTab]);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
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

    if (isReasonRequiredAction && !reasonRemarks.trim()) {
      setActionError('A reason remark is required to cancel or fail an order.');
      return;
    }

    setStatusUpdating(true);
    try {
      await Promise.all(
        selectedOrders.map(order => updateOrderStatus(
          order.id,
          selectedNextStatus,
          isReasonRequiredAction ? reasonRemarks.trim() : undefined,
          undefined,
          isRiderAssignAction ? riderId : undefined,
        )),
      );
      await loadPickups();

      setSelectedIdsByTab(prev => ({ ...prev, [activeTab]: new Set() }));
      setIsActionOpen(false);
      setSelectedNextStatus('');
      setRiderId('');
      setReasonRemarks('');
    } catch (err: any) {
      setActionError(err.response?.data?.message || 'Failed to change pickup status.');
    } finally {
      setStatusUpdating(false);
    }
  };

  const handlePrintLabels = () => {
    const labelOrders = selectedOrders.length > 0 ? selectedOrders : visibleOrders;
    void printLabels(labelOrders);
  };

  const moveSelectedStatus = (direction: 1 | -1) => {
    if (allowedStatusOptions.length === 0) return;

    const currentIndex = allowedStatusOptions.findIndex(status => status === selectedNextStatus);
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (safeIndex + direction + allowedStatusOptions.length) % allowedStatusOptions.length;
    setSelectedNextStatus(allowedStatusOptions[nextIndex]);
  };

  const handleStatusPopoverKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Don't hijack typing/navigation inside the reason textarea or the rider
    // search field - those keys belong to the focused field.
    const tag = (event.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

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

  const toggleGroupExpanded = (groupId: string) =>
    setExpandedGroupId(current => (current === groupId ? '' : groupId));

  const pickupColumns = [
    {
      header: 'SN',
      accessor: (group: PickupGroup) => group.sn,
      width: '50px',
      className: 'pickup-sn-cell',
    },
    {
      header: 'ORDER TYPE',
      accessor: (group: PickupGroup) => (
        <span
          className={`pickup-order-type ${getOrderTypeTone(group.orders[0]!)}`}
          title={group.mixedOrderType ? 'Mixed order types in this pickup' : undefined}
        >
          {group.orderType === 'exchange' ? <RefreshCw size={18} /> : <OstrichIcon size={18} />}
        </span>
      ),
      width: '100px',
    },
    {
      header: 'SERVICE TYPE',
      accessor: (group: PickupGroup) =>
        group.mixedServiceType ? 'Mixed' : SERVICE_TYPE_FULL_LABELS[group.serviceType],
      width: '190px',
      className: 'pickup-strong-cell',
    },
    {
      header: 'SENDER',
      accessor: (group: PickupGroup) => (
        <div className="pickup-sender-cell">
          <span>{group.senderName}</span>
          <small>{group.senderPhone}</small>
        </div>
      ),
      width: '220px',
    },
    { header: 'LOCATION', accessor: (group: PickupGroup) => group.location, width: '150px', className: 'pickup-strong-cell' },
    {
      header: 'PIECES',
      accessor: (group: PickupGroup) => `${group.totalPieces}/${group.orders.length}`,
      width: '80px',
      className: 'pickup-strong-cell',
    },
    {
      header: 'PICKUP RIDER',
      accessor: (group: PickupGroup) => group.riderName || '-',
      width: '140px',
      className: 'pickup-strong-cell',
    },
    {
      header: 'ACTION',
      accessor: (group: PickupGroup) => (
        <Button
          variant="primary"
          className="pickup-details-btn"
          onClick={() => toggleGroupExpanded(group.id)}
        >
          {expandedGroupId === group.id ? <><ChevronUp size={14} /> Details</> : <><ChevronDown size={14} /> Details</>}
        </Button>
      ),
      width: '130px',
    },
  ];

  return (
    <div className="pickup-operations-container">
      <PageHeader title="Pickup Operations" subtitle="Manage and track your pickup orders across the hub network.">
        <TicketCategoryButton category="pickup" notificationType="pickup" />
      </PageHeader>

      <SegmentedTabs
        ariaLabel="Pickup operation filters"
        value={activeTab}
        onChange={setActiveTab}
        options={(Object.keys(TAB_LABELS) as PickupTab[]).map(tab => ({ value: tab, label: TAB_LABELS[tab] }))}
      />

      {loadError && <p className="pickup-action-error">{loadError}</p>}

      <div className="pickup-toolbar">
        <div />
        <div className="pickup-toolbar-actions">
          <div className="pickup-action-anchor">
            <Button variant="secondary" className="pickup-outline-btn" onClick={openStatusAction}>
              Action{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </Button>
            {isActionOpen && (
              <div
                ref={statusPopoverRef}
                className="pickup-status-popover"
                tabIndex={-1}
                role="listbox"
                aria-label="Next status"
                onKeyDown={handleStatusPopoverKeyDown}
              >
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
                {isReasonRequiredAction && (
                  <div className="pickup-reason-field">
                    <label className="pickup-reason-label">
                      Reason <span className="pickup-reason-required">*</span>
                    </label>
                    <textarea
                      rows={2}
                      value={reasonRemarks}
                      onChange={e => setReasonRemarks(e.target.value)}
                      placeholder={`Reason to ${STATUS_LABELS[selectedNextStatus as ParcelStatus]?.toLowerCase() || 'cancel/fail'}...`}
                      className="pickup-reason-textarea"
                      disabled={statusUpdating}
                    />
                  </div>
                )}
                {actionError && <p className="pickup-action-error">{actionError}</p>}
                <div className="pickup-status-submit-row">
                  <Button variant="secondary" className="pickup-outline-btn" onClick={() => { setIsActionOpen(false); setRiderId(''); setReasonRemarks(''); }}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="pickup-apply-btn"
                    onClick={applyStatusChange}
                    disabled={statusUpdating || !selectedNextStatus || (isRiderAssignAction && !riderId) || (isReasonRequiredAction && !reasonRemarks.trim())}
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
          <Button variant="secondary" className="pickup-outline-btn" onClick={handlePrintLabels} disabled={visibleOrders.length === 0}>
            <Printer size={14} /> {selectedOrders.length > 0 ? `Print ${selectedOrders.length} Selected` : `Print All (${visibleOrders.length})`}
          </Button>
        </div>
      </div>

      <div className="pickup-search-wrap">
        <label className="pickup-search">
          <Search size={16} />
          <input
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            onKeyDown={event => commitScannedTerm(event, setScannedIds, setSearchQuery)}
            onPaste={event => handleScannerPaste(event, setScannedIds, setSearchQuery)}
            placeholder="Search tracking id"
          />
          {(searchQuery || scannedIds.length > 0) && (
            <button type="button" onClick={() => { setSearchQuery(''); setScannedIds([]); }} aria-label="Clear search">
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
        columns={pickupColumns}
        data={pagedGroups}
        selectedIds={checkedGroupIds}
        onToggleRow={toggleGroupSelection}
        allSelected={allGroupsSelected}
        someSelected={someGroupsSelected}
        onToggleAll={toggleAllGroups}
        getRowClassName={group => (group.id === expandedGroupId ? 'pickup-row-active' : '')}
        loading={loading}
        loadingMessage="Loading pickup orders..."
        emptyMessage="No pickup orders found."
        minWidth="1300px"
        tableClassName="pickup-table"
        expandedRowId={expandedGroupId}
        renderExpandedRow={group => (
          <PickupGroupDetailPanel
            group={group}
            selectedIds={selectedIds}
            onToggleOrder={toggleOrderSelection}
            onToggleAll={() => toggleGroupSelection(group.id)}
            onRemarkClick={setRemarkPopupOrder}
          />
        )}
      />

      <Pagination
        ariaLabel="Pickup pagination"
        page={currentPage}
        totalPages={totalPages}
        onPageChange={next => { setPage(next); setExpandedGroupId(''); }}
        summary={
          `${groups.length} pickup${groups.length === 1 ? '' : 's'} · ` +
          `${orders.length}${capped ? '+' : ''} order${orders.length === 1 ? '' : 's'}` +
          (capped ? ` (showing the first ${orders.length})` : '')
        }
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

export default PickupOperations;
