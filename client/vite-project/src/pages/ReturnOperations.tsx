import React, { useEffect, useMemo, useState } from 'react';
import { Download, Printer, Search } from 'lucide-react';
import Table from '../components/Table';
import Button from '../components/Button';
import SegmentedTabs from '../components/SegmentedTabs';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import StatusChip from '../components/StatusChip';
import {
  getOrders,
  subscribeToOrderStatusChanged,
  type Order,
} from '../services/orders.service';
import './ReturnOperations.css';

type ReturnTab = 'follow_up' | 'ready_to_return' | 'sent_to_vendor' | 'returned_to_vendor';

const PAGE_SIZE = 10;

const TAB_LABELS: Record<ReturnTab, string> = {
  follow_up: 'Follow up',
  ready_to_return: 'Ready to return',
  sent_to_vendor: 'sent to vendor',
  returned_to_vendor: 'Returned to vendor',
};

const formatMoney = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });

const ReturnOperations: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<ReturnTab>('follow_up');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());

  const loadReturns = async () => {
    setLoading(true);
    try {
      const res = await getOrders();
      if (res?.success && Array.isArray(res.data)) {
        setOrders(res.data.filter((order) => order.orderType === 'return'));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadReturns(); }, []);
  useEffect(() => subscribeToOrderStatusChanged(loadReturns), []);
  useEffect(() => { setPage(1); }, [activeTab, searchQuery]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((order) =>
      order.trackingId.toLowerCase().includes(q) ||
      order.senderName.toLowerCase().includes(q) ||
      order.receiverName.toLowerCase().includes(q),
    );
  }, [orders, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const visibleOrders = filteredOrders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const visibleOrderIds = visibleOrders.map((order) => order.id);
  const allVisibleSelected = visibleOrderIds.length > 0 && visibleOrderIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleOrderIds.some((id) => selectedIds.has(id));

  const toggleRowSelection = (orderId: string | number) => {
    setSelectedIds((prev) => {
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
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleOrderIds.forEach((id) => next.delete(id));
      } else {
        visibleOrderIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const downloadCsv = () => {
    const headers = ['Tracking ID', 'Sender', 'Receiver', 'Weight', 'COD', 'Last Updated By', 'Last Updated'];
    const rows = filteredOrders.map((order) => [
      order.trackingId,
      order.senderName,
      order.receiverName,
      order.weightKg ? `${order.weightKg} Kg` : '',
      order.codAmount,
      order.lastUpdatedBy || '',
      order.lastUpdatedAt || '',
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

  const returnColumns = [
    {
      header: 'SN',
      accessor: (order: Order) => ((page - 1) * PAGE_SIZE) + visibleOrders.findIndex((row) => row.id === order.id) + 1,
      width: '50px',
      className: 'return-sn-cell',
    },
    { header: 'DATE', accessor: (order: Order) => order.createdAt || '-', width: '100px' },
    { header: 'TRACKING ID', accessor: (order: Order) => order.trackingId, width: '124px', className: 'return-tracking-cell' },
    {
      header: 'SENDER',
      accessor: (order: Order) => (
        <div className="return-party-cell">
          <span>{order.senderName}</span>
          <small>{order.senderPhone}</small>
        </div>
      ),
      width: '173px',
    },
    {
      header: 'RECEIVER',
      accessor: (order: Order) => (
        <div className="return-party-cell">
          <span>{order.receiverName}</span>
          <small>{order.receiverPhone}</small>
        </div>
      ),
      width: '172px',
    },
    { header: 'WEIGHT', accessor: (order: Order) => (order.weightKg ? `${order.weightKg} Kg` : '-'), width: '80px' },
    { header: 'COD', accessor: (order: Order) => formatMoney(order.codAmount), width: '113px' },
    {
      header: 'LAST UPDATED BY',
      accessor: (order: Order) => (
        <div className="return-updated-cell">
          <span>{order.lastUpdatedBy || '-'}</span>
        </div>
      ),
      width: '155px',
    },
    { header: 'LAST UPDATED', accessor: (order: Order) => order.lastUpdatedAt || '-', width: '155px' },
    {
      header: 'STATUS',
      accessor: () => <StatusChip tone="neutral">{TAB_LABELS[activeTab]}</StatusChip>,
      width: '84px',
    },
  ];

  return (
    <div className="return-operations-container">
      <PageHeader title="Return" subtitle="Monitor your dispatch orders throughout the entire hub network." />

      <SegmentedTabs
        ariaLabel="Return operation filters"
        value={activeTab}
        onChange={setActiveTab}
        options={(Object.keys(TAB_LABELS) as ReturnTab[]).map((tab) => ({ value: tab, label: TAB_LABELS[tab] }))}
      />

      <div className="return-toolbar">
        <div />
        <div className="return-toolbar-actions">
          <Button
            variant="secondary"
            disabled={selectedIds.size === 0}
            title="Return status workflow is not connected yet"
          >
            Action{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </Button>
          <Button variant="secondary" onClick={downloadCsv}>
            <Download size={14} /> Download
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </Button>
        </div>
      </div>

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
        emptyMessage="No return orders found."
        minWidth="1130px"
        tableClassName="return-table"
      />

      <Pagination
        ariaLabel="Return pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  );
};

export default ReturnOperations;
