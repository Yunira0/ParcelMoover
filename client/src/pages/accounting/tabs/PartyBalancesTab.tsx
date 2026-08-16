import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Table from '../../../components/Table';
import FilterDropdown from '../../../components/FilterDropdown';
import { Banner } from '../ui';
import { money, numClass } from '../format';
import { listPartyBalances, type PartyBalance } from '../../../services/accounting.service';
import { apiErrorMessage } from '../../../utils/serverValidation';
import '../Accounting.css';

// Two questions, one screen: which riders are holding our cash, and where do we
// stand with each vendor. Both are the same control account broken down per
// party, which is exactly what a subledger is — so the shell renders this one
// component for both tabs. The party filter is cleared on the toggle, since a
// vendor is not a choice the rider list can offer.

const PartyBalancesTab: React.FC<{ partyType: 'vendor' | 'rider' }> = ({ partyType }) => {
  const navigate = useNavigate();
  const [partyId, setPartyId] = useState('');
  const [rows, setRows] = useState<PartyBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listPartyBalances(partyType, {}));
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load balances'));
    } finally {
      setLoading(false);
    }
  }, [partyType]);

  useEffect(() => {
    void load();
  }, [load]);

  const isRider = partyType === 'rider';
  const allLabel = isRider ? 'All riders' : 'All vendors';

  // Built from the rows already on screen rather than fetched separately: the
  // party list is bounded by the number of vendors and riders, and only parties
  // with ledger activity belong in a ledger filter anyway. The subtitle rides
  // along in the label so a party stays findable by it — SearchableSelect
  // matches on the label text, and this is the same "a · b" shape the account
  // ledger's dropdown uses.
  const partyOptions = useMemo(
    () => [
      { value: '', label: allLabel },
      ...rows.map((row) => ({
        value: row.partyId,
        label: row.subtitle ? `${row.name} · ${row.subtitle}` : row.name,
      })),
    ],
    [rows, allLabel],
  );

  const visible = useMemo(
    () => (partyId ? rows.filter((row) => row.partyId === partyId) : rows),
    [rows, partyId],
  );

  const total = useMemo(() => visible.reduce((sum, row) => sum + row.balance, 0), [visible]);

  // A party selected on one tab doesn't exist on the other, which would leave
  // the table blank with a name still showing in the picker.
  useEffect(() => {
    setPartyId('');
  }, [partyType]);

  return (
    <>
      <div className="acc-toolbar">
        <div className="acc-filters">
          <div className="acc-filter-wide">
            <FilterDropdown
              label={isRider ? 'RIDER' : 'VENDOR'}
              value={partyId}
              options={partyOptions}
              onChange={setPartyId}
              placeholder={allLabel}
              searchPlaceholder={isRider ? 'Search riders...' : 'Search vendors...'}
              ariaLabel={isRider ? 'Rider' : 'Vendor'}
            />
          </div>
        </div>
      </div>

      <Banner tone="info">
        {isRider
          ? 'A positive balance is cash that rider collected on delivery and has not yet remitted to the office.'
          : 'A positive balance is money the office owes the vendor. A negative one is money the vendor owes the office.'}
      </Banner>

      {error && <Banner tone="danger">{error}</Banner>}

      <Table
        selectable={false}
        loading={loading}
        loadingMessage="Loading balances…"
        data={visible.map((row) => ({ ...row, id: row.partyId }))}
        onRowClick={(row) => navigate(`/accounting/people/${partyType}/${row.partyId}?tab=ledger`)}
        columns={[
          {
            header: isRider ? 'Rider' : 'Vendor',
            accessor: (row) => (
              <>
                <span className="acc-link">{row.name}</span>
                {row.subtitle && <span className="acc-sub">{row.subtitle}</span>}
              </>
            ),
          },
          {
            header: 'Debits',
            width: '150px',
            className: 'acc-num',
            accessor: (row) => <span className="acc-num acc-muted">{money(row.debit)}</span>,
          },
          {
            header: 'Credits',
            width: '150px',
            className: 'acc-num',
            accessor: (row) => <span className="acc-num acc-muted">{money(row.credit)}</span>,
          },
          {
            header: 'Balance',
            width: '160px',
            className: 'acc-num',
            accessor: (row) => <span className={numClass(row.balance)}>{money(row.balance)}</span>,
          },
        ]}
        emptyMessage={partyId ? 'That party has no ledger activity.' : `No ${partyType} has any ledger activity yet.`}
        footer={
          <tr>
            <td>{visible.length} {isRider ? 'riders' : 'vendors'}</td>
            <td />
            <td />
            <td className={numClass(total)}>{money(total)}</td>
          </tr>
        }
      />
    </>
  );
};

export default PartyBalancesTab;
