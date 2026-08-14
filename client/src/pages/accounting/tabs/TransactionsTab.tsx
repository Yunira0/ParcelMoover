import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Table from '../../../components/Table';
import StatCard from '../../../components/StatCard';
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

      {data && (
        <div className="acc-cards">
          {bothSides ? (
            <>
              <StatCard
                label={config.debitLabel}
                value={money(data.totals.debit)}
                hint={data.range.label}
              />
              <StatCard
                label={config.creditLabel}
                value={money(data.totals.credit)}
                hint={data.range.label}
              />
            </>
          ) : (
            <StatCard
              label={direction === 'out' ? 'Paid out' : 'Received'}
              value={money(direction === 'out' ? data.totals.credit : data.totals.debit)}
              tone={direction === 'out' ? 'negative' : 'positive'}
              hint={data.range.label}
            />
          )}
          <StatCard
            label="Transactions"
            value={data.total}
            tone="muted"
            hint={`Across ${data.accounts.length} account${data.accounts.length === 1 ? '' : 's'}`}
          />
        </div>
      )}

      <Table
        selectable={false}
        loading={loading}
        loadingMessage="Loading transactions…"
        data={data?.rows ?? []}
        onRowClick={(row) =>
          navigate(`/accounting/transactions/journal?search=${encodeURIComponent(row.entryNo)}`)
        }
        columns={[
          { header: 'Date (BS)', width: '110px', accessor: 'bsDate' },
          {
            header: 'Entry',
            width: '140px',
            accessor: (row) => <span className="acc-entry-no">{row.entryNo}</span>,
          },
          {
            header: 'Description',
            accessor: (row) => (
              <>
                {row.memo || '—'}
                {row.trackingId && <span className="acc-sub">{row.trackingId}</span>}
              </>
            ),
          },
          // Which bank account this landed in only matters when several are
          // being shown at once.
          ...(showAccount ? [{ header: 'Account', width: '160px', accessor: 'accountName' as const }] : []),
          {
            header: direction === 'out' ? 'Paid to' : direction === 'in' ? 'Received from' : 'Contra account',
            width: '190px',
            accessor: (row) => <span className="acc-muted">{row.contraAccounts || '—'}</span>,
          },
          {
            header: config.partyLabel,
            width: '180px',
            accessor: (row) =>
              row.partyName ? (
                <>
                  {row.partyName}
                  {row.partyType && (
                    <div style={{ marginTop: 4 }}>
                      <PartyChip>{row.partyType}</PartyChip>
                    </div>
                  )}
                </>
              ) : (
                <span className="acc-muted">—</span>
              ),
          },
          ...(bothSides
            ? [
                {
                  header: config.debitLabel,
                  width: '130px',
                  className: 'acc-num',
                  accessor: (row: TransactionList['rows'][number]) => (
                    <span className="acc-num">{row.debit ? money(row.debit) : ''}</span>
                  ),
                },
                {
                  header: config.creditLabel,
                  width: '130px',
                  className: 'acc-num',
                  accessor: (row: TransactionList['rows'][number]) => (
                    <span className="acc-num">{row.credit ? money(row.credit) : ''}</span>
                  ),
                },
              ]
            : [
                {
                  header: 'Amount',
                  width: '150px',
                  className: 'acc-num',
                  accessor: (row: TransactionList['rows'][number]) => (
                    <span className={`acc-num ${direction === 'out' ? 'acc-neg' : 'acc-pos'}`}>
                      {money(direction === 'out' ? row.credit : row.debit)}
                    </span>
                  ),
                },
              ]),
        ]}
        emptyMessage={
          search
            ? 'Nothing matches that search in this period.'
            : `Nothing moved here during ${data?.range.label ?? 'this period'}.`
        }
        footer={
          data ? (
            <tr>
              {/* Date, Entry, Description, [Account], Contra, Party — the
                  columns before the figures. */}
              <td colSpan={showAccount ? 6 : 5}>
                {data.total} transaction{data.total === 1 ? '' : 's'}
              </td>
              {bothSides ? (
                <>
                  <td className="acc-num">{money(data.totals.debit)}</td>
                  <td className="acc-num">{money(data.totals.credit)}</td>
                </>
              ) : (
                <td className={`acc-num ${direction === 'out' ? 'acc-neg' : 'acc-pos'}`}>
                  {money(direction === 'out' ? data.totals.credit : data.totals.debit)}
                </td>
              )}
            </tr>
          ) : undefined
        }
      />

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
