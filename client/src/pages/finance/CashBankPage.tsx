import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import PeriodPicker from '../accounting/PeriodPicker';
import { defaultRange, rangeParams, type RangeSelection } from '../accounting/range';
import {
  getAccountLedger,
  listAccounts,
  type Account,
  type AccountLedger,
} from '../../services/accounting.service';
import { drCr, formatAmount } from '../../utils/format';
import { downloadExcel } from '../../utils/excel';
import { hasAdminPermission } from '../../utils/auth';
import { useBackOr } from '../../hooks/useBackOr';
import {
  dayBookAction,
  exportAction,
  printAction,
  quitAction,
  voucherActions,
} from '../../components/finance/tallyKeys';
import '../../components/finance/tally.css';

/**
 * Cash & Bank — the group summary a Tally user opens first: every cash and
 * bank ledger with its opening, its movement for the period, and its closing
 * balance, the way "Display > Account Books > Cash/Bank Book" would show it.
 *
 * There is no single endpoint for this, so it is one ledger call per account
 * rather than a new report — the same call the ledger sheet itself makes, run
 * once per account instead of once for the account you picked. The list is
 * always short (cash in hand plus however many bank and wallet accounts exist),
 * so that is cheap.
 */

/** Cash in hand. The one funding account that is not derivable from the chart. */
const CASH_IN_HAND = '1000';

interface Row {
  account: Account;
  ledger: AccountLedger;
}

const CashBankPage: React.FC = () => {
  const navigate = useNavigate();
  const goBack = useBackOr('/accounting');
  const canWrite = hasAdminPermission('ACCOUNTING_ACCESS');
  const [range, setRange] = useState<RangeSelection>(defaultRange);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const accounts = await listAccounts('cash_bank');
      const ledgers = await Promise.all(
        accounts.map((account) => getAccountLedger(account.code, rangeParams(range))),
      );
      setRows(accounts.map((account, index) => ({ account, ledger: ledgers[index] })));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = rows.reduce(
    (sum, row) => ({
      opening: sum.opening + row.ledger.openingBalance,
      debit: sum.debit + row.ledger.totalDebit,
      credit: sum.credit + row.ledger.totalCredit,
      closing: sum.closing + row.ledger.closingBalance,
    }),
    { opening: 0, debit: 0, credit: 0, closing: 0 },
  );

  const exportSheet = async () => {
    await downloadExcel(
      'cash-bank-summary',
      'Cash & Bank',
      ['Particulars', 'Group', 'Opening Balance', 'Debit', 'Credit', 'Closing Balance'],
      rows.map(({ account, ledger }) => {
        const debitNormal = account.normalSide !== 'credit';
        return [
          account.name,
          account.code === CASH_IN_HAND ? 'Cash-in-Hand' : 'Bank Accounts',
          drCr(ledger.openingBalance, debitNormal),
          ledger.totalDebit,
          ledger.totalCredit,
          drCr(ledger.closingBalance, debitNormal),
        ];
      }),
    );
  };

  const actions: TallyAction[] = [
    ...(canWrite ? voucherActions(navigate) : []),
    { key: 'F8', label: 'Ledger', onSelect: () => navigate(`/finance/ledger/${CASH_IN_HAND}`) },
    printAction(),
    exportAction(() => void exportSheet(), rows.length === 0),
    dayBookAction(navigate),
    quitAction(goBack),
  ];

  const filters = <PeriodPicker value={range} onChange={setRange} />;

  return (
    <TallyPage
      title="Cash/Bank Summary"
      period={rows[0]?.ledger.range.label}
      periodLabel="Period"
      actions={actions}
      filters={filters}
      error={error}
      loading={loading}
      menu
    >
      <div className="tly-voucher jv">
        <div className="jv-meta">
          <div className="jv-meta-field">
            <span>Group :</span>
            <strong>Cash-in-Hand and Bank Accounts</strong>
          </div>
          <div className="jv-meta-field jv-meta-no">
            <span>Ledgers :</span>
            <strong>{rows.length}</strong>
          </div>
        </div>

        <div className="tly-scroll">
          <table className="tly-sheet jv-sheet jv-report">
            <thead>
              <tr>
                <th className="jv-col-account">Particulars</th>
                <th className="tly-amt">Opening Balance</th>
                <th className="tly-amt">Debit</th>
                <th className="tly-amt">Credit</th>
                <th className="tly-amt">Closing Balance</th>
              </tr>
            </thead>
            <tbody>
              {(['Cash-in-Hand', 'Bank Accounts'] as const).map((group) => {
                const members = rows.filter(({ account }) => (account.code === CASH_IN_HAND) === (group === 'Cash-in-Hand'));
                if (members.length === 0) return null;
                return (
                  <React.Fragment key={group}>
                    <tr className="jv-group-row">
                      <td colSpan={5}>{group}</td>
                    </tr>
                    {members.map(({ account, ledger }) => {
                      const debitNormal = account.normalSide !== 'credit';
                      return (
                        <tr key={account.code} className="jv-row" onClick={() => navigate(`/finance/ledger/${account.code}`)}>
                          <td className="jv-indent-1">
                            {account.name} <span className="tly-muted">· {account.code}</span>
                          </td>
                          <td className="tly-amt">{drCr(ledger.openingBalance, debitNormal)}</td>
                          <td className="tly-amt">{formatAmount(ledger.totalDebit)}</td>
                          <td className="tly-amt">{formatAmount(ledger.totalCredit)}</td>
                          <td className="tly-amt">{drCr(ledger.closingBalance, debitNormal)}</td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
              {!loading && rows.length === 0 && (
                <tr className="jv-empty">
                  <td colSpan={5}>No cash or bank accounts yet — add one from Masters.</td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="jv-foot-total jv-foot-closing">
                  <td className="jv-foot-label">Grand Total</td>
                  <td className="tly-amt">{drCr(totals.opening, true)}</td>
                  <td className="tly-amt">{formatAmount(totals.debit)}</td>
                  <td className="tly-amt">{formatAmount(totals.credit)}</td>
                  <td className="tly-amt">{drCr(totals.closing, true)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </TallyPage>
  );
};

export default CashBankPage;
