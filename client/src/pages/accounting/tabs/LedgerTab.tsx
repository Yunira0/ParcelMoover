import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import StatCard from '../../../components/StatCard';
import Table from '../../../components/Table';
import FilterDropdown from '../../../components/FilterDropdown';
import PeriodPicker from '../PeriodPicker';
import { Banner } from '../ui';
import { cardTone, money, numClass } from '../format';
import { defaultRange, rangeParams, type RangeSelection } from '../range';
import {
  getAccountLedger,
  listAccounts,
  type Account,
  type AccountLedger as Ledger,
} from '../../../services/accounting.service';
import { apiErrorMessage } from '../../../utils/serverValidation';
import { bsToAdDay, toBsDate } from '../../../utils/nepaliDate';
import '../Accounting.css';

// One account, its movements, and a running balance down the page. The oldest
// and most useful accounting view there is.

const TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
const TYPE_LABELS: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expenses',
};

/**
 * A timestamp from the server as the AD day the sheet's filters take.
 *
 * The round trip through BS is the point: it is what makes the day Nepal-local
 * rather than the viewer's, so a window picked in Kathmandu does not shift by
 * one when the same link is opened from another timezone.
 */
const adDay = (value: string | Date) => {
  const [year, month, day] = toBsDate(value).split('-').map(Number);
  return bsToAdDay(year, month - 1, day);
};

const LedgerTab: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [code, setCode] = useState(searchParams.get('account') ?? '1000');
  const [range, setRange] = useState<RangeSelection>(defaultRange);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAccounts()
      .then(setAccounts)
      .catch(() => setError('Could not load the chart of accounts'));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLedger(await getAccountLedger(code, rangeParams(range)));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load this ledger'));
      setLedger(null);
    } finally {
      setLoading(false);
    }
  }, [code, range]);

  useEffect(() => {
    void load();
  }, [load]);

  const pickAccount = (next: string) => {
    setCode(next);
    const params = new URLSearchParams(searchParams);
    params.set('account', next);
    setSearchParams(params, { replace: true });
  };

  // The chart of accounts is long enough that it needs searching, so the
  // account type leads each label in place of the <optgroup> a plain select had.
  const accountOptions = TYPE_ORDER.flatMap((type) =>
    accounts
      .filter((account) => account.type === type)
      .map((account) => ({ value: account.code, label: `${TYPE_LABELS[type]} · ${account.name}` })),
  );

  // The opening balance leads the movements rather than sitting only in the card
  // above: a running-balance column has to start from something for the figures
  // under it to mean anything. Skipped when there are no movements, so an empty
  // ledger still shows its empty state instead of a lone opening row.
  const rows = ledger?.rows.length
    ? [
        {
          id: '__opening',
          isOpening: true,
          bsDate: '',
          entryNo: '',
          memo: 'Opening balance',
          contraAccounts: '',
          debit: 0,
          credit: 0,
          runningBalance: ledger.openingBalance,
        },
        ...ledger.rows.map((row, index) => ({ ...row, id: `${row.entryId}-${index}`, isOpening: false })),
      ]
    : [];

  return (
    <>
      <div className="acc-toolbar">
        <div className="acc-filters">
          <div className="acc-filter-wide">
            <FilterDropdown
              label="ACCOUNT"
              value={code}
              options={accountOptions}
              onChange={pickAccount}
              placeholder="Select account"
              searchPlaceholder="Search the chart of accounts..."
              ariaLabel="Account"
            />
          </div>
        </div>

        <PeriodPicker value={range} onChange={setRange} />
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      {ledger && (
        <>
          {ledger.account.description && <Banner tone="info">{ledger.account.description}</Banner>}

          <div className="acc-cards">
            <StatCard
              label="Opening balance"
              value={money(ledger.openingBalance)}
              tone={cardTone(ledger.openingBalance)}
              hint={`Everything before ${ledger.range.label}`}
            />
            <StatCard label="Debits" value={money(ledger.totalDebit)} />
            <StatCard label="Credits" value={money(ledger.totalCredit)} />
            <StatCard
              label="Closing balance"
              value={money(ledger.closingBalance)}
              tone={cardTone(ledger.closingBalance)}
              hint={`${ledger.account.normalSide === 'debit' ? 'Debit' : 'Credit'} balance is normal here`}
            />
          </div>

          <div className="acc-panel">
            <div className="acc-panel-head">
              <div>
                <h2>{ledger.account.name}</h2>
                <p>{ledger.range.label} · {ledger.rows.length} movements</p>
              </div>

              {/* The same ledger as the ruled sheet that gets printed and
                  filed. The resolved window travels with it because that sheet
                  reads from/to only — a period key would silently widen it.
                  `range.to` is the exclusive end, so it steps back a moment to
                  land on the last day that is actually in the window. */}
              <Link
                className="acc-link"
                to={`/finance/ledger/${ledger.account.code}?from=${adDay(ledger.range.from)}&to=${adDay(new Date(new Date(ledger.range.to).getTime() - 1))}`}
              >
                Printable sheet
              </Link>
            </div>

            <Table
              selectable={false}
              loading={loading}
              getRowClassName={(row) => (row.isOpening ? 'acc-opening-row' : '')}
              data={rows}
              columns={[
                { header: 'Date (BS)', width: '110px', accessor: 'bsDate' },
                {
                  header: 'Entry',
                  width: '140px',
                  accessor: (row) => <span className="acc-entry-no">{row.entryNo}</span>,
                },
                { header: 'Description', accessor: (row) => row.memo || '—' },
                {
                  header: 'Contra account',
                  width: '190px',
                  accessor: (row) =>
                    row.isOpening ? '' : <span className="acc-muted">{row.contraAccounts || '—'}</span>,
                },
                {
                  header: 'Debit',
                  width: '120px',
                  className: 'acc-num',
                  accessor: (row) => <span className="acc-num">{row.debit ? money(row.debit) : ''}</span>,
                },
                {
                  header: 'Credit',
                  width: '120px',
                  className: 'acc-num',
                  accessor: (row) => <span className="acc-num">{row.credit ? money(row.credit) : ''}</span>,
                },
                {
                  header: 'Balance',
                  width: '140px',
                  className: 'acc-num',
                  accessor: (row) => (
                    <span className={numClass(row.runningBalance)}>{money(row.runningBalance)}</span>
                  ),
                },
              ]}
              emptyMessage={`Nothing moved on this account during ${ledger.range.label}.`}
              footer={
                <tr>
                  <td colSpan={4}>Closing balance</td>
                  <td className="acc-num">{money(ledger.totalDebit)}</td>
                  <td className="acc-num">{money(ledger.totalCredit)}</td>
                  <td className={numClass(ledger.closingBalance)}>{money(ledger.closingBalance)}</td>
                </tr>
              }
            />
          </div>
        </>
      )}
    </>
  );
};

export default LedgerTab;
