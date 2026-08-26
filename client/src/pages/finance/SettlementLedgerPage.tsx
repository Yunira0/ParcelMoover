import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import LedgerSummary from '../../components/finance/LedgerSummary';
import FilterDropdown from '../../components/FilterDropdown';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import Pagination from '../../components/Pagination';
import {
  getPartySettlementLedger,
  listPartyBalances,
  type PartyBalance,
  type PartySettlementLedger,
} from '../../services/accounting.service';
import { drCr, formatMoney } from '../../utils/format';
import { downloadExcel } from '../../utils/excel';

/**
 * A rider's or vendor's ledger, statement by statement.
 *
 * Nothing accrues per parcel: the balance moves when a statement is raised and
 * again as each instalment lands, which is why one statement produces two rows
 * on two dates rather than one row that averages them.
 */
const MIN_ROWS = 20;

type PartyType = 'rider' | 'vendor';

const BALANCE_HEADER: Record<PartyType, string> = {
  rider: 'With rider',
  vendor: 'Owed',
};

const SettlementLedgerPage: React.FC = () => {
  const { partyType = 'rider', partyId = '' } = useParams<{ partyType: PartyType; partyId: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [parties, setParties] = useState<PartyBalance[]>([]);
  const [ledger, setLedger] = useState<PartySettlementLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(MIN_ROWS);

  const type: PartyType = partyType === 'vendor' ? 'vendor' : 'rider';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  const load = useCallback(async () => {
    if (!partyId) return;
    setLoading(true);
    setError(null);
    try {
      setLedger(
        await getPartySettlementLedger(type, partyId, {
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          page,
          pageSize,
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [type, partyId, from, to, page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  // Switching party, or narrowing the date range, starts back at page 1.
  useEffect(() => {
    setPage(1);
  }, [type, partyId, from, to]);

  useEffect(() => {
    listPartyBalances(type)
      .then(setParties)
      .catch(() => {
        // The picker is a convenience; a sheet that loaded is still readable
        // without it.
      });
  }, [type]);

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  };

  const debitNormal = type === 'rider';

  const exportSheet = () => {
    if (!ledger) return;
    downloadExcel(
      `ledger-${type}-${ledger.partyName}`,
      ledger.partyName,
      ['Date', 'Particulars / Description', 'Reference', 'Receipt', 'Payment', 'Balance'],
      ledger.rows.map((row) => [
        row.bsDate,
        row.description,
        row.reference,
        row.debit || '',
        row.credit || '',
        drCr(row.runningBalance, debitNormal),
      ]),
    );
  };

  const actions: TallyAction[] = [
    { key: 'F5', label: 'Print', onSelect: () => window.print() },
    { key: 'F7', label: 'Export', onSelect: exportSheet, disabled: !ledger },
    {
      key: 'F6',
      label: type === 'rider' ? 'Vendor ledgers' : 'Rider ledgers',
      onSelect: () => navigate(`/accounting/ledgers/${type === 'rider' ? 'vendor' : 'rider'}`),
    },
    { key: 'F12', label: 'Day book', onSelect: () => navigate('/accounting/transactions/journal') },
    { key: 'Escape', label: 'Back', onSelect: () => navigate(-1) },
  ];

  const rows = ledger?.rows ?? [];
  const blanks = Math.max(0, pageSize - rows.length);
  // Numbering continues across pages rather than restarting at 1, and the
  // "Opening balance carried forward" row only makes sense once, at the very
  // start of the range - every later page's first row already carries the
  // running balance forward from the page before it.
  const rowOffset = ((ledger?.page ?? page) - 1) * (ledger?.pageSize ?? pageSize);
  const isFirstPage = (ledger?.page ?? page) === 1;

  const filters = (
    <>
      <FilterDropdown
        label={type === 'rider' ? 'RIDER' : 'VENDOR'}
        value={partyId}
        ariaLabel={type === 'rider' ? 'Rider' : 'Vendor'}
        placeholder={`Select ${type}`}
        searchPlaceholder={`Search ${type}s...`}
        options={parties.map((party) => ({
          value: party.partyId,
          label: party.subtitle ? `${party.name} — ${party.subtitle}` : party.name,
        }))}
        onChange={(next) => next && navigate(`/finance/ledger/${type}/${next}`)}
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
      title={type === 'rider' ? 'Rider Ledger' : 'Vendor Ledger'}
      period={ledger?.range.label}
      periodLabel="Time Period"
      actions={actions}
      filters={filters}
      error={error}
      loading={loading}
    >
      {ledger && (
        <>
          <div className="tly-partybar">
            <span className="tly-field">
              <span>{type === 'rider' ? 'Rider' : 'Vendor'}</span>
              <strong>{ledger.partyName}</strong>
            </span>
            {ledger.partySubtitle && (
              <span className="tly-field">
                <span>Contact</span>
                <strong>{ledger.partySubtitle}</strong>
              </span>
            )}
          </div>

          <div className="tly-scroll">
            <table className="tly-sheet tly-sheet-form">
              <thead>
                <tr>
                  <th style={{ width: '4%' }}>No</th>
                  <th style={{ width: '11%' }}>Date</th>
                  <th>Particulars / Description</th>
                  <th style={{ width: '15%' }}>Reference</th>
                  <th className="tly-amt">Receipt</th>
                  <th className="tly-amt">Payment</th>
                  <th className="tly-amt">{BALANCE_HEADER[type]}</th>
                </tr>
              </thead>
              <tbody>
                {isFirstPage && (
                  <tr>
                    <td />
                    <td />
                    <td className="tly-muted">Opening balance carried forward</td>
                    <td className="tly-muted">OPENING</td>
                    <td className="tly-amt">–</td>
                    <td className="tly-amt">–</td>
                    <td className="tly-amt">{drCr(ledger.openingBalance, debitNormal)}</td>
                  </tr>
                )}

                {rows.map((row, index) => (
                  <tr
                    key={row.id}
                    onClick={row.entryId ? () => navigate(`/finance/voucher/${row.entryId}`) : undefined}
                    style={row.entryId ? { cursor: 'pointer' } : undefined}
                  >
                    <td>{rowOffset + index + 1}</td>
                    <td>{row.bsDate}</td>
                    <td>{row.description}</td>
                    <td>{row.reference}</td>
                    <td className="tly-amt">{row.debit > 0 ? formatMoney(row.debit) : '–'}</td>
                    <td className="tly-amt">{row.credit > 0 ? formatMoney(row.credit) : '–'}</td>
                    <td className="tly-amt">{drCr(row.runningBalance, debitNormal)}</td>
                  </tr>
                ))}

                {Array.from({ length: blanks }, (_, index) => (
                  <tr key={`blank-${index}`} className="tly-blank">
                    <td>{rowOffset + rows.length + index + 1}</td>
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
                    {type === 'rider' ? 'Still with the rider' : 'Still owed to the vendor'}
                  </td>
                  <td className="tly-amt">{drCr(ledger.closingBalance, debitNormal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <Pagination
            ariaLabel="Settlement ledger pagination"
            page={ledger.page}
            totalPages={ledger.totalPages}
            onPageChange={setPage}
            pageSize={pageSize}
            pageSizeLabel="rows"
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            summary={`${ledger.totalRows} movement${ledger.totalRows === 1 ? '' : 's'}`}
          />

          <LedgerSummary
            title={type === 'rider' ? 'Rider Summary' : 'Vendor Summary'}
            lines={ledger.summary.map((line, index) => ({
              label: line.label,
              // Only the closing line is a balance; the totals above it are
              // sums and a side on them would be meaningless.
              value:
                index === ledger.summary.length - 1
                  ? drCr(line.amount, debitNormal)
                  : formatMoney(line.amount),
            }))}
          />
        </>
      )}
    </TallyPage>
  );
};

export default SettlementLedgerPage;
