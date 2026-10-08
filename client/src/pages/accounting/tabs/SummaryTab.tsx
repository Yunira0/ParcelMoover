import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bike, Store, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import StatCard from '../../../components/StatCard';
import Table from '../../../components/Table';
import PeriodPicker from '../PeriodPicker';
import { Banner } from '../ui';
import { cardTone, money, numClass } from '../format';
import { defaultRange, rangeParams, type RangeSelection } from '../range';
import { getOverview, type AccountingOverview as Overview } from '../../../services/accounting.service';
import { apiErrorMessage } from '../../../utils/serverValidation';
import '../Accounting.css';

// The landing tab for the whole section, built to answer the four questions an
// owner actually asks: how much money do we have, who is holding the rest of it,
// where do we stand with our vendors, and did we make anything this month.

const SummaryTab: React.FC = () => {
  const [range, setRange] = useState<RangeSelection>(defaultRange);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getOverview(rangeParams(range)));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load the accounting overview'));
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  // Movement over the period, as opposed to the positions in the cards above.
  const movement = data
    ? [
        { id: 'cod', label: 'COD collected', amount: data.codCollected },
        { id: 'remitted', label: 'Received from riders', amount: data.receivedFromRiders },
        { id: 'vendors', label: 'Charged & paid to vendors', amount: data.paidToVendors },
        { id: 'revenue', label: 'Revenue earned', amount: data.revenue },
      ]
    : [];

  return (
    <>
      <div className="acc-toolbar">
        <PeriodPicker value={range} onChange={setRange} />
        {data && <span className="acc-muted">{data.range.label}</span>}
      </div>

      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !data && <Banner tone="info">Loading the books…</Banner>}

      {data && (
        <>
          {/* Positions — as at now, not for the period. What matters about cash
              is how much there is, not how much it moved. */}
          <div className="acc-cards">
            <StatCard
              icon={Wallet}
              label="Cash & bank"
              value={money(data.totalCash)}
              tone={cardTone(data.totalCash)}
              hint="Money the office itself holds"
            />
            <StatCard
              icon={Bike}
              label="Held by riders"
              value={money(data.cashWithRiders)}
              tone={cardTone(data.cashWithRiders)}
              hint="Collected on delivery, not yet received by the office"
            />
            <StatCard
              icon={Store}
              label="Vendor position"
              value={money(Math.abs(data.vendorPosition))}
              tone={cardTone(data.vendorPosition)}
              hint={data.vendorPosition >= 0 ? 'Owed to vendors' : 'Owed by vendors to us'}
            />
            <StatCard
              icon={data.netProfit >= 0 ? TrendingUp : TrendingDown}
              label="Net profit"
              value={money(data.netProfit)}
              tone={cardTone(data.netProfit)}
              hint={`${money(data.revenue)} revenue less ${money(data.expenses)} expenses`}
            />
          </div>

          <div className="acc-grid-2">
            {/* Cash broken out per account, so a bank balance that has drifted
                negative is visible rather than netted away in the headline. */}
            <div className="acc-panel">
              <div className="acc-panel-head">
                <div>
                  <h2>Cash &amp; bank accounts</h2>
                  <p>Balance in each account right now</p>
                </div>
                {/* The full picture — opening, movement and closing per
                    account, ruled as a cash book — lives one level down. */}
                <Link className="acc-link" to="/finance/cash-bank">View all</Link>
              </div>
              <Table
                selectable={false}
                data={data.cash.map((account) => ({ ...account, id: account.code }))}
                columns={[
                  {
                    header: 'Account',
                    accessor: (account) => (
                      <Link className="acc-link" to={`/accounting/ledgers/account?account=${account.code}`}>
                        {account.name}
                      </Link>
                    ),
                  },
                  {
                    header: 'Balance',
                    className: 'acc-num',
                    accessor: (account) => (
                      <span className={numClass(account.balance)}>{money(account.balance)}</span>
                    ),
                  },
                ]}
                emptyMessage="No cash accounts yet."
                footer={
                  <tr>
                    <td>Total</td>
                    <td className={numClass(data.totalCash)}>{money(data.totalCash)}</td>
                  </tr>
                }
              />
            </div>

            {/* The day-to-day collection risk: whose pocket the uncollected cash
                is actually in. */}
            <div className="acc-panel">
              <div className="acc-panel-head">
                <div>
                  <h2>Riders holding cash</h2>
                  <p>Highest outstanding first</p>
                </div>
                <Link className="acc-link" to="/accounting/ledgers/rider">View all</Link>
              </div>
              <Table
                selectable={false}
                data={data.topRiderHoldings.map((rider) => ({ ...rider, id: rider.partyId }))}
                columns={[
                  {
                    header: 'Rider',
                    accessor: (rider) => (
                      <>
                        <Link className="acc-link" to={`/finance/ledger/rider/${rider.partyId}`}>
                          {rider.name}
                        </Link>
                        {rider.subtitle && <span className="acc-sub">{rider.subtitle}</span>}
                      </>
                    ),
                  },
                  {
                    header: 'Holding',
                    className: 'acc-num',
                    accessor: (rider) => <span className={numClass(rider.balance)}>{money(rider.balance)}</span>,
                  },
                ]}
                emptyMessage="No rider is holding COD right now."
              />
            </div>
          </div>

          {/* Flow for the period, as opposed to the positions above. */}
          <div className="acc-panel">
            <div className="acc-panel-head">
              <div>
                <h2>Movement this period</h2>
                <p>{data.range.label} · {data.entryCount} journal entries</p>
              </div>
            </div>
            <Table
              selectable={false}
              data={movement}
              columns={[
                { header: 'Movement', accessor: 'label' },
                {
                  header: 'Amount',
                  className: 'acc-num',
                  accessor: (row) => <span className="acc-num">{money(row.amount)}</span>,
                },
              ]}
            />
          </div>

          <div className="acc-panel">
            <div className="acc-panel-head">
              <div>
                <h2>Latest entries</h2>
                <p>Every money event posts here automatically</p>
              </div>
              <Link className="acc-link" to="/accounting/transactions/journal">Open journal</Link>
            </div>
            <Table
              selectable={false}
              data={data.recentEntries}
              columns={[
                {
                  header: 'Entry',
                  width: '130px',
                  accessor: (entry) => (
                    <Link className="acc-entry-no acc-link" to={`/accounting/transactions/journal?search=${entry.entryNo}`}>
                      {entry.entryNo}
                    </Link>
                  ),
                },
                { header: 'Date (BS)', width: '110px', accessor: 'bsDate' },
                {
                  header: 'Description',
                  accessor: (entry) => (
                    <>
                      {entry.memo || '—'}
                      <span className="acc-sub">
                        {entry.lines.map((line) => line.accountName).join(' · ')}
                      </span>
                    </>
                  ),
                },
                {
                  header: 'Amount',
                  width: '130px',
                  className: 'acc-num',
                  accessor: (entry) => <span className="acc-num">{money(entry.totalAmount)}</span>,
                },
              ]}
              emptyMessage="No entries yet. They appear as soon as a parcel is delivered or a settlement is paid."
            />
          </div>
        </>
      )}
    </>
  );
};

export default SummaryTab;
