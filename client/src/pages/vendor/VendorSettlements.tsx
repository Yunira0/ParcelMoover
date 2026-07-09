import React, { useEffect, useState } from 'react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Pagination from '../../components/Pagination';
import StatusChip from '../../components/StatusChip';
import type { SettlementListItem } from '../../services/finance.service';
import { getSettlements } from '../../services/finance.service';
import { formatCurrency as formatCurrencyBase, formatDate } from '../../utils/format';
import './VendorFinance.css';

const PAGE_SIZE = 20;

const formatCurrency = (value: number) => formatCurrencyBase(value, 0);

const VendorSettlements: React.FC = () => {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<SettlementListItem[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const dateRangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);

  useEffect(() => {
    if (dateRangeInvalid) { setLoading(false); return; }

    let active = true;
    setLoading(true);
    setError('');

    getSettlements(page, PAGE_SIZE, fromDate || undefined, toDate || undefined)
      .then((res) => {
        if (!active) return;
        setItems(res.data);
        setTotalPages(res.meta.totalPages);
      })
      .catch((err) => {
        if (active) setError(err?.response?.data?.message || 'Failed to load settlements.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fromDate, toDate, dateRangeInvalid]);

  const rows = items.map((item, index) => ({ ...item, sn: (page - 1) * PAGE_SIZE + index + 1 }));

  const columns = [
    { header: 'SN', accessor: 'sn' as const, width: '60px' },
    { header: 'COD ID', accessor: 'statementId' as const },
    { header: 'TRANSFER DATE', accessor: (item: SettlementListItem) => formatDate(item.transferDate) },
    { header: 'ORDERS', accessor: (item: SettlementListItem) => `${item.orderCount} order(s)` },
    { header: 'AMOUNT', accessor: (item: SettlementListItem) => formatCurrency(item.amount) },
    {
      header: 'STATUS',
      accessor: (item: SettlementListItem) => (
        <StatusChip variant="solid" tone={item.status === 'settled' ? 'success' : 'warning'}>
          {item.status === 'settled' ? 'Settled' : 'Pending'}
        </StatusChip>
      ),
    },
    { header: 'REMARK', accessor: (item: SettlementListItem) => item.remark || '-' },
  ];

  return (
    <div className="vendor-finance-page">
      <PageHeader title="Settlements" subtitle="Oversee and monitor your payouts throughout the settlement network." />

      <div className="vendor-finance-toolbar">
        <div className="vendor-finance-date-range">
          <label>
            From
            <input
              type="date"
              value={fromDate}
              max={toDate || undefined}
              onChange={(event) => {
                setPage(1);
                setFromDate(event.target.value);
              }}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={toDate}
              min={fromDate || undefined}
              onChange={(event) => {
                setPage(1);
                setToDate(event.target.value);
              }}
            />
          </label>
        </div>
      </div>

      {dateRangeInvalid && <p className="vendor-finance-error">"From" date must be before "To" date.</p>}
      {error && <p className="vendor-finance-error">{error}</p>}

      <Table
        columns={columns}
        data={rows}
        selectable={false}
        loading={loading}
        loadingMessage="Loading settlements..."
        emptyMessage="No settlements found."
      />

      <Pagination ariaLabel="Settlements pagination" page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
};

export default VendorSettlements;
