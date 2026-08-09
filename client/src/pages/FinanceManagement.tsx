import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import Table from '../components/Table';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import TicketCategoryButton from '../components/TicketCategoryButton';
import SegmentedTabs from '../components/SegmentedTabs';
import StatusChip from '../components/StatusChip';
import NepaliDatePicker from '../components/NepaliDatePicker';
import FormField from '../components/FormField';
import type { SearchableSelectAsyncResult } from '../components/SearchableSelectAsync';
import type { SettlementListItem, SettlementStatusFilter } from '../services/finance.service';
import { getSettlements } from '../services/finance.service';
import { getRiders, searchVendors } from '../services/users.service';
import { toBsDate } from '../utils/nepaliDate';
import './FinanceManagement.css';

type FinanceType = 'rider' | 'vendor';

// Starting rows-per-page. The selector below the table can change it; the
// server caps any value at 100 (finance.service MAX_PAGE_SIZE).
const PAGE_SIZE = 20;

const FinanceManagement: React.FC = () => {
  const navigate = useNavigate();
  const [activeType, setActiveType] = useState<FinanceType>('rider');
  const [riderOptions, setRiderOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [entityId, setEntityId] = useState('');
  const [status, setStatus] = useState<SettlementStatusFilter | ''>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [items, setItems] = useState<SettlementListItem[]>([]);
  const [page, setPage] = useState(1);
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const dateRangeInvalid = Boolean(fromDate && toDate && fromDate > toDate);

  // Rider list is small enough to fetch whole; vendors are searched
  // server-side instead (see handleVendorSearch below), same split
  // SettlementCreatePage already uses for its own rider/vendor picker.
  useEffect(() => {
    if (activeType !== 'rider') return;
    let active = true;
    getRiders()
      .then((res) => {
        if (!active || !res?.success || !Array.isArray(res.data)) return;
        setRiderOptions(res.data.map((r: any) => ({ value: r.id, label: r.name || '' })));
      })
      .catch(() => {
        if (active) setRiderOptions([]);
      });
    return () => {
      active = false;
    };
  }, [activeType]);

  const handleVendorSearch = async (search: string, offset: number): Promise<SearchableSelectAsyncResult> => {
    const res = await searchVendors(search, 50, offset);
    if (res?.success && Array.isArray(res.data)) {
      return {
        results: res.data.map((v: any) => ({ id: v.id, label: v.label })),
        hasMore: res.hasMore ?? false,
      };
    }
    return { results: [], hasMore: false };
  };

  useEffect(() => {
    if (dateRangeInvalid) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError('');

    getSettlements(
      activeType,
      entityId || undefined,
      page,
      pageSizeChoice,
      fromDate || undefined,
      toDate || undefined,
      status || undefined,
    )
      .then((res) => {
        if (!active) return;
        setItems(res.data);
        setTotalPages(res.meta.totalPages);
        setTotal(res.meta.total);
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
  }, [activeType, page, pageSizeChoice, entityId, fromDate, toDate, status, dateRangeInvalid]);

  const rows = useMemo(
    () => items.map((item, index) => ({ ...item, sn: (page - 1) * pageSizeChoice + index + 1 })),
    [items, page, pageSizeChoice],
  );

  const handleTypeChange = (type: FinanceType) => {
    setActiveType(type);
    setEntityId('');
    setPage(1);
  };

  const columns = [
    { header: 'SN', accessor: 'sn' as const, width: '50px' },
    {
      header: 'STATEMENT ID',
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
    { header: 'NAME', accessor: 'payeeName' as const },
    {
      header: 'AMOUNT',
      accessor: (item: SettlementListItem) => `Rs. ${item.amount.toLocaleString()}`,
    },
    { header: 'SETTLEMENT DATE', accessor: (item: SettlementListItem) => (item.transferDate ? toBsDate(item.transferDate) : '-') },
    {
      header: 'BANK DETAILS',
      accessor: (item: SettlementListItem) =>
        item.bankName || item.bankAccountNo || item.bankAccountHolder ? (
          <div style={{ fontSize: '12px', lineHeight: '1.6', color: 'var(--color-text-caption)' }}>
            <div><span style={{ fontWeight: 600, color: 'var(--color-text-default)' }}>Bank:</span> {item.bankName || '-'}</div>
            <div><span style={{ fontWeight: 600, color: 'var(--color-text-default)' }}>A/C:</span> {item.bankAccountNo || '-'}</div>
            <div><span style={{ fontWeight: 600, color: 'var(--color-text-default)' }}>Name:</span> {item.bankAccountHolder || '-'}</div>
          </div>
        ) : (
          '-'
        ),
    },
    { header: 'REMARK', accessor: (item: SettlementListItem) => item.remark || '-' },
    {
      header: 'STATUS',
      accessor: (item: SettlementListItem) => (
        <StatusChip
          variant="solid"
          tone={item.status === 'settled' ? 'success' : item.status === 'cancelled' ? 'neutral' : 'warning'}
        >
          {item.status === 'settled' ? 'Settled' : item.status === 'cancelled' ? 'Cancelled' : 'Pending'}
        </StatusChip>
      ),
    },
  ];

  return (
    <div className="finance-management-container">
      <PageHeader
        title="COD MANAGEMENT"
        subtitle="Manage financial accounts and monitor performance indicators."
        actionLabel="Add Settlement"
        actionIcon={<Plus size={16} />}
        onAction={() => navigate(`/finance/settlements/new?type=${activeType}`)}
      >
        <TicketCategoryButton category="cod_settlement" notificationType="cod_settlement" />
      </PageHeader>

      <div className="finance-filters">
        <SegmentedTabs
          ariaLabel="Finance account type"
          fullWidth={false}
          value={activeType}
          onChange={handleTypeChange}
          options={[
            { value: 'rider', label: 'RIDER' },
            { value: 'vendor', label: 'VENDOR' },
          ]}
        />

        <div className="finance-filter-row">
          <div className="finance-entity-filter">
            {activeType === 'rider' ? (
              <FormField
                label=""
                type="select"
                value={entityId}
                onChange={(value) => {
                  setPage(1);
                  setEntityId(value);
                }}
                placeholder="All riders"
                options={riderOptions}
              />
            ) : (
              <FormField
                label=""
                type="searchable-select-async"
                value={entityId}
                onChange={(value) => {
                  setPage(1);
                  setEntityId(value);
                }}
                placeholder="All vendors"
                searchPlaceholder="Search vendor by name..."
                asyncSearch={handleVendorSearch}
              />
            )}
          </div>

          <div className="finance-date-range">
            <NepaliDatePicker
              value={fromDate}
              max={toDate || undefined}
              placeholder="From date"
              aria-label="From date"
              onChange={(next) => {
                setPage(1);
                setFromDate(next);
              }}
            />
            <span className="finance-date-range-sep">–</span>
            <NepaliDatePicker
              value={toDate}
              min={fromDate || undefined}
              placeholder="To date"
              aria-label="To date"
              onChange={(next) => {
                setPage(1);
                setToDate(next);
              }}
            />
          </div>

          <select
            className="finance-status-select"
            aria-label="Status"
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value as SettlementStatusFilter | '');
            }}
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="settled">Settled</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {dateRangeInvalid && <p className="finance-error">"From" date must be before "To" date.</p>}
      {error && <p className="finance-error">{error}</p>}

      <Table
        columns={columns}
        data={rows}
        selectable={false}
        loading={loading}
        loadingMessage="Loading settlements..."
        emptyMessage="No finance records found."
      />

      <Pagination
        ariaLabel="Settlements pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        summary={`${total} statement${total !== 1 ? 's' : ''} total`}
        pageSize={pageSizeChoice}
        pageSizeLabel="statements"
        onPageSizeChange={(size) => {
          setPageSizeChoice(size);
          setPage(1);
        }}
      />
    </div>
  );
};

export default FinanceManagement;
