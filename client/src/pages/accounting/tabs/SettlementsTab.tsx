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
import FormField from '../../../components/FormField';
import NepaliDatePicker from '../../../components/NepaliDatePicker';
import {
  getSettlements,
  type SettlementListItem,
  type SettlementStatusFilter,
} from '../../../services/finance.service';
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

/** A row as the table sees it: the statement plus its serial number on the page. */
type SettlementRow = SettlementListItem & { sn: number };

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
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Status, settlement date and page size, carried over from the COD Management
  // screen this replaced. All three are applied server-side, so they narrow the
  // whole list rather than the page already fetched.
  const [status, setStatus] = useState<SettlementStatusFilter | ''>('');
  // One date, not a range: settlement_date is a date column, so the same value
  // goes in as both bounds and matches that day exactly.
  const [settlementDate, setSettlementDate] = useState('');
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

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

    getSettlements(
      payeeType,
      payeeId || undefined,
      page,
      pageSize,
      settlementDate || undefined,
      settlementDate || undefined,
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
  }, [payeeType, page, payeeId, pageSize, settlementDate, status]);

  const rows: SettlementRow[] = useMemo(
    () => items.map((item, index) => ({ ...item, sn: (page - 1) * pageSize + index + 1 })),
    [items, page, pageSize],
  );

  /** Any filter change puts you back on page 1 — page 4 of the old result is meaningless. */
  const applyFilter = (change: () => void) => {
    change();
    setPage(1);
  };

  return (
    <>
      {/* The drill-down and its date on the left, status on the right.
          `acc-toolbar` is space-between, so the two left-hand filters have to
          be one child to stay together — three loose children would spread
          evenly across the bar and put the date nowhere near the picker it
          belongs with. */}
      <div className="acc-toolbar">
        <div className="acc-filters">
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

          <label>
            <span>SETTLEMENT DATE</span>
            <NepaliDatePicker
              value={settlementDate}
              onChange={(value) => applyFilter(() => setSettlementDate(value))}
            />
          </label>
        </div>

        <label>
          <span>STATUS</span>
          {/* Empty `label` on purpose: the CAPS caption is the wrapping
              <label><span>, the shape every filter panel in the app uses.

              Settled and Pending only. `cancelled` is accepted by the API but
              left out on purpose — a cancelled statement is withdrawn, not a
              state anyone browses the list for. `partially_paid` is not in the
              API's accepted set at all, so offering it would 400. */}
          <FormField
            label=""
            type="select"
            value={status}
            onChange={(value) => applyFilter(() => setStatus(value as SettlementStatusFilter | ''))}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'settled', label: 'Settled' },
              { value: 'pending', label: 'Pending' },
            ]}
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
            width: '185px',
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
          { header: payeeType === 'rider' ? 'Rider' : 'Vendor', width: '200px', accessor: 'payeeName' },
          {
            header: 'Amount',
            width: '130px',
            className: 'acc-num',
            accessor: (item) => <span className="acc-num">{money(item.amount)}</span>,
          },
          {
            header: 'Settlement date',
            width: '125px',
            accessor: (item) => (item.transferDate ? toBsDate(item.transferDate) : '—'),
          },
          // Vendors only, and this is the one place it earns its width: a payout
          // is money the office has to *send* somewhere, so whoever makes the
          // transfer reads the account off this row. A rider settlement is cash
          // handed over a counter — there is nothing to send, and the column was
          // three lines of em dashes.
          //
          // Comes straight from the vendor record (bank_name / bank_account_no /
          // bank_account_holder), captured when the vendor was created.
          ...(payeeType === 'vendor'
            ? [
                {
                  header: 'Bank details',
                  width: '185px',
                  accessor: (item: SettlementRow) => {
                    // Only the parts that are filled in. Rendering an em dash
                    // for a missing account holder cost a whole extra line of
                    // row height to say nothing — and because most vendors have
                    // a bank and an account but no holder recorded, it made
                    // every other row three lines tall.
                    const lines = [
                      item.bankName,
                      item.bankAccountNo && `A/C ${item.bankAccountNo}`,
                      item.bankAccountHolder,
                    ].filter(Boolean) as string[];

                    if (lines.length === 0) return <span className="acc-muted">Not on file</span>;
                    return lines.map((line) => (
                      <span key={line} className="acc-stack">
                        {line}
                      </span>
                    ));
                  },
                },
              ]
            : []),
          // Where the money actually went, which the bank details cannot say:
          // the account on file is the same on every row, while the split across
          // methods is what differs statement to statement and what anyone
          // reconciling against a bank statement is looking for.
          {
            header: 'Payment',
            width: '185px',
            accessor: (item) =>
              item.paymentBreakdown.length > 0 ? (
                <>
                  {item.paymentBreakdown.map((line) => (
                    // `acc-stack`, not `acc-sub`: these lines are the column's
                    // content, so they take the table's own font size and
                    // colour rather than the smaller grey of a footnote.
                    <span key={line.method} className="acc-stack">
                      {line.method} - {money(line.amount)}
                    </span>
                  ))}
                </>
              ) : (
                <span className="acc-muted">Not paid</span>
              ),
          },
          // Status then Remark, last two. The remark is free text of any length,
          // so it goes at the end where it can run on without pushing a fixed
          // column off the edge — and status sits beside it, where the eye
          // finishes the row.
          {
            header: 'Status',
            width: '110px',
            accessor: (item) => (
              <StatusChip variant="solid" tone={item.status === 'settled' ? 'success' : 'warning'}>
                {item.status === 'settled' ? 'Settled' : 'Pending'}
              </StatusChip>
            ),
          },
          { header: 'Remark', width: '190px', accessor: (item) => item.remark || '—' },
        ]}
        // Every column is sized, so the table opts into fixed layout and scrolls
        // inside its own box rather than squeezing the payment figures. Vendor
        // carries the extra bank column, hence the wider floor.
        minWidth={payeeType === 'vendor' ? '1370px' : '1185px'}
        emptyMessage={
          payeeId
            ? `No settlements recorded for that ${payeeType} yet.`
            : `No ${payeeType} settlements recorded yet.`
        }
      />

      <Pagination
        ariaLabel="Settlements pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => applyFilter(() => setPageSize(size))}
        summary={`${total} settlement${total === 1 ? '' : 's'}`}
      />
    </>
  );
};

export default SettlementsTab;
