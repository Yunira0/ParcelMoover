import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Pagination from '../../../components/Pagination';
import FilterDropdown from '../../../components/FilterDropdown';
import SearchField from '../../../components/SearchField';
import PeriodPicker from '../PeriodPicker';
import { Banner, PartyChip } from '../ui';
import { money } from '../format';
import { defaultRange, rangeParams, type RangeSelection } from '../range';
import { screenConfig } from '../screens';
import {
  listTransactions,
  type TransactionDirection,
  type TransactionList,
  type TransactionScope,
} from '../../../services/accounting.service';
import { apiErrorMessage } from '../../../utils/serverValidation';
import '../../../components/finance/tally.css';
import '../Accounting.css';

// The four Transactions screens, which are one screen asked four ways.
//
// Every one of them is "movements on some accounts, optionally one side of
// them": rider COD is account 1010, vendor COD is 2000, a cash payment is the
// credit side of 1000. Writing them as four components would have meant four
// copies of the same table drifting apart, so the shape is a prop and the
// server takes the same scope + direction pair.
//
// Line-level, not entry-level, and that distinction is the point: an entry that
// pays four expense categories out of cash is ONE cash payment. The journal
// screen next door is the entry-level view of the same data.
//
// Ruled as the register it is — the day book's own shape (JournalTab), not the
// dashboard table this used to borrow. Cash and bank are read a row at a time
// against a column of figures, and that reads better on paper rules than on
// card shadows.

const ALL_ACCOUNTS = 'all';

interface TransactionsTabProps {
  scope: TransactionScope;
  direction?: TransactionDirection;
}

const TransactionsTab: React.FC<TransactionsTabProps> = ({ scope, direction = 'all' }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const config = screenConfig(scope, direction);
  const bothSides = direction === 'all';

  const [range, setRange] = useState<RangeSelection>(defaultRange);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [accountCode, setAccountCode] = useState(searchParams.get('account') ?? ALL_ACCOUNTS);
  const [page, setPage] = useState(1);

  const [data, setData] = useState<TransactionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pageSize = 25;

  // All six screens are this one component in the same slot of the route tree,
  // so React keeps the instance alive when you move between them and the
  // filters would otherwise follow you across. Two of them do real damage: a
  // bank account code carried into the cash scope matches nothing and blanks
  // the table, and page 3 of the screen you left is usually past the end of the
  // one you arrived at. Re-seed from the new URL instead.
  const screenKey = `${scope}:${direction}`;
  const [lastScreen, setLastScreen] = useState(screenKey);
  if (screenKey !== lastScreen) {
    setLastScreen(screenKey);
    setPage(1);
    setSearch(searchParams.get('search') ?? '');
    setAccountCode(searchParams.get('account') ?? ALL_ACCOUNTS);
  }

  // Every screen resets to page 1 when the question changes, or you end up on
  // page 7 of a three-page result and it reads as empty.
  const changeFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await listTransactions({
          ...rangeParams(range),
          scope,
          direction,
          ...(accountCode !== ALL_ACCOUNTS ? { accountCode } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
          page,
          pageSize,
        }),
      );
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load these transactions'));
    } finally {
      setLoading(false);
    }
  }, [range, scope, direction, accountCode, search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // The picker only earns its place when there is a choice to make — one bank
  // account is not a filter, it is a fact.
  const showAccountPicker = scope === 'bank' && (data?.accounts.length ?? 0) > 1;

  // And the account column only when the rows can actually differ.
  const showAccount = showAccountPicker && accountCode === ALL_ACCOUNTS;

  const accountOptions = useMemo(
    () => [
      { value: ALL_ACCOUNTS, label: 'All bank accounts' },
      ...(data?.accounts ?? []).map((account) => ({ value: account.code, label: account.name })),
    ],
    [data],
  );

  const onSearchChange = (value: string) => {
    changeFilter(() => setSearch(value));
    const next = new URLSearchParams(searchParams);
    if (value) next.set('search', value);
    else next.delete('search');
    setSearchParams(next, { replace: true });
  };

  const onAccountChange = (value: string) => {
    changeFilter(() => setAccountCode(value));
    const next = new URLSearchParams(searchParams);
    if (value !== ALL_ACCOUNTS) next.set('account', value);
    else next.delete('account');
    setSearchParams(next, { replace: true });
  };

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  const baseCols = showAccount ? 6 : 5;
  const totalCols = baseCols + (bothSides ? 2 : 1);
  const rows = data?.rows ?? [];

  return (
    <>
      <div className="acc-toolbar">
        <div className="acc-filters">
          <label className="acc-filter-wide">
            <span>SEARCH</span>
            <SearchField
              value={search}
              onChange={onSearchChange}
              placeholder="Entry number or description"
            />
          </label>

          {showAccountPicker && (
            <div className="acc-filter">
              <FilterDropdown
                label="ACCOUNT"
                value={accountCode}
                options={accountOptions}
                onChange={onAccountChange}
                ariaLabel="Bank account"
              />
            </div>
          )}
        </div>

        <PeriodPicker value={range} onChange={(next) => changeFilter(() => setRange(next))} />
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      <div className="tly-scroll">
        <table className="tly-sheet">
          <thead>
            <tr>
              <th style={{ width: '9%' }}>Date (BS)</th>
              <th style={{ width: '11%' }}>Entry</th>
              <th>Description</th>
              {showAccount && <th style={{ width: '13%' }}>Account</th>}
              <th style={{ width: '17%' }}>
                {direction === 'out' ? 'Paid to' : direction === 'in' ? 'Received from' : 'Contra account'}
              </th>
              <th style={{ width: '15%' }}>{config.partyLabel}</th>
              {bothSides ? (
                <>
                  <th className="tly-amt">{config.debitLabel}</th>
                  <th className="tly-amt">{config.creditLabel}</th>
                </>
              ) : (
                <th className="tly-amt">Amount</th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={totalCols} className="tly-muted">Loading transactions…</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={totalCols} className="tly-muted">
                  {search
                    ? 'Nothing matches that search in this period.'
                    : `Nothing moved here during ${data?.range.label ?? 'this period'}.`}
                </td>
              </tr>
            )}
            {!loading && rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => navigate(`/accounting/transactions/journal?search=${encodeURIComponent(row.entryNo)}`)}
                style={{ cursor: 'pointer' }}
              >
                <td>{row.bsDate}</td>
                <td className="tly-muted">{row.entryNo}</td>
                <td>
                  {row.memo || '—'}
                  {row.trackingId && (
                    <>
                      <br />
                      <span className="tly-muted">{row.trackingId}</span>
                    </>
                  )}
                </td>
                {showAccount && <td className="tly-muted">{row.accountName}</td>}
                <td className="tly-muted">{row.contraAccounts || '—'}</td>
                <td>
                  {row.partyName ? (
                    <>
                      {row.partyName}
                      {row.partyType && (
                        <div style={{ marginTop: 4 }}>
                          <PartyChip>{row.partyType}</PartyChip>
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="tly-muted">—</span>
                  )}
                </td>
                {bothSides ? (
                  <>
                    <td className="tly-amt">{row.debit ? money(row.debit) : ''}</td>
                    <td className="tly-amt">{row.credit ? money(row.credit) : ''}</td>
                  </>
                ) : (
                  <td className="tly-amt">{money(direction === 'out' ? row.credit : row.debit)}</td>
                )}
              </tr>
            ))}
          </tbody>
          {data && rows.length > 0 && (
            <tfoot>
              <tr className="tly-grand">
                <td colSpan={baseCols}>
                  {data.total} transaction{data.total === 1 ? '' : 's'}
                </td>
                {bothSides ? (
                  <>
                    <td className="tly-amt">{money(data.totals.debit)}</td>
                    <td className="tly-amt">{money(data.totals.credit)}</td>
                  </>
                ) : (
                  <td className="tly-amt">{money(direction === 'out' ? data.totals.credit : data.totals.debit)}</td>
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          ariaLabel={`${config.title} pages`}
          summary={`${data?.total ?? 0} transaction${data?.total === 1 ? '' : 's'}`}
        />
      )}
    </>
  );
};

export default TransactionsTab;
