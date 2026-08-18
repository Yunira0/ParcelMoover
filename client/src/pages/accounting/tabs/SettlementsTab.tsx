import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Table from '../../../components/Table';
import Pagination from '../../../components/Pagination';
import StatusChip from '../../../components/StatusChip';
import SearchField from '../../../components/SearchField';
import { Banner } from '../ui';
import { money } from '../format';
import { getSettlements, type SettlementListItem } from '../../../services/finance.service';
import { toBsDate } from '../../../utils/nepaliDate';
import '../Accounting.css';

// The payout statements — what used to be the whole COD Management screen.
//
// It sits beside the ledger movements rather than on its own page because they
// are two views of one thing: a rider settlement *is* the remittance that
// credits 1010, a vendor settlement *is* the payout that debits 2000. The
// statement is the document; the movement is what it did to the books.

const PAGE_SIZE = 20;

const SettlementsTab: React.FC<{ payeeType: 'rider' | 'vendor' }> = ({ payeeType }) => {
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [items, setItems] = useState<SettlementListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Back to page 1 when the other tab's party type arrives, or you land past
  // the end of a shorter list.
  useEffect(() => {
    setPage(1);
  }, [payeeType]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    getSettlements(payeeType, undefined, page, PAGE_SIZE)
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
  }, [payeeType, page]);

  // Filtered in the browser over the page already fetched, which is how this
  // screen has always behaved — the server pages, the box narrows what is here.
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items
      .filter((item) =>
        !needle
          ? true
          : item.statementId.toLowerCase().includes(needle) ||
            item.payeeName.toLowerCase().includes(needle) ||
            item.payeePhone.includes(needle) ||
            (item.remark || '').toLowerCase().includes(needle),
      )
      .map((item, index) => ({ ...item, sn: (page - 1) * PAGE_SIZE + index + 1 }));
  }, [items, search, page]);

  return (
    <>
      <div className="acc-toolbar">
        <label className="acc-filter-wide">
          <span>SEARCH</span>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Statement, name or phone"
          />
        </label>
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      <Table
        selectable={false}
        loading={loading}
        loadingMessage="Loading settlements…"
        data={rows}
        columns={[
          { header: 'SN', accessor: 'sn', width: '60px' },
          {
            header: 'Statement ID',
            width: '150px',
            accessor: (item) => (
              <button
                type="button"
                className="acc-link acc-entry-no"
                onClick={() => navigate(`/finance/settlements/${item.id}`)}
              >
                {item.statementId}
              </button>
            ),
          },
          { header: payeeType === 'rider' ? 'Rider' : 'Vendor', accessor: 'payeeName' },
          {
            header: 'Amount',
            width: '140px',
            className: 'acc-num',
            accessor: (item) => <span className="acc-num">{money(item.amount)}</span>,
          },
          {
            header: 'Settlement date',
            width: '140px',
            accessor: (item) => (item.transferDate ? toBsDate(item.transferDate) : '—'),
          },
          {
            header: 'Bank details',
            width: '210px',
            accessor: (item) =>
              item.bankName || item.bankAccountNo || item.bankAccountHolder ? (
                <>
                  {item.bankName || '—'}
                  <span className="acc-sub">A/C {item.bankAccountNo || '—'}</span>
                  <span className="acc-sub">{item.bankAccountHolder || '—'}</span>
                </>
              ) : (
                <span className="acc-muted">—</span>
              ),
          },
          { header: 'Remark', accessor: (item) => item.remark || '—' },
          {
            header: 'Status',
            width: '120px',
            accessor: (item) => (
              <StatusChip variant="solid" tone={item.status === 'settled' ? 'success' : 'warning'}>
                {item.status === 'settled' ? 'Settled' : 'Pending'}
              </StatusChip>
            ),
          },
        ]}
        emptyMessage={
          search
            ? 'No settlement on this page matches that search.'
            : `No ${payeeType} settlements recorded yet.`
        }
      />

      {totalPages > 1 && (
        <Pagination
          ariaLabel="Settlements pagination"
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      )}
    </>
  );
};

export default SettlementsTab;
