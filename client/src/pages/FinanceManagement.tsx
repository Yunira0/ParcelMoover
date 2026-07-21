import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import Table from '../components/Table';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import TicketCategoryButton from '../components/TicketCategoryButton';
import SegmentedTabs from '../components/SegmentedTabs';
import StatusChip from '../components/StatusChip';
import type { SettlementListItem } from '../services/finance.service';
import { getSettlements } from '../services/finance.service';
import { toBsDate } from '../utils/nepaliDate';
import './FinanceManagement.css';

type FinanceType = 'rider' | 'vendor';

const PAGE_SIZE = 20;

const FinanceManagement: React.FC = () => {
  const navigate = useNavigate();
  const [activeType, setActiveType] = useState<FinanceType>('rider');
  const [searchQuery, setSearchQuery] = useState('');
  const [items, setItems] = useState<SettlementListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    getSettlements(activeType, undefined, page, PAGE_SIZE)
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
  }, [activeType, page]);

  const rows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items
      .filter((item) => {
        if (!q) return true;
        return (
          item.statementId.toLowerCase().includes(q) ||
          item.payeeName.toLowerCase().includes(q) ||
          item.payeePhone.includes(q) ||
          (item.remark || '').toLowerCase().includes(q)
        );
      })
      .map((item, index) => ({ ...item, sn: (page - 1) * PAGE_SIZE + index + 1 }));
  }, [items, searchQuery, page]);

  const handleTypeChange = (type: FinanceType) => {
    setActiveType(type);
    setPage(1);
  };

  const columns = [
    { header: 'SN', accessor: 'sn' as const, width: '50px' },
    {
      header: 'STATEMENT ID',
      accessor: (item: SettlementListItem) => (
        <button
          type="button"
          onClick={() => navigate(`/finance/settlements/${item.id}`)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--color-primary)',
            textDecoration: 'underline',
            cursor: 'pointer',
            font: 'inherit',
          }}
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
        <StatusChip variant="solid" tone={item.status === 'settled' ? 'success' : 'warning'}>
          {item.status === 'settled' ? 'Settled' : 'Pending'}
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

        <div className="search-box">
          <Search size={16} style={{ color: 'var(--color-text-caption)' }} />
          <input
            type="text"
            placeholder="Search statement, name, phone"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
          />
        </div>
      </div>

      {error && <p className="finance-error">{error}</p>}

      <Table
        columns={columns}
        data={rows}
        selectable={false}
        loading={loading}
        loadingMessage="Loading settlements..."
        emptyMessage="No finance records found."
      />

      <Pagination ariaLabel="Settlements pagination" page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
};

export default FinanceManagement;
