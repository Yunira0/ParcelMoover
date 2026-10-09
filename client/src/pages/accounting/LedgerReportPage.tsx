import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import FilterDropdown from '../../components/FilterDropdown';
import {
  dayBookAction,
  exportAction,
  printAction,
  quitAction,
  voucherActions,
} from '../../components/finance/tallyKeys';
import { listPartyBalances, type PartyBalance } from '../../services/accounting.service';
import { hasAdminPermission } from '../../utils/auth';
import { drCr, formatAmount } from '../../utils/format';
import { downloadExcel } from '../../utils/excel';
import { useBackOr } from '../../hooks/useBackOr';

// The rider and vendor ledgers, as TallyPrime's Group Summary: one row per
// party with what they were raised for, what was settled, and the closing
// balance, ruled off to a Grand Total. A row opens that party's own ledger.
//
// Read from the statements: a rider's balance is COD statemented less what they
// have settled (still with the rider, a debit); a vendor's is payable raised
// less what was paid out (owed to the vendor, a credit).

type PartyView = 'vendor' | 'rider';

const TITLE: Record<PartyView, string> = {
  rider: 'Group Summary: Riders',
  vendor: 'Group Summary: Vendors',
};

const LedgerReportPage: React.FC<{ view: PartyView }> = ({ view }) => {
  const navigate = useNavigate();
  const goBack = useBackOr('/accounting');
  const canWrite = hasAdminPermission('ACCOUNTING_ACCESS');
  const isRider = view === 'rider';

  const [partyId, setPartyId] = useState('');
  const [rows, setRows] = useState<PartyBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listPartyBalances(view, {}));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [view]);

  useEffect(() => {
    void load();
  }, [load]);

  // A party picked on one list doesn't exist on the other.
  const [lastView, setLastView] = useState(view);
  if (view !== lastView) {
    setLastView(view);
    setPartyId('');
  }

  const visible = useMemo(() => (partyId ? rows.filter((row) => row.partyId === partyId) : rows), [rows, partyId]);
  const totals = useMemo(
    () => visible.reduce(
      (sum, row) => ({ debit: sum.debit + row.debit, credit: sum.credit + row.credit, balance: sum.balance + row.balance }),
      { debit: 0, credit: 0, balance: 0 },
    ),
    [visible],
  );

  const partyOptions = useMemo(
    () => [
      { value: '', label: isRider ? 'All riders' : 'All vendors' },
      ...rows.map((row) => ({ value: row.partyId, label: row.subtitle ? `${row.name} · ${row.subtitle}` : row.name })),
    ],
    [rows, isRider],
  );

  // The balance as a side: a rider's runs debit-normal, a vendor's credit.
  const balanceOf = (value: number) => drCr(value, isRider);

  const exportSheet = useCallback(async () => {
    await downloadExcel(
      `group-summary-${view}s`,
      isRider ? 'Riders' : 'Vendors',
      ['Particulars', 'Contact', 'Debit', 'Credit', 'Closing Balance'],
      visible.map((row) => [row.name, row.subtitle ?? '', row.debit, row.credit, drCr(row.balance, isRider)]),
    );
  }, [view, isRider, visible]);

  const actions: TallyAction[] = useMemo(() => [
    ...(canWrite ? voucherActions(navigate) : []),
    {
      key: 'Alt+S',
      label: isRider ? 'Switch to vendors' : 'Switch to riders',
      onSelect: () => navigate(`/accounting/ledgers/${isRider ? 'vendor' : 'rider'}`),
    },
    { key: 'Alt+G', label: 'Go to person', onSelect: () => navigate('/accounting/people/search') },
    printAction(),
    exportAction(() => void exportSheet(), visible.length === 0),
    dayBookAction(navigate),
    quitAction(goBack),
  ], [canWrite, navigate, isRider, exportSheet, visible.length, goBack]);

  const filters = (
    <FilterDropdown
      label={isRider ? 'RIDER' : 'VENDOR'}
      value={partyId}
      options={partyOptions}
      onChange={setPartyId}
      placeholder={isRider ? 'All riders' : 'All vendors'}
      searchPlaceholder={isRider ? 'Search riders...' : 'Search vendors...'}
      ariaLabel={isRider ? 'Rider' : 'Vendor'}
    />
  );

  return (
    <TallyPage
      title={TITLE[view]}
      period="As at today"
      periodLabel="Closing"
      actions={actions}
      filters={filters}
      error={error}
      menu
    >
      <div className="tly-voucher jv">
        <div className="jv-meta">
          <div className="jv-meta-field">
            <span>Group :</span>
            <strong>{isRider ? 'COD with riders' : 'COD payable to vendors'}</strong>
          </div>
          <div className="jv-meta-field jv-meta-no">
            <span>{isRider ? 'Riders' : 'Vendors'} :</span>
            <strong>{visible.length}</strong>
          </div>
        </div>

        <div className="tly-scroll">
          <table className="tly-sheet jv-sheet jv-report">
            <thead>
              <tr>
                <th className="jv-col-account">Particulars</th>
                <th className="tly-amt">Debit</th>
                <th className="tly-amt">Credit</th>
                <th className="tly-amt">Closing Balance</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr className="jv-empty"><td colSpan={4}>Loading balances…</td></tr>}
              {!loading && visible.length === 0 && (
                <tr className="jv-empty"><td colSpan={4}>No {view} has any ledger activity yet.</td></tr>
              )}
              {!loading && visible.map((row) => (
                <tr key={row.partyId} className="jv-row" onClick={() => navigate(`/finance/ledger/${view}/${row.partyId}`)}>
                  <td>
                    <strong>{row.name}</strong>
                    {row.subtitle && <span className="tly-muted"> · {row.subtitle}</span>}
                  </td>
                  <td className="tly-amt">{row.debit ? formatAmount(row.debit) : ''}</td>
                  <td className="tly-amt">{row.credit ? formatAmount(row.credit) : ''}</td>
                  <td className="tly-amt">{balanceOf(row.balance)}</td>
                </tr>
              ))}
            </tbody>
            {!loading && visible.length > 0 && (
              <tfoot>
                <tr className="jv-foot-total jv-foot-closing">
                  <td className="jv-foot-label">Grand Total</td>
                  <td className="tly-amt">{formatAmount(totals.debit)}</td>
                  <td className="tly-amt">{formatAmount(totals.credit)}</td>
                  <td className="tly-amt">{balanceOf(totals.balance)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </TallyPage>
  );
};

export default LedgerReportPage;
