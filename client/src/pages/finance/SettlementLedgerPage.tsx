import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import LedgerSummary from '../../components/finance/LedgerSummary';
import FilterDropdown from '../../components/FilterDropdown';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import Pagination from '../../components/Pagination';
import SegmentedTabs from '../../components/SegmentedTabs';
import {
  getPartySettlementLedger,
  getPartyStatement,
  listPartyBalances,
  type PartyBalance,
  type PartySettlementLedger,
  type PartyStatement,
} from '../../services/accounting.service';
import { drCr, formatAmount } from '../../utils/format';
import { downloadExcel } from '../../utils/excel';
import { useBackOr } from '../../hooks/useBackOr';
import { hasAdminPermission } from '../../utils/auth';
import {
  dayBookAction,
  exportAction,
  printAction,
  quitAction,
  voucherActions,
  voucherTypeOf,
} from '../../components/finance/tallyKeys';

/**
 * One rider's, vendor's or admin/staff member's ledger, in two views.
 *
 * COD is the statement-driven sheet: nothing accrues per parcel, the balance
 * moves when a statement is raised and again as each instalment lands, which
 * is why one statement produces two rows on two dates.
 *
 * All accounts is every journal line tagged to the person — COD, salary, fuel,
 * advances, anything posted against them — grouped by account, then listed.
 * Admin/staff have no COD, so they only get this view.
 */
const MIN_ROWS = 20;

type PartyType = 'rider' | 'vendor' | 'user';
type LedgerView = 'cod' | 'all';

const BALANCE_HEADER: Record<'rider' | 'vendor', string> = {
  rider: 'With rider',
  vendor: 'Owed',
};

const TITLE: Record<PartyType, string> = {
  rider: 'Rider Ledger',
  vendor: 'Vendor Ledger',
  user: 'Admin / Staff Ledger',
};

const PARTY_LABEL: Record<PartyType, string> = {
  rider: 'Rider',
  vendor: 'Vendor',
  user: 'Admin / staff',
};

const TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const TYPE_LABEL: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expenses',
};

const VIEW_OPTIONS: { value: LedgerView; label: string }[] = [
  { value: 'cod', label: 'COD' },
  { value: 'all', label: 'All accounts' },
];

const SettlementLedgerPage: React.FC = () => {
  const { partyType = 'rider', partyId = '' } = useParams<{ partyType: PartyType; partyId: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const type: PartyType = partyType === 'vendor' || partyType === 'user' ? partyType : 'rider';
  const codType = type === 'user' ? null : type;
  const goBack = useBackOr(type === 'user' ? '/accounting/ledgers/account' : `/accounting/ledgers/${type}`);

  const [parties, setParties] = useState<PartyBalance[]>([]);
  const [ledger, setLedger] = useState<PartySettlementLedger | null>(null);
  const [statement, setStatement] = useState<PartyStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(MIN_ROWS);

  const view: LedgerView = codType && params.get('view') !== 'all' ? 'cod' : 'all';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  const load = useCallback(async () => {
    if (!partyId) return;
    setLoading(true);
    setError(null);
    const range = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
    try {
      if (view === 'cod' && codType) {
        setLedger(await getPartySettlementLedger(codType, partyId, { ...range, page, pageSize }));
      } else {
        setStatement(await getPartyStatement(type, partyId, range));
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [view, codType, type, partyId, from, to, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  // Switching party, or narrowing the date range, starts back at page 1.
  useEffect(() => {
    setPage(1);
  }, [type, partyId, from, to]);

  useEffect(() => {
    if (!codType) return;
    listPartyBalances(codType)
      .then(setParties)
      .catch(() => {
        // The picker is a convenience; a sheet that loaded is still readable
        // without it.
      });
  }, [codType]);

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };

  const debitNormal = type === 'rider';

  // Oldest first, as a ledger reads; the server sends newest first so its cap
  // keeps the most recent movements.
  const movements = useMemo(() => [...(statement?.movements ?? [])].reverse(), [statement]);

  // A reversal only answers its cancelled voucher, which is listed (marked)
  // instead; the pair nets to nothing, so the totals are unchanged.
  const listed = useMemo(() => movements.filter((row) => row.sourceType !== 'reversal'), [movements]);
  const listedTotals = useMemo(
    () => listed
      .filter((row) => row.status !== 'voided')
      .reduce((sum, row) => ({ debit: sum.debit + row.debit, credit: sum.credit + row.credit }), { debit: 0, credit: 0 }),
    [listed],
  );

  const groupsByType = useMemo(() => {
    const groups = statement?.groups ?? [];
    return TYPE_ORDER.map((accountType) => ({ type: accountType, rows: groups.filter((group) => group.type === accountType) }))
      .filter((section) => section.rows.length > 0);
  }, [statement]);

  const exportSheet = async () => {
    if (view === 'all') {
      if (!statement) return;
      await downloadExcel(
        `ledger-${type}-${statement.name}-all-accounts`,
        statement.name,
        ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit', 'Credit', 'Narration'],
        listed.map((row) => {
          const cancelled = row.status === 'voided';
          return [
            row.bsDate,
            `${row.debit > 0 ? 'To' : 'By'} ${row.accountName}${cancelled ? ' (Cancelled)' : ''}`,
            voucherTypeOf(row.sourceType),
            row.entryNo,
            cancelled ? '' : row.debit || '',
            cancelled ? '' : row.credit || '',
            row.memo ?? '',
          ];
        }),
      );
      return;
    }
    if (!ledger) return;
    await downloadExcel(
      `ledger-${type}-${ledger.partyName}`,
      ledger.partyName,
      ['Date', 'Particulars / Description', 'Reference', 'Receipt', 'Payment', 'Balance'],
      [
        ...(ledger.page === 1
          ? [['', 'Opening balance carried forward', 'OPENING', '', '', drCr(ledger.openingBalance, debitNormal)]]
          : []),
        ...ledger.rows.map((row) => [
          row.bsDate,
          row.description,
          row.reference,
          row.debit || '',
          row.credit || '',
          drCr(row.runningBalance, debitNormal),
        ]),
      ],
    );
  };

  const current = view === 'all' ? statement : ledger;

  const actions: TallyAction[] = [
    ...(hasAdminPermission('ACCOUNTING_ACCESS') ? voucherActions(navigate) : []),
    ...(codType
      ? [{ key: 'Alt+F5', label: view === 'cod' ? 'All accounts' : 'COD only', onSelect: () => setParam('view', view === 'cod' ? 'all' : '') }]
      : []),
    printAction(),
    exportAction(() => void exportSheet(), !current),
    type === 'user'
      ? { key: 'Alt+S', label: 'Account ledger', onSelect: () => navigate('/accounting/ledgers/account') }
      : {
          key: 'Alt+S',
          label: type === 'rider' ? 'Vendor ledgers' : 'Rider ledgers',
          onSelect: () => navigate(`/accounting/ledgers/${type === 'rider' ? 'vendor' : 'rider'}`),
        },
    dayBookAction(navigate),
    quitAction(goBack),
  ];

  const rows = ledger?.rows ?? [];
  const blanks = Math.max(0, pageSize - rows.length);
  // Numbering continues across pages rather than restarting at 1, and the
  // "Opening balance carried forward" row only makes sense once, at the very
  // start of the range - every later page's first row already carries the
  // running balance forward from the page before it.
  const rowOffset = ((ledger?.page ?? page) - 1) * (ledger?.pageSize ?? pageSize);
  const isFirstPage = (ledger?.page ?? page) === 1;

  const filters = (
    <>
      {codType && (
        <FilterDropdown
          label={codType === 'rider' ? 'RIDER' : 'VENDOR'}
          value={partyId}
          ariaLabel={codType === 'rider' ? 'Rider' : 'Vendor'}
          placeholder={`Select ${codType}`}
          searchPlaceholder={`Search ${codType}s...`}
          options={parties.map((party) => ({
            value: party.partyId,
            label: party.subtitle ? `${party.name} — ${party.subtitle}` : party.name,
          }))}
          onChange={(next) => next && navigate(`/finance/ledger/${codType}/${next}${view === 'all' ? '?view=all' : ''}`)}
        />
      )}
      <label aria-label="From date">
        <span>FROM</span>
        <NepaliDatePicker value={from} onChange={(next) => setParam('from', next)} placeholder="Start date" />
      </label>
      <label aria-label="To date">
        <span>TO</span>
        <NepaliDatePicker value={to} onChange={(next) => setParam('to', next)} placeholder="End date" />
      </label>
    </>
  );

  const partyName = view === 'all' ? statement?.name : ledger?.partyName;

  return (
    <TallyPage
      title={TITLE[type]}
      period={current?.range.label}
      periodLabel="Time Period"
      actions={actions}
      filters={filters}
      error={error}
      loading={loading}
      menu
    >
      {current && (
        <div className="tly-partybar">
          <span className="tly-field">
            <span>{PARTY_LABEL[type]}</span>
            <strong>{partyName}</strong>
          </span>
          {view === 'cod' && ledger?.partySubtitle && (
            <span className="tly-field">
              <span>Contact</span>
              <strong>{ledger.partySubtitle}</strong>
            </span>
          )}
          {codType && (
            <span style={{ marginLeft: 'auto' }}>
              <SegmentedTabs
                options={VIEW_OPTIONS}
                value={view}
                onChange={(next) => setParam('view', next === 'all' ? 'all' : '')}
                ariaLabel="Ledger view"
                fullWidth={false}
              />
            </span>
          )}
        </div>
      )}

      {view === 'cod' && ledger && (
        <>
          <div className="tly-scroll">
            <table className="tly-sheet jv-sheet jv-report">
              <thead>
                <tr>
                  <th style={{ width: '4%' }}>No</th>
                  <th style={{ width: '11%' }}>Date</th>
                  <th>Particulars / Description</th>
                  <th style={{ width: '15%' }}>Reference</th>
                  <th className="tly-amt">Receipt</th>
                  <th className="tly-amt">Payment</th>
                  <th className="tly-amt">{BALANCE_HEADER[ledger.partyType]}</th>
                </tr>
              </thead>
              <tbody>
                {isFirstPage && (
                  <tr>
                    <td />
                    <td />
                    <td className="tly-muted">Opening balance carried forward</td>
                    <td className="tly-muted">OPENING</td>
                    <td className="tly-amt">–</td>
                    <td className="tly-amt">–</td>
                    <td className="tly-amt">{drCr(ledger.openingBalance, debitNormal)}</td>
                  </tr>
                )}

                {rows.map((row, index) => (
                  <tr
                    key={row.id}
                    onClick={row.entryId ? () => navigate(`/finance/voucher/${row.entryId}`) : undefined}
                    style={row.entryId ? { cursor: 'pointer' } : undefined}
                  >
                    <td>{rowOffset + index + 1}</td>
                    <td>{row.bsDate}</td>
                    <td>{row.description}</td>
                    <td>{row.reference}</td>
                    <td className="tly-amt">{row.debit > 0 ? formatAmount(row.debit) : '–'}</td>
                    <td className="tly-amt">{row.credit > 0 ? formatAmount(row.credit) : '–'}</td>
                    <td className="tly-amt">{drCr(row.runningBalance, debitNormal)}</td>
                  </tr>
                ))}

                {Array.from({ length: blanks }, (_, index) => (
                  <tr key={`blank-${index}`} className="tly-blank">
                    <td>{rowOffset + rows.length + index + 1}</td>
                    <td />
                    <td />
                    <td />
                    <td />
                    <td />
                    <td />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ textAlign: 'right' }}>
                    Totals
                  </td>
                  <td className="tly-amt">{formatAmount(ledger.totalDebit)}</td>
                  <td className="tly-amt">{formatAmount(ledger.totalCredit)}</td>
                  <td className="tly-amt" />
                </tr>
                <tr className="tly-grand">
                  <td colSpan={6} style={{ textAlign: 'right' }}>
                    {type === 'rider' ? 'Still with the rider' : 'Still owed to the vendor'}
                  </td>
                  <td className="tly-amt">{drCr(ledger.closingBalance, debitNormal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <Pagination
            ariaLabel="Settlement ledger pagination"
            page={ledger.page}
            totalPages={ledger.totalPages}
            onPageChange={setPage}
            pageSize={pageSize}
            pageSizeLabel="rows"
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            summary={`${ledger.totalRows} movement${ledger.totalRows === 1 ? '' : 's'}`}
          />

          <LedgerSummary
            title={type === 'rider' ? 'Rider Summary' : 'Vendor Summary'}
            lines={ledger.summary.map((line, index) => ({
              label: line.label,
              // Only the closing line is a balance; the totals above it are
              // sums and a side on them would be meaningless.
              value:
                index === ledger.summary.length - 1
                  ? drCr(line.amount, debitNormal)
                  : formatAmount(line.amount),
            }))}
          />
        </>
      )}

      {view === 'all' && statement && (
        <div className="tly-voucher jv">
          {/* Each account's closing balance, on its Dr or Cr side, as Tally's
              Group Summary shows it. Liabilities are never netted against
              assets into one signed total. */}
          <div className="tly-scroll">
            <table className="tly-sheet jv-sheet jv-report">
              <thead>
                <tr>
                  <th className="jv-col-account">Particulars</th>
                  <th className="tly-amt">Debit</th>
                  <th className="tly-amt">Credit</th>
                </tr>
              </thead>
              <tbody>
                {groupsByType.length === 0 && (
                  <tr className="jv-empty"><td colSpan={3}>Nothing has been posted against {statement.name} in this period.</td></tr>
                )}
                {groupsByType.map((section) => (
                  <React.Fragment key={section.type}>
                    <tr className="jv-group-row"><td colSpan={3}>{TYPE_LABEL[section.type] ?? section.type}</td></tr>
                    {section.rows.map((group) => {
                      const net = group.debit - group.credit;
                      return (
                        <tr key={group.code} className="jv-row" onClick={() => navigate(`/finance/ledger/${group.code}`)}>
                          <td className="jv-indent-1">{group.name} <span className="tly-muted">· {group.code}</span></td>
                          <td className="tly-amt">{net > 0 ? formatAmount(net) : ''}</td>
                          <td className="tly-amt">{net < 0 ? formatAmount(-net) : ''}</td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* The vouchers themselves, as Tally's Ledger Vouchers. A cancelled
              voucher shows once, marked, with no amounts; its reversal is the
              same event and is not listed again. */}
          <div className="tly-scroll" style={{ marginTop: 'var(--space-4)' }}>
            <table className="tly-sheet jv-sheet jv-report">
              <thead>
                <tr>
                  <th style={{ width: '11%' }}>Date</th>
                  <th className="jv-col-account">Particulars</th>
                  <th style={{ width: '10%' }}>Vch Type</th>
                  <th style={{ width: '13%' }}>Vch No.</th>
                  <th className="tly-amt">Debit</th>
                  <th className="tly-amt">Credit</th>
                </tr>
              </thead>
              <tbody>
                {listed.length === 0 && <tr className="jv-empty"><td colSpan={6}>No vouchers in this period.</td></tr>}
                {listed.map((row, index) => {
                  const cancelled = row.status === 'voided';
                  return (
                    <tr
                      key={`${row.entryId}-${row.accountCode}-${index}`}
                      className={cancelled ? 'jv-row jv-row-voided' : 'jv-row'}
                      onClick={() => navigate(`/finance/voucher/${row.entryId}`)}
                    >
                      <td>{row.bsDate}</td>
                      <td>
                        <span className="jv-by">{row.debit > 0 ? 'To' : 'By'}</span>
                        <strong>{row.accountName}</strong>
                        {row.trackingId && <span className="tly-muted"> · {row.trackingId}</span>}
                        {cancelled && <span className="tly-muted"> (Cancelled)</span>}
                        {row.memo && <span className="jv-narration">({row.memo})</span>}
                      </td>
                      <td>{voucherTypeOf(row.sourceType)}</td>
                      <td>{row.entryNo}</td>
                      <td className="tly-amt">{!cancelled && row.debit > 0 ? formatAmount(row.debit) : ''}</td>
                      <td className="tly-amt">{!cancelled && row.credit > 0 ? formatAmount(row.credit) : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
              {listed.length > 0 && (
                <tfoot>
                  <tr className="jv-foot-total jv-foot-closing">
                    <td colSpan={4} className="jv-foot-label">Current Total :</td>
                    <td className="tly-amt">{formatAmount(listedTotals.debit)}</td>
                    <td className="tly-amt">{formatAmount(listedTotals.credit)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {statement.movements.length >= 1000 && (
            <p className="tly-note">Showing the latest 1,000 movements — narrow the dates to see older ones.</p>
          )}
        </div>
      )}
    </TallyPage>
  );
};

export default SettlementLedgerPage;
