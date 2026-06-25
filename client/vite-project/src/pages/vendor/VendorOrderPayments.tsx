import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Pagination from '../../components/Pagination';
import SegmentedTabs from '../../components/SegmentedTabs';
import StatusChip from '../../components/StatusChip';
import Button from '../../components/Button';
import type { OrderCodItem, CodPaymentFilter } from '../../services/finance.service';
import { getOrderCod } from '../../services/finance.service';
import './VendorFinance.css';

type TabValue = 'all' | CodPaymentFilter;
const PAGE_SIZE = 20;

const formatCurrency = (value: number) => `Rs. ${value.toLocaleString()}`;
const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : '-');

const escapeCsvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

const VendorOrderPayments: React.FC = () => {
  const [tab, setTab] = useState<TabValue>('all');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<OrderCodItem[]>([]);
  const [settledCount, setSettledCount] = useState(0);
  const [notSettledCount, setNotSettledCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setPage(1);
  }, [tab]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    getOrderCod(tab === 'all' ? undefined : tab, page, PAGE_SIZE)
      .then((res) => {
        if (!active) return;
        setItems(res.data);
        setSettledCount(res.settledCount);
        setNotSettledCount(res.notSettledCount);
        setTotalPages(res.meta.totalPages);
      })
      .catch((err) => {
        if (active) setError(err?.response?.data?.message || 'Failed to load order payments.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tab, page]);

  const handleExport = () => {
    if (items.length === 0) return;

    const header = ['Tracking ID', 'Receiver', 'Phone', 'Created At', 'Delivered Date', 'Status', 'Net Payable'];
    const rows = items.map((item) => [
      item.trackingId,
      item.receiverName,
      item.receiverPhone,
      formatDate(item.createdAt),
      formatDate(item.deliveredAt),
      item.status === 'settled' ? 'Settled' : 'Not Settled',
      item.netPayable.toFixed(2),
    ]);
    const csv = [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `order-cod-${tab}-page-${page}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const rows = items.map((item, index) => ({ ...item, sn: (page - 1) * PAGE_SIZE + index + 1 }));

  const columns = [
    { header: 'SN', accessor: 'sn' as const, width: '60px' },
    { header: 'TRACKING ID', accessor: 'trackingId' as const },
    {
      header: 'RECEIVER NAME',
      accessor: (item: OrderCodItem) => (
        <div>
          <div>{item.receiverName}</div>
          <div className="vendor-finance-subtext">{item.receiverPhone}</div>
        </div>
      ),
    },
    { header: 'CREATED AT', accessor: (item: OrderCodItem) => formatDate(item.createdAt) },
    { header: 'DELIVERED DATE', accessor: (item: OrderCodItem) => formatDate(item.deliveredAt) },
    {
      header: 'STATUS',
      accessor: (item: OrderCodItem) => (
        <StatusChip variant="solid" tone={item.status === 'settled' ? 'success' : 'warning'}>
          {item.status === 'settled' ? 'Settled' : 'Not Settled'}
        </StatusChip>
      ),
    },
    { header: 'NET PAYABLE', accessor: (item: OrderCodItem) => formatCurrency(item.netPayable) },
  ];

  return (
    <div className="vendor-finance-page">
      <PageHeader
        title="Order's COD"
        subtitle="Oversee and monitor your package orders based on the order-wise payment system for cash on delivery."
      />

      <div className="vendor-finance-toolbar">
        <SegmentedTabs
          ariaLabel="Order COD status"
          fullWidth={false}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'all', label: 'All' },
            { value: 'settled', label: `Settled ${settledCount}` },
            { value: 'not_settled', label: `Not Settled ${notSettledCount}` },
          ]}
        />
        <Button variant="outline" onClick={handleExport} disabled={items.length === 0}>
          Export
          <Download size={16} />
        </Button>
      </div>

      {error && <p className="vendor-finance-error">{error}</p>}

      <Table
        columns={columns}
        data={rows}
        selectable={false}
        loading={loading}
        loadingMessage="Loading order payments..."
        emptyMessage="No orders found for this filter."
      />

      <Pagination
        ariaLabel="Order COD pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
      />
    </div>
  );
};

export default VendorOrderPayments;
