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
import { settlementStatusLabel, settlementStatusTone } from '../../../utils/settlementStatus';
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
  // Inclusive day range; either end can be left open. `dateField` picks which
  // column it applies to - Settled date or Created date.
  const [dateField, setDateField] = useState<'settled' | 'created'>('settled');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
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
      fromDate || undefined,
      toDate || undefined,
      status || undefined,
      undefined,
      dateField,
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
  }, [payeeType, page, payeeId, pageSize, dateField, fromDate, toDate, status]);

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
      {/* The drill-down and its date range on the left, status on the right.
          `acc-toolbar` is space-between, so the left-hand filters have to be
          one child to stay together — loose children would spread evenly
          across the bar and put the dates nowhere near the picker they
          belong with. */}
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

          {/* Which date the From/To range filters on. */}
          <label>
            <span>DATE</span>
            <FormField
              label=""
              type="select"
              value={dateField}
              onChange={(value) => applyFilter(() => setDateField(value as 'settled' | 'created'))}
              options={[
                { value: 'settled', label: 'Settled date' },
                { value: 'created', label: 'Created date' },
              ]}
            />
          </label>

          {/* min/max keep the pair from crossing - a To before From would
              just return nothing. */}
          <label aria-label="From date">
            <span>FROM</span>
            <NepaliDatePicker
              value={fromDate}
              max={toDate || undefined}
              onChange={(value) => applyFilter(() => setFromDate(value))}
              placeholder="Start date"
            />
          </label>
          <label aria-label="To date">
            <span>TO</span>
            <NepaliDatePicker
              value={toDate}
              min={fromDate || undefined}
              onChange={(value) => applyFilter(() => setToDate(value))}
              placeholder="End date"
            />
          </label>
        </div>

        <label>
          <span>STATUS</span>
          {/* Empty `label` on purpose: the CAPS caption is the wrapping
              <label><span>, the shape every filter panel in the app uses.
              Partially paid is its own state: those statements still owe
              money, so they are the ones a payout run has to find. */}
          <FormField
            label=""
            type="select"
            value={status}
            onChange={(value) => applyFilter(() => setStatus(value as SettlementStatusFilter | ''))}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'pending', label: 'Pending' },
              { value: 'partially_paid', label: 'Partially paid' },
              { value: 'settled', label: 'Settled' },
              { value: 'cancelled', label: 'Cancelled' },
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
          // When the statement was drawn up.
          {
            header: 'Created date',
            width: '125px',
            accessor: (item) => toBsDate(item.createdAt),
          },
          // The day the statement was actually paid off, not the date picked
          // when it was drawn up. Blank while pending or part-paid.
          {
            header: 'Settled date',
            width: '125px',
            accessor: (item) => (item.settledDate ? toBsDate(item.settledDate) : '—'),
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
            width: '150px',
            accessor: (item) => (
              <>
                <StatusChip variant="solid" tone={settlementStatusTone(item.status)}>
                  {settlementStatusLabel(item.status)}
                </StatusChip>
                {/* A part-paid row otherwise reads exactly like a pending one
                    beside its full amount. */}
                {item.status === 'partially_paid' && (
                  <span className="acc-sub">
                    {money(item.paidAmount)} of {money(Math.abs(item.amount))}
                  </span>
                )}
              </>
            ),
          },
          { header: 'Remark', width: '190px', accessor: (item) => item.remark || '—' },
        ]}
        // Every column is sized, so the table opts into fixed layout and scrolls
        // inside its own box rather than squeezing the payment figures. Vendor
        // carries the extra bank column, hence the wider floor.
        minWidth={payeeType === 'vendor' ? '1535px' : '1350px'}
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
