import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import FilterDropdown from '../../components/FilterDropdown';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import {
  getAccountLedger,
  listAccounts,
  type Account,
  type AccountLedger,
} from '../../services/accounting.service';
import { drCr, formatMoney } from '../../utils/format';
import { downloadExcel } from '../../utils/excel';
import LedgerSummary from '../../components/finance/LedgerSummary';
import { toBsDate } from '../../utils/nepaliDate';

/**
 * One account's ledger, as the ruled sheet it is on paper.
 *
 * Receipt and payment for the two sides, which is what the people reading this
 * sheet call them. They are the debit and credit columns underneath and are
 * still ordered that way, so the sheet reconciles against the journal line for
 * line - only the headings speak the vocabulary of the office rather than of
 * the ledger. The running balance is the column people actually scan, so it is
 * the one on the right where the eye ends up after crossing the row.
 */
const MIN_ROWS = 20;

const LedgerSheetPage: React.FC = () => {
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ledger, setLedger] = useState<AccountLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  const load = useCallback(async () => {
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      setLedger(await getAccountLedger(code, { ...(from ? { from } : {}), ...(to ? { to } : {}) }));
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
    // Cash and bank only: this sheet is the cash book, and the control and
    // revenue accounts are read from their own screens.
    listAccounts('cash_bank').then(setAccounts).catch(() => {
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

  const exportSheet = () => {
    if (!ledger) return;
    downloadExcel(
      `ledger-${ledger.account.code}`,
      ledger.account.name,
      ['Date', 'Particulars / Description', 'Reference', 'Receipt', 'Payment', 'Balance'],
      ledger.rows.map((row) => [
        row.bsDate,
        row.contraAccounts || row.memo || '',
        row.entryNo,
        row.debit || '',
        row.credit || '',
        drCr(row.runningBalance, debitNormal),
      ]),
    );
  };

  const actions: TallyAction[] = [
    { key: 'F5', label: 'Print', onSelect: () => window.print() },
    { key: 'F7', label: 'Export', onSelect: exportSheet, disabled: !ledger },
    { key: 'F12', label: 'Day book', onSelect: () => navigate('/accounting/transactions/journal') },
    { key: 'Escape', label: 'Back', onSelect: () => navigate(-1) },
  ];

  const debitNormal = ledger?.account.normalSide !== 'credit';

  const rows = ledger?.rows ?? [];
  const blanks = Math.max(0, MIN_ROWS - rows.length);

  // The filter strip is the app's own controls, not bare <select>/<input>: a
  // searchable dropdown because a real chart runs to hundreds of accounts, and
  // the Nepali date picker because every date on the sheet below is BS.
  const filters = (
    <>
      <FilterDropdown
        label="ACCOUNT"
        value={code}
        ariaLabel="Account"
        placeholder="Select account"
        searchPlaceholder="Search accounts..."
        options={accounts.map((account) => ({
          value: account.code,
          label: `${account.code} — ${account.name}`,
        }))}
        onChange={(next) => next && navigate(`/finance/ledger/${next}`)}
      />
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

  return (
    <TallyPage
      title={ledger ? `${ledger.account.code} — ${ledger.account.name}` : 'Ledger'}
      period={ledger?.range.label}
      periodLabel="Time Period"
      actions={actions}
      filters={filters}
      error={error}
      loading={loading}
    >
      {ledger && (
        <div className="tly-scroll">
          <table className="tly-sheet tly-sheet-form">
            <thead>
              <tr>
                <th style={{ width: '4%' }}>No</th>
                <th style={{ width: '12%' }}>Date</th>
                <th>Particulars / Description</th>
                <th style={{ width: '15%' }}>Reference</th>
                <th className="tly-amt">Receipt</th>
                <th className="tly-amt">Payment</th>
                <th className="tly-amt">Balance</th>
              </tr>
            </thead>
            <tbody>
              {/* The opening balance is a row, not a caption. It is the first
                  number in the running column and every balance below it is
                  only meaningful relative to it. */}
              <tr>
                <td />
                {/* `range.from` comes back as an AD timestamp. Every other
                    date in this column is BS, so it is converted rather than
                    printed — one column, one calendar. */}
                <td>{toBsDate(ledger.range.from)}</td>
                <td className="tly-muted">Opening balance carried forward</td>
                <td className="tly-muted">OPENING</td>
                <td className="tly-amt">–</td>
                <td className="tly-amt">–</td>
                <td className="tly-amt">{drCr(ledger.openingBalance, debitNormal)}</td>
              </tr>

              {rows.map((row, index) => (
                <tr
                  key={row.entryId + index}
                  onClick={() => navigate(`/finance/voucher/${row.entryId}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{index + 1}</td>
                  <td>{row.bsDate}</td>
                  <td>
                    {row.contraAccounts}
                    {row.memo && (
                      <>
                        <br />
                        <span className="tly-muted">{row.memo}</span>
                      </>
                    )}
                  </td>
                  <td>{row.entryNo}</td>
                  <td className="tly-amt">{row.debit > 0 ? formatMoney(row.debit) : '–'}</td>
                  <td className="tly-amt">{row.credit > 0 ? formatMoney(row.credit) : '–'}</td>
                  <td className="tly-amt">{drCr(row.runningBalance, debitNormal)}</td>
                </tr>
              ))}

              {Array.from({ length: blanks }, (_, index) => (
                <tr key={`blank-${index}`} className="tly-blank">
                  <td>{rows.length + index + 1}</td>
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
                <td className="tly-amt">{formatMoney(ledger.totalDebit)}</td>
                <td className="tly-amt">{formatMoney(ledger.totalCredit)}</td>
                <td className="tly-amt" />
              </tr>
              <tr className="tly-grand">
                <td colSpan={6} style={{ textAlign: 'right' }}>
                  Closing balance
                </td>
                <td className="tly-amt">{drCr(ledger.closingBalance, debitNormal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {ledger && (
        <LedgerSummary
          title="Account Summary"
          lines={[
            { label: 'Opening balance', value: drCr(ledger.openingBalance, debitNormal) },
            { label: 'Total receipts', value: formatMoney(ledger.totalDebit) },
            { label: 'Total payments', value: formatMoney(ledger.totalCredit) },
            { label: 'Closing balance', value: drCr(ledger.closingBalance, debitNormal) },
          ]}
        />
      )}
    </TallyPage>
  );
};

export default LedgerSheetPage;
