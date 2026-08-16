import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Pagination from '../../components/Pagination';
import StatusChip from '../../components/StatusChip';
import type { SettlementListItem } from '../../services/finance.service';
import { getSettlements } from '../../services/finance.service';
import { formatCurrency as formatCurrencyBase } from '../../utils/format';
import { toBsDate } from '../../utils/nepaliDate';
import { settlementStatusLabel, settlementStatusTone } from '../../utils/settlementStatus';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import './VendorFinance.css';

// The selector below the table goes up to 500, this endpoint's ceiling
// (finance.service MAX_PAGE_SIZE).
const PAGE_SIZE = 20;

const formatCurrency = (value: number) => formatCurrencyBase(value, 0);

const VendorSettlements: React.FC = () => {
  const navigate = useNavigate();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [items, setItems] = useState<SettlementListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const dateRangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);

  useEffect(() => {
    if (dateRangeInvalid) { setLoading(false); return; }

    let active = true;
    setLoading(true);
    setError('');

    getSettlements('vendor', undefined, page, pageSizeChoice, fromDate || undefined, toDate || undefined)
      .then((res) => {
        if (!active) return;
        setItems(res.data);
        setTotal(res.meta.total);
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
  }, [page, pageSizeChoice, fromDate, toDate, dateRangeInvalid]);

  const rows = items.map((item, index) => ({ ...item, sn: (page - 1) * pageSizeChoice + index + 1 }));

  const columns = [
    { header: 'SN', accessor: 'sn' as const, width: '60px' },
    {
      header: 'COD ID',
      accessor: (item: SettlementListItem) => (
        <button
          type="button"
          className="statement-id-link"
          onClick={() => navigate(`/finance/settlements/${item.id}`)}
        >
          {item.statementId}
        </button>
      ),
    },
    { header: 'TRANSFER DATE', accessor: (item: SettlementListItem) => toBsDate(item.transferDate) },
    { header: 'ORDERS', accessor: (item: SettlementListItem) => `${item.orderCount} order(s)` },
    { header: 'AMOUNT', accessor: (item: SettlementListItem) => formatCurrency(item.amount) },
    {
      header: 'STATUS',
      accessor: (item: SettlementListItem) => (
        <>
          <StatusChip variant="solid" tone={settlementStatusTone(item.status)}>
            {settlementStatusLabel(item.status)}
          </StatusChip>
          {/* The chip alone doesn't say how much of the payout has landed. */}
          {item.status === 'partially_paid' && (
            <div className="vendor-settlement-status-sub">
              {formatCurrency(item.paidAmount)} of {formatCurrency(item.amount)} received
            </div>
          )}
        </>
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
            <NepaliDatePicker
              value={fromDate}
              max={toDate || undefined}
              aria-label="From date"
              onChange={(next) => {
                setPage(1);
                setFromDate(next);
              }}
            />
          </label>
          <label>
            To
            <NepaliDatePicker
              value={toDate}
              min={fromDate || undefined}
              aria-label="To date"
              onChange={(next) => {
                setPage(1);
                setToDate(next);
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

      <Pagination
        ariaLabel="Settlements pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        pageSize={pageSizeChoice}
        pageSizeLabel="settlements"
        onPageSizeChange={(size) => {
          setPageSizeChoice(size);
          setPage(1);
        }}
        summary={`${total} settlement${total === 1 ? '' : 's'}`}
      />
    </div>
  );
};

export default VendorSettlements;
