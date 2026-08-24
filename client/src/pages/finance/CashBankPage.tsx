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
import { drCr, formatMoney } from '../../utils/format';
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

  const actions: TallyAction[] = [
    { key: 'F5', label: 'Payment', onSelect: () => navigate('/finance/voucher/new?type=payment') },
    { key: 'F6', label: 'Receipt', onSelect: () => navigate('/finance/voucher/new?type=receipt') },
    { key: 'F8', label: 'Ledger', onSelect: () => navigate(`/finance/ledger/${CASH_IN_HAND}`) },
    { key: 'F12', label: 'Day book', onSelect: () => navigate('/accounting/transactions/journal') },
  ];

  const filters = <PeriodPicker value={range} onChange={setRange} />;

  return (
    <TallyPage
      title="Cash & Bank"
      period={rows[0]?.ledger.range.label}
      periodLabel="Period"
      actions={actions}
      filters={filters}
      error={error}
      loading={loading}
    >
      <p className="tly-note">
        Cash-in-hand and every bank or wallet ledger, grouped as they post. Open a row for its full cash
        book, or raise a voucher from the panel on the right.
      </p>

      <div className="tly-scroll">
        <table className="tly-sheet">
          <thead>
            <tr>
              <th style={{ width: '28%' }}>Ledger</th>
              <th style={{ width: '18%' }}>Group</th>
              <th className="tly-amt">Opening Bal.</th>
              <th className="tly-amt">Debit</th>
              <th className="tly-amt">Credit</th>
              <th className="tly-amt">Closing Bal.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ account, ledger }) => {
              const debitNormal = account.normalSide !== 'credit';
              return (
                <tr
                  key={account.code}
                  onClick={() => navigate(`/finance/ledger/${account.code}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>
                    <strong>{account.name}</strong> <span className="tly-muted">· {account.code}</span>
                  </td>
                  <td className="tly-muted">
                    {account.code === CASH_IN_HAND ? 'Cash-in-Hand' : 'Bank Accounts'}
                  </td>
                  <td className="tly-amt">{drCr(ledger.openingBalance, debitNormal)}</td>
                  <td className="tly-amt">{formatMoney(ledger.totalDebit)}</td>
                  <td className="tly-amt">{formatMoney(ledger.totalCredit)}</td>
                  <td className="tly-amt">{drCr(ledger.closingBalance, debitNormal)}</td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="tly-muted">
                  No cash or bank accounts yet — add one from Masters.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="tly-grand">
                <td colSpan={2}>Grand Total</td>
                <td className="tly-amt">{drCr(totals.opening, true)}</td>
                <td className="tly-amt">{formatMoney(totals.debit)}</td>
                <td className="tly-amt">{formatMoney(totals.credit)}</td>
                <td className="tly-amt">{drCr(totals.closing, true)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </TallyPage>
  );
};

export default CashBankPage;
