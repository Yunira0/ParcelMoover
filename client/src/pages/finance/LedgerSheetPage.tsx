import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import FilterDropdown from '../../components/FilterDropdown';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import PartyPicker from '../accounting/PartyPicker';
import {
  dayBookAction,
  exportAction,
  printAction,
  quitAction,
  voucherActions,
  voucherTypeOf,
} from '../../components/finance/tallyKeys';
import {
  getAccountLedger,
  type Account,
  type AccountLedger,
} from '../../services/accounting.service';
import { listAccounts } from '../../queries/lookups';
import { hasAdminPermission } from '../../utils/auth';
import { drCr, formatAmount } from '../../utils/format';
import { downloadExcel } from '../../utils/excel';
import { toBsDate } from '../../utils/nepaliDate';
import { useBackOr } from '../../hooks/useBackOr';
import '../accounting/Accounting.css';

/**
 * One account's ledger, as TallyPrime's Ledger Vouchers report: Date,
 * Particulars ("To" the other ledger on a debit, "By" it on a credit), Vch
 * Type, Vch No., Debit, Credit, with the running balance on the right and
 * Opening Balance / Current Total / Closing Balance ruled off at the foot.
 *
 * Mounted twice: as the Account Ledger menu item (?account=) and as the sheet
 * every other screen drills into (/finance/ledger/:code).
 */

const TYPE_LABELS: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Capital',
  revenue: 'Income',
  expense: 'Expenses',
};

const LedgerSheetPage: React.FC = () => {
  const { code: routeCode } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const code = routeCode ?? params.get('account') ?? '1000';
  const goBack = useBackOr('/finance/cash-bank');
  const canWrite = hasAdminPermission('ACCOUNTING_ACCESS');

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ledger, setLedger] = useState<AccountLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // One printable document for the chosen range, not a browsed list - so
      // it asks for the server's largest page in one call.
      setLedger(
        await getAccountLedger(code, {
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          pageSize: 2000,
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [code, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    listAccounts().then(setAccounts).catch(() => {
      // The picker is a convenience; a ledger that loaded is still readable
      // without it, so this must not take the screen down with it.
    });
  }, []);

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };

  // On the menu item the account rides in the query string, so switching it
  // keeps you on the Account Ledger rather than jumping to the drill-in URL.
  const pickAccount = (next: string) => {
    if (!next) return;
    if (routeCode) navigate(`/finance/ledger/${next}${params.toString() ? `?${params.toString()}` : ''}`);
    else setParam('account', next);
  };

  const debitNormal = ledger?.account.normalSide !== 'credit';
  /** Which column a balance sits in: its Dr or Cr side, as a positive figure. */
  const sideOf = (balance: number) => ((debitNormal ? balance >= 0 : balance < 0) ? 'debit' : 'credit');

  const rows = useMemo(() => ledger?.rows ?? [], [ledger]);

  const exportSheet = useCallback(async () => {
    if (!ledger) return;
    const dn = ledger.account.normalSide !== 'credit';
    await downloadExcel(
      `ledger-${ledger.account.code}`,
      ledger.account.name,
      ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit', 'Credit', 'Balance', 'Narration'],
      [
        // The running balance below starts from this figure, so the file
        // reconciles only if it carries it too.
        [toBsDate(ledger.range.from), 'Opening Balance', '', '', '', '', drCr(ledger.openingBalance, dn), ''],
        ...ledger.rows.map((row) => [
          row.bsDate,
          `${row.debit > 0 ? 'To' : 'By'} ${row.contraAccounts}`,
          voucherTypeOf(row.sourceType),
          row.entryNo,
          row.debit || '',
          row.credit || '',
          drCr(row.runningBalance, dn),
          row.memo ?? '',
        ]),
        ['', 'Closing Balance', '', '', '', '', drCr(ledger.closingBalance, dn), ''],
      ],
    );
  }, [ledger]);

  const actions: TallyAction[] = useMemo(() => [
    ...(canWrite ? voucherActions(navigate) : []),
    printAction(),
    exportAction(() => void exportSheet(), !ledger),
    dayBookAction(navigate),
    quitAction(goBack),
  ], [canWrite, navigate, exportSheet, ledger, goBack]);

  // The app's own controls, not bare <select>/<input>: a searchable dropdown
  // because a real chart runs to hundreds of accounts, and the Nepali date
  // picker because every date on the sheet is BS.
  const filters = (
    <>
      <FilterDropdown
        label="LEDGER"
        value={code}
        ariaLabel="Ledger"
        placeholder="Select ledger"
        searchPlaceholder="Search ledgers..."
        options={accounts.filter((account) => account.isActive || account.code === code).map((account) => ({
          value: account.code,
          label: `${account.name} · ${account.code}`,
        }))}
        onChange={pickAccount}
      />
      <label aria-label="From date">
        <span>FROM</span>
        <NepaliDatePicker value={from} onChange={(next) => setParam('from', next)} placeholder="Start date" />
      </label>
      <label aria-label="To date">
        <span>TO</span>
        <NepaliDatePicker value={to} onChange={(next) => setParam('to', next)} placeholder="End date" />
      </label>
      {/* Admin and staff have no account of their own; their ledger is
          everything posted against them, across every account. */}
      <label className="acc-staff-ledger-picker" aria-label="Admin or staff ledger">
        <span>ADMIN / STAFF</span>
        <PartyPicker
          types={['user']}
          value={null}
          onChange={(party) => party && navigate(`/finance/ledger/user/${party.partyId}`)}
          prompt=""
          inputLabel="Open an admin / staff ledger"
        />
      </label>
    </>
  );

  const openingSide = ledger ? sideOf(ledger.openingBalance) : 'debit';
  const closingSide = ledger ? sideOf(ledger.closingBalance) : 'debit';

  return (
    <TallyPage
      title={ledger ? `Ledger: ${ledger.account.name}` : 'Ledger'}
      period={ledger?.range.label}
      periodLabel="Period"
      actions={actions}
      filters={filters}
      error={error}
      loading={loading}
      menu
    >
      {ledger && (
        <div className="tly-voucher jv">
          <div className="jv-meta">
            <div className="jv-meta-field">
              <span>Ledger :</span>
              <strong>{ledger.account.name} · {ledger.account.code}</strong>
            </div>
            <div className="jv-meta-field">
              <span>Under :</span>
              <strong>{TYPE_LABELS[ledger.account.type] ?? ledger.account.type}</strong>
            </div>
            <div className="jv-meta-field jv-meta-no">
              <span>Vouchers :</span>
              <strong>{ledger.totalRows}</strong>
            </div>
          </div>

          <div className="tly-scroll">
            <table className="tly-sheet jv-sheet jv-report">
              <thead>
                <tr>
                  <th style={{ width: '11%' }}>Date</th>
                  <th className="jv-col-account">Particulars</th>
                  <th style={{ width: '10%' }}>Vch Type</th>
                  <th style={{ width: '12%' }}>Vch No.</th>
                  <th className="tly-amt">Debit</th>
                  <th className="tly-amt">Credit</th>
                  <th className="tly-amt">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr className="jv-empty"><td colSpan={7}>Nothing moved on this ledger during {ledger.range.label}.</td></tr>
                )}
                {rows.map((row, index) => (
                  <tr key={row.entryId + index} className="jv-row" onClick={() => navigate(`/finance/voucher/${row.entryId}`)}>
                    <td>{row.bsDate}</td>
                    <td>
                      <span className="jv-by">{row.debit > 0 ? 'To' : 'By'}</span>
                      <strong>{row.contraAccounts || '—'}</strong>
                      {row.memo && <span className="jv-narration">({row.memo})</span>}
                    </td>
                    <td>{voucherTypeOf(row.sourceType)}</td>
                    <td>{row.entryNo}</td>
                    <td className="tly-amt">{row.debit > 0 ? formatAmount(row.debit) : ''}</td>
                    <td className="tly-amt">{row.credit > 0 ? formatAmount(row.credit) : ''}</td>
                    <td className="tly-amt">{drCr(row.runningBalance, debitNormal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="jv-foot-total">
                  <td colSpan={4} className="jv-foot-label">Opening Balance :</td>
                  <td className="tly-amt">{openingSide === 'debit' ? formatAmount(Math.abs(ledger.openingBalance)) : ''}</td>
                  <td className="tly-amt">{openingSide === 'credit' ? formatAmount(Math.abs(ledger.openingBalance)) : ''}</td>
                  <td className="tly-amt" />
                </tr>
                <tr>
                  <td colSpan={4} className="jv-foot-label">Current Total :</td>
                  <td className="tly-amt">{formatAmount(ledger.totalDebit)}</td>
                  <td className="tly-amt">{formatAmount(ledger.totalCredit)}</td>
                  <td className="tly-amt" />
                </tr>
                <tr className="jv-foot-closing">
                  <td colSpan={4} className="jv-foot-label">Closing Balance :</td>
                  <td className="tly-amt">{closingSide === 'debit' ? formatAmount(Math.abs(ledger.closingBalance)) : ''}</td>
                  <td className="tly-amt">{closingSide === 'credit' ? formatAmount(Math.abs(ledger.closingBalance)) : ''}</td>
                  <td className="tly-amt">{drCr(ledger.closingBalance, debitNormal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </TallyPage>
  );
};

export default LedgerSheetPage;
