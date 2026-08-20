import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import Table from '../../../components/Table';
import Pagination from '../../../components/Pagination';
import StatusChip from '../../../components/StatusChip';
import Button from '../../../components/Button';
import SearchableSelectAsync, {
  type SearchableSelectAsyncOption,
  type SearchableSelectAsyncResult,
} from '../../../components/SearchableSelectAsync';
import { Banner } from '../ui';
import { money } from '../format';
import { getSettlements, type SettlementListItem } from '../../../services/finance.service';
import { getRiders, searchVendors } from '../../../services/users.service';
import { toBsDate } from '../../../utils/nepaliDate';
import '../Accounting.css';

// The payout statements — what used to be the whole COD Management screen.
//
// It sits beside the ledger movements rather than on its own page because they
// are two views of one thing: a rider settlement *is* the remittance that
// credits 1010, a vendor settlement *is* the payout that debits 2000. The
// statement is the document; the movement is what it did to the books.

const PAGE_SIZE = 20;
// One page of picker options per fetch; it loads more as the list is scrolled.
const PICKER_PAGE_SIZE = 50;

const SettlementsTab: React.FC<{ payeeType: 'rider' | 'vendor' }> = ({ payeeType }) => {
  const navigate = useNavigate();

  // The party whose statements are listed. Filtered server-side, unlike the
  // text box this replaced: that one narrowed the page already fetched, so a
  // vendor whose settlements sat on page 3 could not be found from page 1.
  const [payeeId, setPayeeId] = useState('');
  // The picker only knows a name while that party is in its last fetched page,
  // so the label for the current selection is kept here instead.
  const [payeeLabel, setPayeeLabel] = useState('');
  const payeeLabelsRef = useRef<Map<string, string>>(new Map());
  const [items, setItems] = useState<SettlementListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Back to page 1 when the other tab's party type arrives, or you land past
  // the end of a shorter list. The selected party goes with it - a rider id
  // means nothing to the vendor list.
  useEffect(() => {
    setPage(1);
    setPayeeId('');
    setPayeeLabel('');
  }, [payeeType]);

  // Memoised: SearchableSelectAsync re-runs its debounced fetch whenever this
  // identity changes, so an inline arrow would refetch on every render.
  const searchPayees = useCallback(
    async (term: string, offset: number): Promise<SearchableSelectAsyncResult> => {
      let results: SearchableSelectAsyncOption[] = [];
      let hasMore = false;

      if (payeeType === 'vendor') {
        const res = await searchVendors(term, PICKER_PAGE_SIZE, offset);
        if (res?.success && Array.isArray(res.data)) {
          results = res.data.map((vendor: { id: string; label: string }) => ({
            id: vendor.id,
            label: vendor.label,
          }));
          hasMore = res.hasMore ?? false;
        }
      } else {
        // Riders have no dedicated dropdown endpoint - the paged list takes a
        // search term, which is the same thing one page at a time.
        const res = await getRiders({
          search: term || undefined,
          page: Math.floor(offset / PICKER_PAGE_SIZE) + 1,
          pageSize: PICKER_PAGE_SIZE,
        });
        if (res?.success && Array.isArray(res.data)) {
          results = res.data.map((rider: { id: string; name: string; phone?: string }) => ({
            id: rider.id,
            label: rider.name || '',
            description: rider.phone || undefined,
          }));
          hasMore = res.meta ? res.meta.page < res.meta.totalPages : false;
        }
      }

      // Remember the names on the way past - onChange only hands back an id.
      results.forEach((option) => payeeLabelsRef.current.set(option.id, option.label));
      return { results, hasMore };
    },
    [payeeType],
  );

  const selectPayee = useCallback((id: string) => {
    setPayeeId(id);
    setPayeeLabel(id ? payeeLabelsRef.current.get(id) ?? '' : '');
    setPage(1);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');

    getSettlements(payeeType, payeeId || undefined, page, PAGE_SIZE)
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
  }, [payeeType, page, payeeId]);

  const rows = useMemo(
    () => items.map((item, index) => ({ ...item, sn: (page - 1) * PAGE_SIZE + index + 1 })),
    [items, page],
  );

  return (
    <>
      <div className="acc-toolbar">
        <label className="acc-filter-wide">
          <span>{payeeType === 'rider' ? 'RIDER' : 'VENDOR'}</span>
          <div className="acc-payee-filter">
            <SearchableSelectAsync
              asyncSearch={searchPayees}
              value={payeeId}
              onChange={selectPayee}
              initialLabel={payeeLabel}
              placeholder={payeeType === 'rider' ? 'All riders' : 'All vendors'}
              searchPlaceholder={`Search ${payeeType} by name...`}
              emptyMessage={`No ${payeeType}s found.`}
            />
            {/* The picker has no way back to "all" once a party is chosen, and
                the filter is server-side, so an empty result is a dead end. */}
            {payeeId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => selectPayee('')}
                aria-label={`Clear ${payeeType} filter`}
              >
                <X size={14} />
              </Button>
            )}
          </div>
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
          payeeId
            ? `No settlements recorded for that ${payeeType} yet.`
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
