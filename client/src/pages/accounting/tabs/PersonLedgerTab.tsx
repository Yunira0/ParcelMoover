import React, { useCallback, useEffect, useState } from 'react';
import StatCard from '../../../components/StatCard';
import Table from '../../../components/Table';
import PeriodPicker from '../PeriodPicker';
import { Banner } from '../ui';
import { cardTone, money, numClass } from '../format';
import { defaultRange, rangeParams, type RangeSelection } from '../range';
import { getPartyLedger, type PartyLedger } from '../../../services/accounting.service';
import { apiErrorMessage } from '../../../utils/serverValidation';
import '../Accounting.css';

// One vendor's or one rider's control account: the same shape as an account
// ledger, filtered to a single party — which is what makes it a statement you
// could hand to them. Only vendors and riders have one, so the shell hides this
// tab entirely for staff.

interface PersonLedgerTabProps {
  partyType: 'vendor' | 'rider';
  partyId: string;
  onTitle: (name: string) => void;
}

const PersonLedgerTab: React.FC<PersonLedgerTabProps> = ({ partyType, partyId, onTitle }) => {
  const [range, setRange] = useState<RangeSelection>(defaultRange);
  const [ledger, setLedger] = useState<PartyLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!partyId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getPartyLedger(partyType, partyId, rangeParams(range));
      setLedger(data);
      onTitle(data.partyName);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load this ledger'));
    } finally {
      setLoading(false);
    }
  }, [partyType, partyId, range, onTitle]);

  useEffect(() => {
    void load();
  }, [load]);

  const isRider = partyType === 'rider';

  // Same as the account ledger: the running balance needs the figure it runs on
  // from, and an empty period should still read as empty.
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
        <PeriodPicker value={range} onChange={setRange} />
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      {ledger && (
        <>
          <div className="acc-cards">
            <StatCard
              label="Opening"
              value={money(ledger.openingBalance)}
              tone={cardTone(ledger.openingBalance)}
            />
            <StatCard
              label={isRider ? 'Collected' : 'Charged & paid out'}
              value={money(ledger.totalDebit)}
            />
            <StatCard
              label={isRider ? 'Remitted' : 'COD & payments in'}
              value={money(ledger.totalCredit)}
            />
            <StatCard
              label="Closing"
              value={money(ledger.closingBalance)}
              tone={cardTone(ledger.closingBalance)}
              hint={
                isRider
                  ? ledger.closingBalance > 0 ? 'Still to remit' : 'Fully settled'
                  : ledger.closingBalance > 0 ? 'We owe them' : ledger.closingBalance < 0 ? 'They owe us' : 'Square'
              }
            />
          </div>

          <div className="acc-panel">
            <div className="acc-panel-head">
              <div>
                <h2>{ledger.range.label}</h2>
                <p>{ledger.rows.length} movements on {ledger.account.name}</p>
              </div>
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
                { header: 'Reference', accessor: (row) => row.memo || '—' },
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
              emptyMessage={`No activity during ${ledger.range.label}.`}
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

export default PersonLedgerTab;
