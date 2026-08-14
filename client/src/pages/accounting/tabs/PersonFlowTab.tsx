import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import StatCard from '../../../components/StatCard';
import Table from '../../../components/Table';
import FilterDropdown from '../../../components/FilterDropdown';
import PeriodPicker from '../PeriodPicker';
import { Banner } from '../ui';
import { cardTone, money, numClass } from '../format';
import { defaultRange, rangeParams, type RangeSelection } from '../range';
import { getPartyStatement, type PartyStatement } from '../../../services/accounting.service';
import { apiErrorMessage } from '../../../utils/serverValidation';
import '../Accounting.css';

// One person's whole money flow: every rupee in and out, grouped by account and
// then listed movement by movement. The Ledger tab beside this one is the same
// person seen through a single control account; this one spans every account
// they ever touched, which is the question people actually ask.

const DIRECTION_OPTIONS = [
  { value: 'all', label: 'Money in and out' },
  { value: 'in', label: 'Money in' },
  { value: 'out', label: 'Money out' },
];

interface PersonFlowTabProps {
  partyType: string;
  partyId: string;
  onTitle: (name: string) => void;
}

const PersonFlowTab: React.FC<PersonFlowTabProps> = ({ partyType, partyId, onTitle }) => {
  const navigate = useNavigate();

  const [range, setRange] = useState<RangeSelection>(defaultRange);
  const [statement, setStatement] = useState<PartyStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Movement filters. Both are local: the statement is one person over one
  // period, so it is small enough that filtering in the browser is instant and
  // a round trip would only add lag.
  const [accountCode, setAccountCode] = useState('all');
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');

  const load = useCallback(async () => {
    if (!partyType || !partyId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getPartyStatement(partyType, partyId, rangeParams(range));
      setStatement(data);
      onTitle(data.name);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load this statement'));
    } finally {
      setLoading(false);
    }
  }, [partyType, partyId, range, onTitle]);

  useEffect(() => {
    void load();
  }, [load]);

  // The journal opens unscoped by default, so an entry number alone finds it
  // whichever period it sits in.
  const openEntry = (entryNo: string) =>
    navigate(`/accounting/transactions/journal?search=${encodeURIComponent(entryNo)}`);

  const spend = useMemo(() => statement?.groups.filter((g) => g.type === 'expense') ?? [], [statement]);
  const position = useMemo(() => statement?.groups.filter((g) => g.type !== 'expense') ?? [], [statement]);

  const movements = useMemo(() => {
    const rows = statement?.movements ?? [];
    return rows.filter((row) => {
      if (accountCode !== 'all' && row.accountCode !== accountCode) return false;
      if (direction === 'in' && !row.credit) return false;
      if (direction === 'out' && !row.debit) return false;
      return true;
    });
  }, [statement, accountCode, direction]);

  const totals = useMemo(
    () =>
      movements.reduce(
        (acc, row) => ({ debit: acc.debit + row.debit, credit: acc.credit + row.credit }),
        { debit: 0, credit: 0 },
      ),
    [movements],
  );

  return (
    <>
      <div className="acc-toolbar">
        <PeriodPicker value={range} onChange={setRange} />
      </div>

      {error && <Banner tone="danger">{error}</Banner>}
      {loading && !statement && <Banner tone="info">Loading statement…</Banner>}

      {statement && (
        <>
          <div className="acc-cards">
            <StatCard
              label="Collected through them"
              value={money(statement.collected)}
              tone="positive"
              hint="COD taken in on their deliveries"
            />
            <StatCard
              label="Spent on them"
              value={money(statement.paidOut)}
              tone="negative"
              hint="Fuel, salary, maintenance and other costs"
            />
            {position.map((group) => (
              <StatCard
                key={group.code}
                label={group.name}
                value={money(group.balance)}
                tone={cardTone(group.balance)}
                hint={
                  group.code === '1010'
                    ? 'Cash still in their hands'
                    : group.code === '2000'
                      ? group.balance >= 0 ? 'We owe them' : 'They owe us'
                      : `Account ${group.code}`
                }
              />
            ))}
          </div>

          {/* Every account this person touched, before the movement-by-movement
              detail — the shape of the flow first, then the proof of it. */}
          {statement.groups.length > 0 && (
            <div className="acc-panel">
              <div className="acc-panel-head">
                <div>
                  <h2>Where the money moved</h2>
                  <p>{statement.range.label}</p>
                </div>
              </div>
              <Table
                selectable={false}
                data={statement.groups.map((group) => ({ ...group, id: group.code }))}
                onRowClick={(group) => setAccountCode(group.code)}
                columns={[
                  { header: 'Account', accessor: (group) => <span className="acc-link">{group.name}</span> },
                  {
                    header: 'Type',
                    width: '120px',
                    accessor: (group) => <span className="acc-muted">{group.type}</span>,
                  },
                  {
                    header: 'Out (debit)',
                    width: '140px',
                    className: 'acc-num',
                    accessor: (group) => (
                      <span className="acc-num acc-muted">{group.debit ? money(group.debit) : ''}</span>
                    ),
                  },
                  {
                    header: 'In (credit)',
                    width: '140px',
                    className: 'acc-num',
                    accessor: (group) => (
                      <span className="acc-num acc-muted">{group.credit ? money(group.credit) : ''}</span>
                    ),
                  },
                  {
                    header: 'Balance',
                    width: '150px',
                    className: 'acc-num',
                    accessor: (group) => <span className={numClass(group.balance)}>{money(group.balance)}</span>,
                  },
                ]}
              />
            </div>
          )}

          {spend.length > 0 && (
            <div className="acc-panel">
              <div className="acc-panel-head">
                <div>
                  <h2>What {statement.name} has cost</h2>
                  <p>{statement.range.label}</p>
                </div>
              </div>
              <Table
                selectable={false}
                data={spend.map((group) => ({ ...group, id: group.code }))}
                columns={[
                  { header: 'Cost', accessor: 'name' },
                  {
                    header: 'Amount',
                    width: '180px',
                    className: 'acc-num',
                    accessor: (group) => <span className="acc-num acc-neg">{money(group.balance)}</span>,
                  },
                ]}
                footer={
                  <tr>
                    <td>Total spent</td>
                    <td className="acc-num acc-neg">{money(statement.paidOut)}</td>
                  </tr>
                }
              />
            </div>
          )}

          <div className="acc-panel">
            <div className="acc-panel-head">
              <div>
                <h2>Every movement</h2>
                <p>
                  {movements.length === statement.movements.length
                    ? `${statement.movements.length} entries in ${statement.range.label}`
                    : `${movements.length} of ${statement.movements.length} entries in ${statement.range.label}`}
                </p>
              </div>
              <div className="acc-filters">
                <div className="acc-filter">
                  <FilterDropdown
                    label="ACCOUNT"
                    value={accountCode}
                    options={[
                      { value: 'all', label: 'All accounts' },
                      ...statement.groups.map((group) => ({ value: group.code, label: group.name })),
                    ]}
                    onChange={setAccountCode}
                    ariaLabel="Filter by account"
                  />
                </div>
                <div className="acc-filter">
                  <FilterDropdown
                    label="DIRECTION"
                    value={direction}
                    options={DIRECTION_OPTIONS}
                    onChange={(value) => setDirection(value as 'all' | 'in' | 'out')}
                    ariaLabel="Filter by direction"
                  />
                </div>
              </div>
            </div>
            <Table
              selectable={false}
              data={movements.map((row, index) => ({ ...row, id: `${row.entryId}-${index}` }))}
              onRowClick={(row) => openEntry(row.entryNo)}
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
                { header: 'Account', width: '200px', accessor: 'accountName' },
                {
                  header: 'Debit',
                  width: '130px',
                  className: 'acc-num',
                  accessor: (row) => <span className="acc-num">{row.debit ? money(row.debit) : ''}</span>,
                },
                {
                  header: 'Credit',
                  width: '130px',
                  className: 'acc-num',
                  accessor: (row) => <span className="acc-num">{row.credit ? money(row.credit) : ''}</span>,
                },
              ]}
              emptyMessage={
                statement.movements.length === 0
                  ? `Nothing moved for ${statement.name} during ${statement.range.label}.`
                  : 'No movement matches these filters.'
              }
              footer={
                <tr>
                  <td colSpan={4}>{movements.length} movements</td>
                  <td className="acc-num">{money(totals.debit)}</td>
                  <td className="acc-num">{money(totals.credit)}</td>
                </tr>
              }
            />
          </div>
        </>
      )}
    </>
  );
};

export default PersonFlowTab;
