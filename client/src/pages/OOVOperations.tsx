import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Download,
  Printer,
  Search,
} from 'lucide-react';
import Table from '../components/Table';
import Button from '../components/Button';
import SearchableSelect from '../components/SearchableSelect';
import SegmentedTabs from '../components/SegmentedTabs';
import PageHeader from '../components/PageHeader';
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
import { getLocations, getRiders } from '../services/users.service';
import { getNcmBranches, handoffToNcm, type NcmBranch } from '../services/ncm.service';
import { toBsDate } from '../utils/nepaliDate';
import { printLabels } from '../utils/printLabels';
import { useCursorPagination } from '../hooks/useCursorPagination';
import './OOVOperations.css';

type OOVTab = 'oov' | 'dispatched';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

const TAB_LABELS: Record<OOVTab, string> = {
  oov: 'Transit',
  dispatched: 'In Transit',
};

const TAB_STATUSES: Record<OOVTab, ParcelStatus[]> = {
  oov: ['oov'],
  dispatched: ['dispatched'],
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

const createEmptySelections = (): Record<OOVTab, Map<string, Order>> => ({
  oov: new Map(),
  dispatched: new Map(),
});

const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

// Cancelling or failing an order requires a reason remark.
const REASON_REQUIRED_STATUSES: ParcelStatus[] = ['cancelled', 'failed_pickup', 'failed_delivery'];

const OOVOperations: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<OrdersPageMeta | null>(null);
  const [activeTab, setActiveTab] = useState<OOVTab>(() => {
    const fromUrl = searchParams.get('tab');
    return fromUrl && fromUrl in TAB_LABELS ? (fromUrl as OOVTab) : 'oov';
  });
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('search') || '');
  const pager = useCursorPagination();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectionByTab, setSelectionByTab] = useState<Record<OOVTab, Map<string, Order>>>(createEmptySelections);
  const [isActionOpen, setIsActionOpen] = useState(false);
  const [selectedNextStatus, setSelectedNextStatus] = useState<ParcelStatus | ''>('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [actionError, setActionError] = useState('');
  const [remarkPopupOrder, setRemarkPopupOrder] = useState<Order | null>(null);
  const [dispatchMethod, setDispatchMethod] = useState<'manifest' | 'tpl'>('manifest');
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [riders, setRiders] = useState<{ id: string; name: string }[]>([]);
  const [toLocationId, setToLocationId] = useState('');
  const [riderId, setRiderId] = useState('');
  const [reasonRemarks, setReasonRemarks] = useState('');
  const [ncmBranches, setNcmBranches] = useState<NcmBranch[]>([]);
  const [ncmBranchesError, setNcmBranchesError] = useState('');
  const [ncmBranch, setNcmBranch] = useState('');

  // Debounce search input so every keystroke doesn't fire a request.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchQuery.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    pager.reset();
    setIsActionOpen(false);
    setActionError('');
  }, [activeTab, debouncedSearch, pager.reset]);

  // Keep tab/search bookmarkable - mirror into the URL (replacing history,
  // not pushing, so the back button doesn't step through every keystroke).
  useEffect(() => {
    const next = new URLSearchParams();
    if (activeTab !== 'oov') next.set('tab', activeTab);
    if (debouncedSearch) next.set('search', debouncedSearch);
    setSearchParams(next, { replace: true });
  }, [activeTab, debouncedSearch, setSearchParams]);

  useEffect(() => {
    (async () => {
      try {
        const [locRes, riderRes] = await Promise.all([getLocations(), getRiders()]);
        if (locRes?.success && Array.isArray(locRes.data)) setLocations(locRes.data);
        if (riderRes?.success && Array.isArray(riderRes.data)) {
          setRiders(riderRes.data.filter((r: { status: string }) => r.status === 'active'));
        }
      } catch {
        // dropdowns will just be empty; not fatal
      }
    })();
  }, []);

  const loadOovOrders = useCallback(async () => {
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
      setLoadError('Failed to load orders. Showing the last loaded data, if any.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, debouncedSearch, pager.request]);

  useEffect(() => {
    loadOovOrders();
  }, [loadOovOrders]);

  useEffect(() => subscribeToOrderStatusChanged(loadOovOrders), [loadOovOrders]);

  const visibleOrders = orders;
  const totalCount = meta?.total ?? visibleOrders.length;
  const totalPages = meta?.totalPages ?? 1;

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
  const isReasonRequiredAction = REASON_REQUIRED_STATUSES.includes(effectiveNextStatus as ParcelStatus);

  // NCM branch list is only needed once the 3PL method is picked — and the
  // fetch fails cleanly when the NCM integration isn't configured.
  useEffect(() => {
    if (dispatchMethod !== 'tpl' || ncmBranches.length > 0) return;
    (async () => {
      try {
        const res = await getNcmBranches();
        if (res?.success && Array.isArray(res.data)) {
          setNcmBranches(res.data);
          setNcmBranchesError('');
        }
      } catch (err: unknown) {
        const message =
          typeof err === 'object' && err !== null && 'response' in err &&
          typeof (err as { response?: { data?: { message?: unknown } } }).response?.data?.message === 'string'
            ? (err as { response: { data: { message: string } } }).response.data.message
            : 'Failed to load NCM branches.';
        setNcmBranchesError(message);
      }
    })();
  }, [dispatchMethod, ncmBranches.length]);

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
      setActionError('Select at least one order first.');
      return;
    }

    setActionError(allowedStatusOptions.length > 0 ? '' : 'No valid status transition is available for the selected order status.');
    setSelectedNextStatus(effectiveNextStatus);
  };

  const applyStatusChange = async () => {
    setActionError('');

    if (selectedOrders.length === 0) {
      setActionError('Select at least one order first.');
      return;
    }

    if (!effectiveNextStatus || !allowedStatusOptions.includes(effectiveNextStatus)) {
      setActionError('Selected status is not allowed for the current order status.');
      return;
    }

    if (isDispatchAction && dispatchMethod === 'manifest' && !toLocationId) {
      setActionError('Select a destination hub to dispatch this manifest.');
      return;
    }

    if (isDispatchAction && dispatchMethod === 'tpl' && !ncmBranch) {
      setActionError('Select the NCM destination branch for this handoff.');
      return;
    }

    if (isReasonRequiredAction && !reasonRemarks.trim()) {
      setActionError('A reason remark is required to cancel or fail an order.');
      return;
    }

    setStatusUpdating(true);
    try {
      const ids = selectedOrders.map(order => String(order.id));

      if (isDispatchAction && dispatchMethod === 'tpl') {
        // Hand off to NCM: creates the NCM orders; parcels stay in Transit
        // until NCM's pickup webhook moves them to In Transit.
        const res = await handoffToNcm(ids, ncmBranch);
        const failed = (res.data ?? []).filter(item => !item.success);
        if (failed.length > 0) {
          setActionError(
            failed.map(item => `${item.trackingId}: ${item.error || 'failed'}`).join(' · '),
          );
          await loadOovOrders();
          return;
        }
      } else {
        await bulkUpdateOrderStatus(ids, effectiveNextStatus, {
          toLocationId: isDispatchAction && dispatchMethod === 'manifest' ? toLocationId : undefined,
          riderId: isDispatchAction && dispatchMethod === 'manifest' ? riderId || undefined : undefined,
          remarks: isReasonRequiredAction ? reasonRemarks.trim() : undefined,
        });
      }
      await loadOovOrders();

      setSelectionByTab(prev => ({ ...prev, [activeTab]: new Map() }));
      setIsActionOpen(false);
      setSelectedNextStatus('');
      setToLocationId('');
      setRiderId('');
      setNcmBranch('');
      setDispatchMethod('manifest');
      setReasonRemarks('');
    } catch (err: unknown) {
      const message =
        typeof err === 'object' &&
        err !== null &&
        'response' in err &&
        typeof (err as { response?: { data?: { message?: unknown } } }).response?.data?.message === 'string'
          ? (err as { response: { data: { message: string } } }).response.data.message
          : 'Failed to change order status.';
      setActionError(message);
    } finally {
      setStatusUpdating(false);
    }
  };

  const buildCsv = (rows: Order[]) => {
    const headers = ['#', 'Date', 'Tracking ID', 'Order Type', 'Sender', 'Receiver', 'Location', 'Weight', 'COD', 'Last Updated', 'Remarks'];
    const csvRows = rows.map(order => [
      `#${order.orderNumber}`,
      toBsDate(order.createdAt),
      order.trackingId,
      order.orderType,
      order.senderName,
      order.receiverName,
      order.destination,
      order.weightKg ? `${order.weightKg} Kg` : '',
      order.codAmount,
      toBsDate(order.lastUpdatedAt) || '',
      order.remarks || '',
    ]);
    return [headers, ...csvRows]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
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

    const csv = buildCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'oov-orders.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintLabels = () => {
    const labelOrders = selectedOrders.length > 0 ? selectedOrders : visibleOrders;
    void printLabels(labelOrders);
  };

  const oovColumns = [
    {
      header: 'ID',
      accessor: (order: Order) => `#${order.orderNumber}`,
      width: '70px',
      className: 'oov-sn-cell',
    },
    { header: 'DATE', accessor: (order: Order) => toBsDate(order.createdAt) || '-', width: '100px' },
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
          <span>{toBsDate(order.lastUpdatedAt) || '-'}</span>
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
      <PageHeader title="Transit Operations" subtitle="Keep track of your parcel orders across the entire hub network." />

      <SegmentedTabs
        ariaLabel="Order operation filters"
        value={activeTab}
        onChange={setActiveTab}
        options={(Object.keys(TAB_LABELS) as OOVTab[]).map(tab => ({ value: tab, label: TAB_LABELS[tab] }))}
      />

      {loadError && <p className="oov-action-error">{loadError}</p>}

      <div className="oov-toolbar">
        <label className="oov-search">
          <Search size={16} />
          <input
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="Search tracking id"
          />
        </label>
        <div className="oov-toolbar-actions">
          {selectedIds.size > 0 && (
            <span className="oov-selected-count">
              {selectedIds.size} order{selectedIds.size === 1 ? '' : 's'} selected
            </span>
          )}
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
                  <div className="oov-dispatch-method">
                    <label className="oov-dispatch-radio">
                      <input
                        type="radio"
                        name="dispatchMethod"
                        value="manifest"
                        checked={dispatchMethod === 'manifest'}
                        onChange={() => setDispatchMethod('manifest')}
                        disabled={statusUpdating}
                      />
                      <span>Via Manifest</span>
                    </label>
                    <label className="oov-dispatch-radio">
                      <input
                        type="radio"
                        name="dispatchMethod"
                        value="tpl"
                        checked={dispatchMethod === 'tpl'}
                        onChange={() => setDispatchMethod('tpl')}
                        disabled={statusUpdating}
                      />
                      <span>Via 3PL (NCM)</span>
                    </label>
                  </div>
                )}
                {isDispatchAction && dispatchMethod === 'tpl' && (
                  <div className="oov-manifest-fields">
                    <div className="oov-manifest-field">
                      <span>NCM destination branch</span>
                      <SearchableSelect
                        options={ncmBranches.map(branch => ({
                          id: branch.name,
                          label: branch.district ? `${branch.name} (${branch.district})` : branch.name,
                        }))}
                        value={ncmBranch}
                        onChange={setNcmBranch}
                        placeholder="Select NCM branch"
                        searchPlaceholder="Search branch..."
                        emptyMessage={ncmBranchesError || 'No NCM branches found.'}
                        disabled={statusUpdating}
                      />
                    </div>
                    <p className="oov-status-empty">
                      Orders stay in Transit until NCM confirms pickup, then follow NCM tracking automatically.
                    </p>
                  </div>
                )}
                {isDispatchAction && dispatchMethod === 'manifest' && (
                  <div className="oov-manifest-fields">
                    <div className="oov-manifest-field">
                      <span>Destination hub</span>
                      <SearchableSelect
                        options={locations.map(loc => ({ id: loc.id, label: loc.name }))}
                        value={toLocationId}
                        onChange={setToLocationId}
                        placeholder="Select destination hub"
                        searchPlaceholder="Search hub..."
                        emptyMessage="No hubs found."
                        disabled={statusUpdating}
                      />
                    </div>
                    <div className="oov-manifest-field">
                      <span>Rider / vehicle (optional)</span>
                      <SearchableSelect
                        options={[
                          { id: '', label: 'Unassigned' },
                          ...riders.map(rider => ({ id: rider.id, label: rider.name })),
                        ]}
                        value={riderId}
                        onChange={setRiderId}
                        placeholder="Unassigned"
                        searchPlaceholder="Search rider by name..."
                        emptyMessage="No active riders found."
                        disabled={statusUpdating}
                      />
                    </div>
                  </div>
                )}
                {isReasonRequiredAction && (
                  <div className="oov-reason-field">
                    <label className="oov-reason-label">
                      Reason <span className="oov-reason-required">*</span>
                    </label>
                    <textarea
                      rows={2}
                      value={reasonRemarks}
                      onChange={e => setReasonRemarks(e.target.value)}
                      placeholder={`Reason to ${STATUS_LABELS[effectiveNextStatus as ParcelStatus]?.toLowerCase() || 'cancel/fail'}...`}
                      className="oov-reason-textarea"
                      disabled={statusUpdating}
                    />
                  </div>
                )}
                {actionError && <p className="oov-action-error">{actionError}</p>}
                <div className="oov-status-submit-row">
                  <Button variant="secondary" className="oov-outline-btn" onClick={() => { setIsActionOpen(false); setReasonRemarks(''); }}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="oov-apply-btn"
                    onClick={applyStatusChange}
                    disabled={statusUpdating || !effectiveNextStatus || (isReasonRequiredAction && !reasonRemarks.trim())}
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
          <Button variant="secondary" className="oov-outline-btn" onClick={handlePrintLabels} disabled={visibleOrders.length === 0}>
            <Printer size={14} /> {selectedOrders.length > 0 ? `Print ${selectedOrders.length} Selected` : `Print All (${visibleOrders.length})`}
          </Button>
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
        loadingMessage="Loading orders..."
        emptyMessage="No orders found."
        minWidth="1480px"
        tableClassName="oov-table"
      />

      <Pagination
        ariaLabel="OOV pagination"
        page={pager.page}
        totalPages={totalPages}
        cursor={pager.controls(meta)}
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
