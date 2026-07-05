import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Printer, Search } from 'lucide-react';
import Table from '../components/Table';
import Button from '../components/Button';
import SegmentedTabs from '../components/SegmentedTabs';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import StatusChip from '../components/StatusChip';
import {
  getOrders,
  bulkUpdateOrderStatus,
  subscribeToOrderStatusChanged,
  type Order,
  type OrdersPageMeta,
  type ParcelStatus,
} from '../services/orders.service';
import RiderAssignModal from '../components/RiderAssignModal';
import { toBsDate } from '../utils/nepaliDate';
import { printLabels } from '../utils/printLabels';
import './ReturnOperations.css';

type ReturnTab = 'follow_up' | 'ready_to_return' | 'sent_to_vendor' | 'returned_to_vendor';

const PAGE_SIZE = 10;

const TAB_LABELS: Record<ReturnTab, string> = {
  follow_up: 'Follow up',
  ready_to_return: 'Ready to return',
  sent_to_vendor: 'Sent to vendor',
  returned_to_vendor: 'Returned to vendor',
};

const STATUS_LABELS: Partial<Record<ParcelStatus, string>> = {
  pickup_ordered: 'Pickup Ordered',
  rider_assigned: 'Rider Assigned',
  picked_up: 'Picked Up',
  arrived: 'Arrived at Origin',
  ready_to_deliver: 'Ready to Deliver',
  sent_for_delivery: 'In Transit',
  oov: 'Transit',
  dispatched: 'Dispatched',
  arrived_at_branch: 'Arrived at Destination',
  hold: 'On Hold',
  delivered: 'Delivered',
  partially_delivered: 'Partially Delivered',
  failed_delivery: 'Failed Delivery',
  follow_up: 'Follow Up',
  ready_to_return: 'Ready to Return',
  sent_to_vendor: 'Sent to Vendor',
  returned_to_vendor: 'Returned to Vendor',
};

// Maps any return-relevant parcel into one of the four return stages.
// Type 2 (RTO of a failed delivery) maps by its real status; Type 1 (an
// order_type='return' reverse shipment) maps by where it is in its lifecycle.
const returnStage = (o: Order): ReturnTab | null => {
  if (o.status === 'failed_delivery' || o.status === 'follow_up' || o.status === 'partially_delivered') return 'follow_up';
  if (o.status === 'ready_to_return') return 'ready_to_return';
  if (o.status === 'sent_to_vendor') return 'sent_to_vendor';
  if (o.status === 'returned_to_vendor') return 'returned_to_vendor';
  if (o.orderType === 'return') {
    if (o.status === 'delivered') return 'returned_to_vendor';
    if (['pickup_ordered', 'rider_assigned'].includes(o.status)) return 'ready_to_return';
    return 'sent_to_vendor';
  }
  return null;
};

const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const ReturnOperations: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<OrdersPageMeta | null>(null);
  const [activeTab, setActiveTab] = useState<ReturnTab>(() => {
    const fromUrl = searchParams.get('tab');
    return fromUrl && fromUrl in TAB_LABELS ? (fromUrl as ReturnTab) : 'follow_up';
  });
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [actionMsg, setActionMsg] = useState('');
  const [acting, setActing] = useState(false);
  // Rider-assignment popup for ready_to_return → sent_to_vendor.
  const [riderModalOpen, setRiderModalOpen] = useState(false);
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  // The follow_up/ready_to_return/sent_to_vendor/returned_to_vendor split
  // depends on orderType *and* status together (see returnStage below), which
  // the backend's status[] filter can't express - so this still fetches the
  // (capped, default) unfiltered list rather than a real server-paginated one.
  // meta.truncated at least surfaces it honestly instead of claiming completeness.
  const loadReturns = async () => {
    setLoading(true);
    try {
      const res = await getOrders();
      if (res?.success && Array.isArray(res.data)) {
        // Both kinds of returns: reverse orders + failed deliveries in the RTO flow.
        setOrders(res.data.filter((order) => returnStage(order) !== null));
        setMeta(res.meta ?? null);
        setLoadError('');
      }
    } catch {
      setLoadError('Failed to load return orders. Showing the last loaded data, if any.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadReturns(); }, []);
  useEffect(() => subscribeToOrderStatusChanged(loadReturns), []);
  useEffect(() => { setPage(1); setSelectedIds(new Set()); setActionMsg(''); }, [activeTab, searchQuery]);

  // Keep tab/search bookmarkable - mirror into the URL (replacing history,
  // not pushing, so the back button doesn't step through every keystroke).
  useEffect(() => {
    const next = new URLSearchParams();
    if (activeTab !== 'follow_up') next.set('tab', activeTab);
    if (searchQuery) next.set('search', searchQuery);
    setSearchParams(next, { replace: true });
  }, [activeTab, searchQuery, setSearchParams]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((order) => {
      if (returnStage(order) !== activeTab) return false;
      if (!q) return true;
      return (
        order.trackingId.toLowerCase().includes(q) ||
        order.senderName.toLowerCase().includes(q) ||
        order.receiverName.toLowerCase().includes(q)
      );
    });
  }, [orders, activeTab, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const visibleOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const visibleOrderIds = visibleOrders.map((order) => order.id);
  const allVisibleSelected = visibleOrderIds.length > 0 && visibleOrderIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleOrderIds.some((id) => selectedIds.has(id));

  const toggleRowSelection = (orderId: string | number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleOrderIds.forEach((id) => next.delete(id));
      else visibleOrderIds.forEach((id) => next.add(id));
      return next;
    });
  };

  // Advance selected RTO parcels to the next stage. Only items currently in one
  // of `sourceStatuses` are eligible (server rejects invalid transitions), so we
  // pre-filter to avoid failing the whole batch.
  const advance = async (target: ParcelStatus, sourceStatuses: ParcelStatus[]) => {
    const eligible = visibleOrders
      .filter((o) => selectedIds.has(o.id) && sourceStatuses.includes(o.status))
      .map((o) => o.id);
    if (eligible.length === 0) {
      setActionMsg('Select one or more orders in the return flow to action.');
      return;
    }
    setActing(true);
    setActionMsg('');
    try {
      await bulkUpdateOrderStatus(eligible, target);
      setSelectedIds(new Set());
      await loadReturns();
    } catch (err: any) {
      setActionMsg(err.response?.data?.message || 'Action failed.');
    } finally {
      setActing(false);
    }
  };

  // Sending to the vendor needs a rider, so it opens the rider picker first.
  const openSendToVendor = () => {
    const eligible = visibleOrders
      .filter((o) => selectedIds.has(o.id) && o.status === 'ready_to_return')
      .map((o) => o.id);
    if (eligible.length === 0) {
      setActionMsg('Select one or more "ready to return" orders first.');
      return;
    }
    setActionMsg('');
    setPendingIds(eligible);
    setRiderModalOpen(true);
  };

  const confirmSendToVendor = async (riderId: string) => {
    if (!riderId) return;
    setActing(true);
    setActionMsg('');
    try {
      await bulkUpdateOrderStatus(pendingIds, 'sent_to_vendor', { riderId });
      setRiderModalOpen(false);
      setSelectedIds(new Set());
      setPendingIds([]);
      await loadReturns();
    } catch (err: any) {
      setActionMsg(err.response?.data?.message || 'Failed to assign rider.');
    } finally {
      setActing(false);
    }
  };

  const downloadCsv = () => {
    const headers = ['#', 'Tracking ID', 'Type', 'Status', 'Sender', 'Receiver', 'Weight', 'COD'];
    const rows = filteredOrders.map((order) => [
      `#${order.orderNumber}`,
      order.trackingId,
      order.orderType === 'return' ? 'Return order' : 'RTO',
      STATUS_LABELS[order.status] || order.status,
      order.senderName,
      order.receiverName,
      order.weightKg ? `${order.weightKg} Kg` : '',
      order.codAmount,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'return-orders.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const selectedOrders = visibleOrders.filter((o) => selectedIds.has(o.id));

  const handlePrintLabels = () => {
    const labelOrders = selectedOrders.length > 0 ? selectedOrders : visibleOrders;
    void printLabels(labelOrders);
  };

  const returnColumns = [
    {
      header: '#',
      accessor: (order: Order) => `#${order.orderNumber}`,
      width: '70px',
      className: 'return-sn-cell',
    },
    { header: 'DATE', accessor: (order: Order) => toBsDate(order.createdAt) || '-', width: '100px' },
    {
      header: 'TRACKING ID',
      accessor: (order: Order) => (
        <Link to={`/orders/track/${order.trackingId}`} className="tracking-id-link">{order.trackingId}</Link>
      ),
      width: '124px',
      className: 'return-tracking-cell',
    },
    {
      header: 'TYPE',
      accessor: (order: Order) => (
        <StatusChip tone={order.orderType === 'return' ? 'info' : 'warning'}>
          {order.orderType === 'return' ? 'Return order' : 'RTO'}
        </StatusChip>
      ),
      width: '110px',
    },
    {
      header: 'SENDER',
      accessor: (order: Order) => (
        <div className="return-party-cell"><span>{order.senderName}</span><small>{order.senderPhone}</small></div>
      ),
      width: '160px',
    },
    {
      header: 'RECEIVER',
      accessor: (order: Order) => (
        <div className="return-party-cell"><span>{order.receiverName}</span><small>{order.receiverPhone}</small></div>
      ),
      width: '160px',
    },
    { header: 'WEIGHT', accessor: (order: Order) => (order.weightKg ? `${order.weightKg} Kg` : '-'), width: '80px' },
    { header: 'COD', accessor: (order: Order) => formatMoney(order.codAmount), width: '100px' },
    {
      header: 'STATUS',
      accessor: (order: Order) => (
        <StatusChip tone={order.status === 'returned_to_vendor' ? 'success' : 'neutral'}>
          {STATUS_LABELS[order.status] || order.status}
        </StatusChip>
      ),
      width: '150px',
    },
  ];

  const noSelection = selectedIds.size === 0 || acting;

  return (
    <div className="return-operations-container">
      <PageHeader title="Return" subtitle="Manage return orders and failed deliveries going back to the vendor." />

      <SegmentedTabs
        ariaLabel="Return operation filters"
        value={activeTab}
        onChange={setActiveTab}
        options={(Object.keys(TAB_LABELS) as ReturnTab[]).map((tab) => ({ value: tab, label: TAB_LABELS[tab] }))}
      />

      {loadError && <p className="return-action-msg">{loadError}</p>}
      {meta?.truncated && (
        <p className="return-action-msg">
          Showing the most recent {meta.pageSize} of {meta.total} matching orders. Narrow your search to see the rest.
        </p>
      )}

      <div className="return-toolbar">
        <div className="return-toolbar-actions">
          {activeTab === 'follow_up' && (
            <>
              <Button variant="secondary" disabled={noSelection} onClick={() => advance('ready_to_deliver', ['failed_delivery', 'follow_up'])}>
                Reattempt delivery
              </Button>
              <Button variant="primary" disabled={noSelection} onClick={() => advance('ready_to_return', ['failed_delivery', 'follow_up'])}>
                Mark for return
              </Button>
            </>
          )}
          {activeTab === 'ready_to_return' && (
            <Button variant="primary" disabled={noSelection} onClick={openSendToVendor}>
              Send to vendor
            </Button>
          )}
          {activeTab === 'sent_to_vendor' && (
            <Button variant="primary" disabled={noSelection} onClick={() => advance('returned_to_vendor', ['sent_to_vendor'])}>
              Mark returned to vendor
            </Button>
          )}
        </div>
        <div className="return-toolbar-actions">
          <Button variant="secondary" onClick={downloadCsv}><Download size={14} /> Download</Button>
          <Button variant="secondary" onClick={handlePrintLabels} disabled={visibleOrders.length === 0}>
            <Printer size={14} /> {selectedOrders.length > 0 ? `Print ${selectedOrders.length} Selected` : `Print All (${visibleOrders.length})`}
          </Button>
        </div>
      </div>

      {actionMsg && <p className="return-action-msg">{actionMsg}</p>}

      <label className="return-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search tracking id"
        />
      </label>

      <Table
        columns={returnColumns}
        data={visibleOrders}
        selectedIds={selectedIds}
        onToggleRow={toggleRowSelection}
        allSelected={allVisibleSelected}
        someSelected={someVisibleSelected}
        onToggleAll={toggleVisibleSelection}
        loading={loading}
        loadingMessage="Loading return orders..."
        emptyMessage="No return orders in this stage."
        minWidth="1130px"
        tableClassName="return-table"
      />

      <Pagination
        ariaLabel="Return pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        summary={`${filteredOrders.length} order${filteredOrders.length === 1 ? '' : 's'}`}
      />

      <RiderAssignModal
        isOpen={riderModalOpen}
        title="Assign rider"
        description={`Pick the rider who will carry ${pendingIds.length} parcel${pendingIds.length === 1 ? '' : 's'} back to the vendor.`}
        confirmLabel="Send to vendor"
        busy={acting}
        error={actionMsg}
        onClose={() => setRiderModalOpen(false)}
        onConfirm={confirmSendToVendor}
      />
    </div>
  );
};

export default ReturnOperations;
