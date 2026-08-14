import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Table from '../../../components/Table';
import SearchField from '../../../components/SearchField';
import { Banner } from '../ui';
import { money, numClass } from '../format';
import { listPartyBalances, type PartyBalance } from '../../../services/accounting.service';
import { apiErrorMessage } from '../../../utils/serverValidation';
import '../Accounting.css';

// Two questions, one screen: which riders are holding our cash, and where do we
// stand with each vendor. Both are the same control account broken down per
// party, which is exactly what a subledger is — so the shell renders this one
// component for both tabs and the text filter survives the toggle.

const PartyBalancesTab: React.FC<{ partyType: 'vendor' | 'rider' }> = ({ partyType }) => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
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

  // Filtered here rather than server-side: the party list is bounded by the
  // number of vendors and riders, and filtering locally keeps typing instant.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) => row.name.toLowerCase().includes(needle) || (row.subtitle ?? '').toLowerCase().includes(needle),
    );
  }, [rows, search]);

  const total = useMemo(() => visible.reduce((sum, row) => sum + row.balance, 0), [visible]);

  const isRider = partyType === 'rider';

  return (
    <>
      <div className="acc-toolbar">
        <label className="acc-filter-wide">
          <span>SEARCH</span>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder={isRider ? 'Search riders' : 'Search vendors'}
          />
        </label>
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
        emptyMessage={search ? 'Nobody matches that search.' : `No ${partyType} has any ledger activity yet.`}
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
