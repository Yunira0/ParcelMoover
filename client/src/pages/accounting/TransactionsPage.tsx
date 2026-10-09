import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import FilterDropdown from '../../components/FilterDropdown';
import Pagination from '../../components/Pagination';
import SearchField from '../../components/SearchField';
import PeriodPicker from './PeriodPicker';
import { defaultRange, rangeParams, type RangeSelection } from './range';
import { screenConfig } from './screens';
import {
  dayBookAction,
  exportAction,
  printAction,
  quitAction,
  voucherTypeOf,
} from '../../components/finance/tallyKeys';
import {
  listTransactions,
  type TransactionDirection,
  type TransactionList,
  type TransactionRow,
  type TransactionScope,
} from '../../services/accounting.service';
import { hasAdminPermission } from '../../utils/auth';
import { formatAmount } from '../../utils/format';
import { downloadExcel } from '../../utils/excel';
import { useBackOr } from '../../hooks/useBackOr';

// The cash and bank registers — Tally's Payment and Receipt Registers, one
// for each of cash and bank. Line-level, not entry-level: an entry that pays
// four expense categories out of cash is ONE cash payment here, and the Day
// Book is the entry-level view of the same data.
//
// Particulars is the other side of the entry — what the money was paid to or
// received from — with the person and the narration under it, as a register
// row reads in Tally.

const ALL_ACCOUNTS = 'all';

interface TransactionsPageProps {
  scope: TransactionScope;
  direction?: TransactionDirection;
}

const TransactionsPage: React.FC<TransactionsPageProps> = ({ scope, direction = 'all' }) => {
  const navigate = useNavigate();
  const goBack = useBackOr('/finance/cash-bank');
  const [searchParams, setSearchParams] = useSearchParams();
  const config = screenConfig(scope, direction);
  const bothSides = direction === 'all';
  const canWrite = (scope === 'cash' || scope === 'bank') && hasAdminPermission('ACCOUNTING_ACCESS');

  const [range, setRange] = useState<RangeSelection>(defaultRange);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [accountCode, setAccountCode] = useState(searchParams.get('account') ?? ALL_ACCOUNTS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [data, setData] = useState<TransactionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  // All four registers are this one component in the same slot of the route
  // tree, so React keeps the instance alive when you move between them. A bank
  // account code carried into the cash scope matches nothing, and page 3 of the
  // register you left is usually past the end of this one — re-seed instead.
  const screenKey = `${scope}:${direction}`;
  const [lastScreen, setLastScreen] = useState(screenKey);
  if (screenKey !== lastScreen) {
    setLastScreen(screenKey);
    setPage(1);
    setSearch(searchParams.get('search') ?? '');
    setAccountCode(searchParams.get('account') ?? ALL_ACCOUNTS);
  }

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
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [range, scope, direction, accountCode, search, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  // The picker only earns its place when there is a choice to make — one bank
  // account is not a filter, it is a fact. Likewise the account column.
  const showAccountPicker = scope === 'bank' && (data?.accounts.length ?? 0) > 1;
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

  // A hand-posted voucher on a register is a Payment or a Receipt by which
  // side of cash/bank it hit — that is what made it show up here.
  const vchType = (row: TransactionRow) =>
    row.sourceType === 'manual' ? (row.credit > 0 ? 'Payment' : 'Receipt') : voucherTypeOf(row.sourceType);

  const amountOf = (row: TransactionRow) => (direction === 'out' ? row.credit : row.debit);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const exportPage = useCallback(async () => {
    await downloadExcel(
      config.title.toLowerCase().replace(/\s+/g, '-'),
      config.title,
      ['Date', 'Particulars', 'Party', 'Vch Type', 'Vch No.', ...(bothSides ? ['Debit', 'Credit'] : ['Amount']), 'Narration'],
      rows.map((row) => [
        row.bsDate,
        row.contraAccounts,
        row.partyName ?? '',
        row.sourceType === 'manual' ? (row.credit > 0 ? 'Payment' : 'Receipt') : voucherTypeOf(row.sourceType),
        row.entryNo,
        ...(bothSides ? [row.debit || '', row.credit || ''] : [direction === 'out' ? row.credit : row.debit]),
        row.memo ?? '',
      ]),
    );
  }, [config.title, rows, bothSides, direction]);

  const ledgerCode = accountCode !== ALL_ACCOUNTS ? accountCode : scope === 'cash' ? '1000' : data?.accounts[0]?.code;

  const actions: TallyAction[] = useMemo(() => [
    ...(canWrite
      ? [
          { key: 'F5', label: 'Payment', onSelect: () => navigate(`/finance/voucher/new?type=payment&source=${scope}`), primary: direction === 'out' },
          { key: 'F6', label: 'Receipt', onSelect: () => navigate(`/finance/voucher/new?type=receipt&source=${scope}`), primary: direction === 'in' },
          { key: 'F7', label: 'Journal', onSelect: () => navigate('/finance/journal/new') },
        ]
      : []),
    {
      key: 'F8',
      label: 'Ledger',
      onSelect: () => ledgerCode && navigate(`/finance/ledger/${ledgerCode}`),
      disabled: !ledgerCode,
    },
    printAction(),
    exportAction(() => void exportPage(), rows.length === 0),
    dayBookAction(navigate),
    quitAction(goBack),
  ], [canWrite, navigate, scope, direction, ledgerCode, exportPage, rows.length, goBack]);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const cols = 4 + (showAccount ? 1 : 0) + (bothSides ? 2 : 1);

  const filters = (
    <>
      <label aria-label="Search">
        <span>SEARCH</span>
        <SearchField value={search} onChange={onSearchChange} placeholder="Vch no. or narration" />
      </label>
      {showAccountPicker && (
        <FilterDropdown
          label="ACCOUNT"
          value={accountCode}
          options={accountOptions}
          onChange={onAccountChange}
          ariaLabel="Bank account"
        />
      )}
      <PeriodPicker value={range} onChange={(next) => changeFilter(() => setRange(next))} />
    </>
  );

  return (
    <TallyPage
      title={config.title}
      period={data?.range.label}
      periodLabel="Period"
      actions={actions}
      filters={filters}
      error={error}
      menu
    >
      <div className="tly-voucher jv">
        <div className="jv-meta">
          <div className="jv-meta-field">
            <span>Account :</span>
            <strong>
              {accountCode !== ALL_ACCOUNTS
                ? data?.accounts.find((account) => account.code === accountCode)?.name ?? accountCode
                : scope === 'cash'
                  ? 'Cash in Hand'
                  : 'All bank accounts'}
            </strong>
          </div>
          <div className="jv-meta-field jv-meta-no">
            <span>Entries :</span>
            <strong>{data?.total ?? 0}</strong>
          </div>
        </div>

        <div className="tly-scroll">
          <table className="tly-sheet jv-sheet jv-report">
            <thead>
              <tr>
                <th style={{ width: '11%' }}>Date</th>
                <th className="jv-col-account">Particulars</th>
                {showAccount && <th style={{ width: '14%' }}>Account</th>}
                <th style={{ width: '10%' }}>Vch Type</th>
                <th style={{ width: '12%' }}>Vch No.</th>
                {bothSides ? (
                  <>
                    <th className="tly-amt">{config.debitLabel}</th>
                    <th className="tly-amt">{config.creditLabel}</th>
                  </>
                ) : (
                  <th className="tly-amt">{direction === 'out' ? 'Debit Amount' : 'Credit Amount'}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading && <tr className="jv-empty"><td colSpan={cols}>Loading…</td></tr>}
              {!loading && rows.length === 0 && (
                <tr className="jv-empty">
                  <td colSpan={cols}>
                    {search ? 'Nothing matches that search in this period.' : `Nothing moved here during ${data?.range.label ?? 'this period'}.`}
                  </td>
                </tr>
              )}
              {!loading && rows.map((row) => (
                <tr key={row.id} className="jv-row" onClick={() => navigate(`/finance/voucher/${row.entryId}`)}>
                  <td>{row.bsDate}</td>
                  <td>
                    {/* The ledger book's wording for the other side: "To" on
                        the debit side, "By" on the credit side. */}
                    <span className="jv-by">{row.debit > 0 ? 'To' : 'By'}</span>
                    <strong>{row.contraAccounts || '—'}</strong>
                    {row.partyName && <span className="tly-muted"> — {row.partyName}</span>}
                    {row.trackingId && <span className="tly-muted"> · {row.trackingId}</span>}
                    {row.memo && <span className="jv-narration">({row.memo})</span>}
                  </td>
                  {showAccount && <td className="tly-muted">{row.accountName}</td>}
                  <td>{vchType(row)}</td>
                  <td>{row.entryNo}</td>
                  {bothSides ? (
                    <>
                      <td className="tly-amt">{row.debit ? formatAmount(row.debit) : ''}</td>
                      <td className="tly-amt">{row.credit ? formatAmount(row.credit) : ''}</td>
                    </>
                  ) : (
                    <td className="tly-amt">{formatAmount(amountOf(row))}</td>
                  )}
                </tr>
              ))}
            </tbody>
            {data && rows.length > 0 && (
              <tfoot>
                <tr className="jv-foot-total jv-foot-closing">
                  <td colSpan={cols - (bothSides ? 2 : 1)} className="jv-foot-label">Total</td>
                  {bothSides ? (
                    <>
                      <td className="tly-amt">{formatAmount(data.totals.debit)}</td>
                      <td className="tly-amt">{formatAmount(data.totals.credit)}</td>
                    </>
                  ) : (
                    <td className="tly-amt">{formatAmount(direction === 'out' ? data.totals.credit : data.totals.debit)}</td>
                  )}
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="jv-pagination">
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            pageSize={pageSize}
            onPageSizeChange={(size) => changeFilter(() => setPageSize(size))}
            ariaLabel={`${config.title} pages`}
            summary={`${data?.total ?? 0} entr${data?.total === 1 ? 'y' : 'ies'}`}
          />
        </div>
      </div>
    </TallyPage>
  );
};

export default TransactionsPage;
