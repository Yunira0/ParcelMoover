import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Table from '../components/Table';
import Button from '../components/Button';
import Pagination from '../components/Pagination';
import ConfirmDialog from '../components/ConfirmDialog';
import StatusChip from '../components/StatusChip';
import { useCursorPagination } from '../hooks/useCursorPagination';
import { apiErrorMessage } from '../utils/serverValidation';
import {
  getTrashedOrders,
  restoreOrder,
  type Order,
  type OrdersPageMeta,
} from '../services/orders.service';
import { ORDER_STATUS_LABELS as STATUS_LABELS } from '../utils/orderStatus';
import './TrashOrdersPage.css';

const PAGE_SIZE = 10;

/**
 * The trash: orders that have been soft-deleted, either by hand from the orders
 * list or by the sweep that clears out orders cancelled more than a week ago.
 *
 * Restore is the only action offered. Permanent deletion is deliberately not
 * exposed here: createOrder writes a cod_collections row for every order, and
 * the server refuses to hard-delete anything carrying one, so the button was
 * refused on effectively every row. Orders stay in the trash instead.
 */
const TrashOrdersPage: React.FC = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<OrdersPageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  // The order awaiting restore confirmation; null when closed.
  const [restoreTarget, setRestoreTarget] = useState<Order | null>(null);

  // Same keyset pager the orders list uses: /orders/trash goes through
  // listOrders, so it returns the identical cursor meta.
  const pager = useCursorPagination();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await getTrashedOrders({
        pageSize: pageSizeChoice,
        cursor: pager.request.cursor,
        dir: pager.request.dir,
      }, signal);
      if (signal?.aborted) return;
      if (res?.success && Array.isArray(res.data)) {
        setOrders(res.data);
        setMeta(res.meta ?? null);
        setError('');
      }
    } catch (err) {
      if (!signal?.aborted) setError(apiErrorMessage(err, 'Failed to load the trash'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [pageSizeChoice, pager.request]);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Restoring the last row on a page leaves the cursor pointing past the end of
  // the list, which reads as a blank table with working "prev" buttons. Fall
  // back to the first page instead.
  useEffect(() => {
    if (!loading && orders.length === 0 && pager.page > 1) pager.reset();
  }, [loading, orders.length, pager]);

  /**
   * Restore the order into Pickup Ordered - the only stage a trash restore
   * may target.
   *
   * One call: the server does the un-cancel, the history row, the vendor
   * webhook and the ledger re-sync in a single transaction, so there is no
   * window where the order is restored but sitting at the wrong stage.
   */
  const runRestore = async (order: Order) => {
    setBusyId(order.id);
    try {
      await restoreOrder(order.id, 'pickup_ordered');
      setNotice(`Order ${order.trackingId} restored to ${STATUS_LABELS.pickup_ordered}`);
      setError('');
      setRestoreTarget(null);
      // Refetch rather than dropping the row locally: the page would otherwise
      // be one row short and the total in the pager summary would be stale.
      await load();
    } catch (err) {
      setRestoreTarget(null);
      setError(apiErrorMessage(err, 'Failed to restore the order'));
    } finally {
      setBusyId(null);
    }
  };

  const columns = [
    {
      header: 'ORDER',
      accessor: (order: Order) => `#${order.orderNumber}`,
      width: '100px',
    },
    {
      header: 'TRACKING ID',
      accessor: (order: Order) => (
        <Link to={`/orders/track/${order.trackingId}`} className="trash-tracking-link">
          {order.trackingId}
        </Link>
      ),
      width: '180px',
      className: 'trash-tracking-cell',
    },
    {
      header: 'RECEIVER',
      accessor: (order: Order) => (
        <div>
          <div>{order.receiverName}</div>
          <div className="trash-subtle">{order.receiverPhone}</div>
        </div>
      ),
    },
    {
      header: 'VENDOR',
      accessor: (order: Order) => order.vendorName || '—',
    },
    {
      header: 'DESTINATION',
      accessor: (order: Order) => order.destination || '—',
    },
    {
      header: 'ADDRESS',
      accessor: (order: Order) => order.receiverAddress || '—',
    },
    {
      header: 'STATUS',
      accessor: (order: Order) => (
        <StatusChip tone={order.status === 'cancelled' ? 'neutral' : 'warning'}>
          {order.status.replace(/_/g, ' ')}
        </StatusChip>
      ),
      width: '140px',
    },
    {
      header: 'CANCELLED FROM',
      accessor: (order: Order) =>
        order.cancelledFromStatus ? STATUS_LABELS[order.cancelledFromStatus] : '—',
      width: '150px',
    },
    {
      header: 'REMARK',
      accessor: (order: Order) => order.remarks || '—',
    },
    {
      header: 'ACTION',
      accessor: (order: Order) => (
        <div className="trash-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRestoreTarget(order)}
            disabled={busyId === order.id}
          >
            <RotateCcw size={14} /> Restore
          </Button>
        </div>
      ),
      width: '130px',
      className: 'trash-actions-column',
    },
  ];

  return (
    <div className="trash-page">
      <PageHeader
        title="Trash"
        subtitle="Deleted orders, plus anything cancelled for more than 7 days. Restoring puts an order back into the orders list."
      />

      <div className="trash-page-toolbar">
        <Button variant="outline" onClick={() => navigate('/orders')}>
          <ArrowLeft size={16} /> Back to Orders
        </Button>
      </div>

      {error && <p className="trash-error">{error}</p>}
      {notice && <p className="trash-notice">{notice}</p>}

      <Table
        columns={columns}
        data={orders}
        loading={loading}
        loadingMessage="Loading trash…"
        emptyMessage="The trash is empty."
      />

      <Pagination
        ariaLabel="Trash pagination"
        page={pager.page}
        totalPages={Math.max(1, meta?.totalPages ?? 1)}
        cursor={pager.controls(meta)}
        pageSize={pageSizeChoice}
        pageSizeLabel="Trash"
        onPageSizeChange={(size) => {
          setPageSizeChoice(size);
          pager.reset();
        }}
        summary={meta ? `${meta.total} order${meta.total === 1 ? '' : 's'} in trash` : undefined}
      />

      <ConfirmDialog
        isOpen={restoreTarget !== null}
        busy={busyId !== null && busyId === restoreTarget?.id}
        title={
          restoreTarget
            ? `Restore ${restoreTarget.trackingId} to ${STATUS_LABELS.pickup_ordered}?`
            : ''
        }
        message="The order rejoins the workflow at Pickup Ordered and the change is recorded in its history."
        confirmLabel="OK"
        cancelLabel="Cancel"
        onConfirm={() => restoreTarget && runRestore(restoreTarget)}
        onCancel={() => setRestoreTarget(null)}
      />
    </div>
  );
};

export default TrashOrdersPage;
