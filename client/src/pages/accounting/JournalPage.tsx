import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import FilterDropdown from '../../components/FilterDropdown';
import Pagination from '../../components/Pagination';
import SearchField from '../../components/SearchField';
import PeriodPicker from './PeriodPicker';
import { rangeParams, type RangeSelection } from './range';
import {
  exportAction,
  manualVoucherType,
  printAction,
  quitAction,
  voucherActions,
  voucherTypeOf,
} from '../../components/finance/tallyKeys';
import { listJournal, type JournalEntry } from '../../services/accounting.service';
import { listAccounts } from '../../queries/lookups';
import { hasAdminPermission } from '../../utils/auth';
import { formatAmount } from '../../utils/format';
import { downloadExcel } from '../../utils/excel';
import { useBackOr } from '../../hooks/useBackOr';

/**
 * The Day Book, as TallyPrime lays it out: Date, Particulars, Vch Type,
 * Vch No., Debit and Credit, one row per voucher. Particulars is the voucher's
 * first ledger; Alt+F5 switches to Detailed, which lists every ledger in the
 * voucher under it with the narration, the way Tally's detailed day book does.
 *
 * A row opens the voucher. Cancelling (reversing) one is done there, as Tally
 * does it from the voucher rather than from the list.
 */

const SOURCE_LABELS: Record<string, string> = {
  cod_collection: 'COD collected',
  parcel: 'Delivery charge',
  settlement: 'Settlement',
  branch_settlement: 'Branch COD',
  carrier_settlement: '3PL COD',
  vendor_payment: 'Vendor payment',
  expense: 'Expense',
  manual: 'Manual entry',
  reversal: 'Reversal',
  opening_balance: 'Opening balance',
};

const SOURCE_OPTIONS = [
  { value: 'all', label: 'All sources' },
  ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label })),
];

const STATUS_OPTIONS = [
  { value: 'posted', label: 'Posted only' },
  { value: 'voided', label: 'Cancelled only' },
  { value: 'all', label: 'Posted and cancelled' },
];

/** What the title band's period box says for the window picked. */
const rangeLabel = (range: RangeSelection) => {
  if (range.mode === 'period' && range.period) return range.period;
  if (range.mode === 'fiscalYear' && range.fiscalYear) return `FY ${range.fiscalYear}`;
  if (range.from || range.to) return `${range.from || '…'} to ${range.to || '…'}`;
  return 'All dates';
};

/** Tally puts the voucher's amount on the side of its first ledger. */
const sideOf = (entry: JournalEntry) => ((entry.lines[0]?.debit ?? 0) > 0 ? 'debit' : 'credit');

const JournalPage: React.FC = () => {
  const navigate = useNavigate();
  const goBack = useBackOr('/accounting');
  const canWrite = hasAdminPermission('ACCOUNTING_ACCESS');
  const [searchParams, setSearchParams] = useSearchParams();

  // A range is optional here, unlike the reports: the common use is "find this
  // voucher", which should not be scoped to a month by default.
  const [range, setRange] = useState<RangeSelection>({ mode: 'custom' });
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [sourceType, setSourceType] = useState('all');
  const [status, setStatus] = useState('posted');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [detailed, setDetailed] = useState(true);

  const [data, setData] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [cashBankCodes, setCashBankCodes] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listJournal({
        ...rangeParams(range),
        page,
        pageSize,
        search: search.trim() || undefined,
        sourceType: sourceType === 'all' ? undefined : sourceType,
        status,
      });
      setData(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [range, page, pageSize, search, sourceType, status]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listAccounts('cash_bank')
      .then((rows) => setCashBankCodes(new Set(rows.map((row) => row.code))))
      .catch(() => {
        // Only sharpens "Journal" into Payment/Receipt for hand-posted
        // vouchers; the book is still readable without it.
      });
  }, []);

  const onSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
    const next = new URLSearchParams(searchParams);
    if (value) next.set('search', value);
    else next.delete('search');
    setSearchParams(next, { replace: true });
  };

  const vchType = useCallback(
    (entry: JournalEntry) =>
      // A hand-posted voucher or a settlement is a Payment or Receipt by which
      // way it moved cash; the source alone doesn't say.
      entry.sourceType === 'manual' || entry.sourceType === 'settlement'
        ? manualVoucherType(entry.lines, cashBankCodes)
        : voucherTypeOf(entry.sourceType),
    [cashBankCodes],
  );

  const pageTotals = useMemo(
    () =>
      data
        .filter((entry) => entry.status === 'posted')
        .reduce(
          (sum, entry) =>
            sideOf(entry) === 'debit'
              ? { ...sum, debit: sum.debit + entry.totalAmount }
              : { ...sum, credit: sum.credit + entry.totalAmount },
          { debit: 0, credit: 0 },
        ),
    [data],
  );

  const exportPage = useCallback(async () => {
    await downloadExcel(
      'day-book',
      'Day Book',
      ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit', 'Credit', 'Narration'],
      data.map((entry) => {
        const first = entry.lines[0];
        const debit = sideOf(entry) === 'debit';
        return [
          entry.bsDate,
          first ? `${first.accountName}${first.partyName ? ` — ${first.partyName}` : ''}` : '',
          vchType(entry),
          entry.entryNo,
          debit ? entry.totalAmount : '',
          debit ? '' : entry.totalAmount,
          entry.memo ?? '',
        ];
      }),
    );
  }, [data, vchType]);

  const actions: TallyAction[] = useMemo(() => [
    ...(canWrite ? voucherActions(navigate) : []),
    { key: 'Alt+F5', label: detailed ? 'Condensed' : 'Detailed', onSelect: () => setDetailed((value) => !value) },
    printAction(),
    exportAction(() => void exportPage(), data.length === 0),
    quitAction(goBack),
  ], [canWrite, navigate, detailed, exportPage, data.length, goBack]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const filters = (
    <>
      <label aria-label="Search vouchers">
        <span>SEARCH</span>
        <SearchField value={search} onChange={onSearchChange} placeholder="Vch no. or narration" />
      </label>
      <FilterDropdown
        label="SOURCE"
        value={sourceType}
        options={SOURCE_OPTIONS}
        onChange={(value) => { setSourceType(value); setPage(1); }}
        ariaLabel="Voucher source"
      />
      <FilterDropdown
        label="STATUS"
        value={status}
        options={STATUS_OPTIONS}
        onChange={(value) => { setStatus(value); setPage(1); }}
        ariaLabel="Voucher status"
      />
      <PeriodPicker value={range} onChange={(next) => { setRange(next); setPage(1); }} />
    </>
  );

  return (
    <TallyPage
      title="Day Book"
      period={rangeLabel(range)}
      periodLabel="Period"
      actions={actions}
      filters={filters}
      error={error}
      menu
    >
      <div className="tly-voucher jv">
        <div className="jv-meta">
          <div className="jv-meta-field">
            <span>View :</span>
            <strong>{detailed ? 'Detailed' : 'Condensed'}</strong>
          </div>
          <div className="jv-meta-field jv-meta-no">
            <span>Vouchers :</span>
            <strong>{total}</strong>
          </div>
        </div>

        <div className="tly-scroll">
          <table className="tly-sheet jv-sheet jv-report">
            <thead>
              <tr>
                <th style={{ width: '11%' }}>Date</th>
                <th className="jv-col-account">Particulars</th>
                <th style={{ width: '11%' }}>Vch Type</th>
                <th style={{ width: '13%' }}>Vch No.</th>
                <th className="tly-amt">Debit Amount</th>
                <th className="tly-amt">Credit Amount</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr className="jv-empty"><td colSpan={6}>Loading vouchers…</td></tr>
              )}
              {!loading && data.length === 0 && (
                <tr className="jv-empty"><td colSpan={6}>No vouchers match.</td></tr>
              )}
              {!loading && data.map((entry) => {
                const first = entry.lines[0];
                const debit = sideOf(entry) === 'debit';
                const voided = entry.status !== 'posted';
                return (
                  <React.Fragment key={entry.id}>
                    <tr
                      className={voided ? 'jv-row jv-row-voided' : 'jv-row'}
                      onClick={() => navigate(`/finance/voucher/${entry.id}`)}
                    >
                      <td>{entry.bsDate}</td>
                      <td>
                        <strong>{first?.accountName ?? entry.memo ?? 'Journal entry'}</strong>
                        {first?.partyName && <span className="tly-muted"> — {first.partyName}</span>}
                        {voided && <span className="tly-muted"> (Cancelled)</span>}
                      </td>
                      <td>{vchType(entry)}</td>
                      <td>{entry.entryNo}</td>
                      <td className="tly-amt">{debit ? formatAmount(entry.totalAmount) : ''}</td>
                      <td className="tly-amt">{debit ? '' : formatAmount(entry.totalAmount)}</td>
                    </tr>
                    {detailed && (
                      <>
                        {entry.lines.map((line, index) => (
                          <tr key={index} className="jv-sub">
                            <td />
                            <td className="jv-sub-name">
                              <span className="jv-by">{line.debit > 0 ? 'Dr' : 'Cr'}</span>
                              {line.accountName}
                              {line.partyName && <> — {line.partyName}</>}
                              {line.trackingId && <> · {line.trackingId}</>}
                            </td>
                            <td />
                            <td />
                            <td className="tly-amt">{line.debit > 0 ? formatAmount(line.debit) : ''}</td>
                            <td className="tly-amt">{line.credit > 0 ? formatAmount(line.credit) : ''}</td>
                          </tr>
                        ))}
                        {entry.memo && (
                          <tr className="jv-sub">
                            <td />
                            <td className="jv-sub-name" colSpan={5}>
                              <span className="jv-narration">
                                ({entry.memo}){entry.postedByName && <> · by {entry.postedByName}</>}
                                {entry.reversalOfNo && <> · cancels {entry.reversalOfNo}</>}
                              </span>
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            {!loading && data.length > 0 && (
              <tfoot>
                <tr className="jv-foot-total">
                  <td colSpan={4} className="jv-foot-label">Total (this page)</td>
                  <td className="tly-amt">{formatAmount(pageTotals.debit)}</td>
                  <td className="tly-amt">{formatAmount(pageTotals.credit)}</td>
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
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            ariaLabel="Day book pages"
            summary={`${total} voucher${total === 1 ? '' : 's'}`}
          />
        </div>
      </div>
    </TallyPage>
  );
};

export default JournalPage;
