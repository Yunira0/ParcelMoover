import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Undo2, X } from 'lucide-react';
import Button from '../../../components/Button';
import Pagination from '../../../components/Pagination';
import FilterDropdown from '../../../components/FilterDropdown';
import FormField from '../../../components/FormField';
import SearchField from '../../../components/SearchField';
import PeriodPicker from '../PeriodPicker';
import { Banner, EntryStatusChip } from '../ui';
import { money } from '../format';
import { rangeParams, type RangeSelection } from '../range';
import ManualEntryModal from '../ManualEntryModal';
import {
  listJournal,
  reverseEntry,
  type JournalEntry,
} from '../../../services/accounting.service';
import { hasAdminPermission } from '../../../utils/auth';
import { apiErrorMessage } from '../../../utils/serverValidation';
import '../../../components/Modal.css';
import '../../../components/finance/tally.css';
import '../Accounting.css';

// The full day book, ruled as the journal it is: S.No, the transaction in
// plain words, the entry's debit and credit lines side by side, and the
// amount — the same shape as a bound journal page, not a dashboard table.
// Every line is printed here rather than behind an expander, because a
// journal you have to click through to see the debits and credits is not a
// journal.
//
// The "New entry" button lives on the shell's PageHeader, so the modal is opened
// from outside; the modal itself stays here because saving has to reload this
// tab's own list.

const SOURCE_LABELS: Record<string, string> = {
  cod_collection: 'COD collected',
  parcel: 'Delivery charge',
  settlement: 'Settlement',
  vendor_payment: 'Vendor payment',
  expense: 'Expense',
  manual: 'Manual entry',
  reversal: 'Reversal',
  opening_balance: 'Opening balance',
};

const SOURCE_OPTIONS = [
  { value: 'all', label: 'All sources' },
  ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label })),
];

/**
 * What each source is as a voucher type.
 *
 * A day book names the kind of voucher, not the subsystem that raised it —
 * money coming in is a Receipt whether it came off a delivery or a remittance.
 * The source itself is still what the filter above selects on.
 */
const VOUCHER_TYPES: Record<string, string> = {
  cod_collection: 'Receipt',
  settlement: 'Receipt',
  parcel: 'Sales',
  vendor_payment: 'Payment',
  expense: 'Payment',
  manual: 'Journal',
  reversal: 'Journal',
  opening_balance: 'Journal',
};

const STATUS_OPTIONS = [
  { value: 'posted', label: 'Posted only' },
  { value: 'voided', label: 'Voided only' },
  { value: 'all', label: 'Posted and voided' },
];

interface JournalTabProps {
  newEntryOpen: boolean;
  onNewEntryClose: () => void;
}

const JournalTab: React.FC<JournalTabProps> = ({ newEntryOpen, onNewEntryClose }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const canWrite = hasAdminPermission('ACCOUNTING_ACCESS');

  // A range is optional here, unlike the reports: the common use is "find this
  // entry", which should not be scoped to a month by default.
  const [range, setRange] = useState<RangeSelection>({ mode: 'custom' });
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [sourceType, setSourceType] = useState('all');
  const [status, setStatus] = useState('posted');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [data, setData] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reversing, setReversing] = useState<JournalEntry | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseError, setReverseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listJournal({
        ...rangeParams(range),
        page,
        pageSize,
        search: search.trim() || undefined,
        sourceType: sourceType === 'all' ? undefined : sourceType,
        status,
      });
      setData(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load the journal'));
    } finally {
      setLoading(false);
    }
  }, [range, page, pageSize, search, sourceType, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
    const next = new URLSearchParams(searchParams);
    if (value) next.set('search', value);
    else next.delete('search');
    setSearchParams(next, { replace: true });
  };

  const submitReversal = async () => {
    if (!reversing) return;
    setSaving(true);
    setReverseError(null);
    try {
      await reverseEntry(reversing.id, reverseReason);
      setReversing(null);
      setReverseReason('');
      await load();
    } catch (err) {
      setReverseError(apiErrorMessage(err, 'Could not reverse this entry'));
    } finally {
      setSaving(false);
    }
  };

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  const pageTotal = useMemo(
    () => data.reduce((sum, entry) => sum + entry.totalAmount, 0),
    [data],
  );

  return (
    <>
      <div className="acc-toolbar">
        <div className="acc-filters">
          <label className="acc-filter-wide" aria-label="Search entries">
            <span>SEARCH</span>
            <SearchField
              value={search}
              onChange={onSearchChange}
              placeholder="Entry number or description"
            />
          </label>

          <div className="acc-filter">
            <FilterDropdown
              label="SOURCE"
              value={sourceType}
              options={SOURCE_OPTIONS}
              onChange={(value) => { setSourceType(value); setPage(1); }}
              ariaLabel="Entry source"
            />
          </div>

          <div className="acc-filter">
            <FilterDropdown
              label="STATUS"
              value={status}
              options={STATUS_OPTIONS}
              onChange={(value) => { setStatus(value); setPage(1); }}
              ariaLabel="Entry status"
            />
          </div>
        </div>

        <PeriodPicker value={range} onChange={(next) => { setRange(next); setPage(1); }} />
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      <div className="tly-scroll">
        <table className="tly-sheet">
          <thead>
            <tr>
              <th rowSpan={2} style={{ width: '4%' }}>S.No</th>
              <th rowSpan={2} style={{ width: '27%' }}>Transactions</th>
              <th colSpan={2}>Journal Entries</th>
              <th rowSpan={2} className="tly-amt" style={{ width: '14%' }}>Amount</th>
              {canWrite && <th rowSpan={2} style={{ width: '48px' }}>&nbsp;</th>}
            </tr>
            <tr>
              <th style={{ width: '27%' }}>Dr. (Debit)</th>
              <th style={{ width: '27%' }}>Cr. (Credit)</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={canWrite ? 6 : 5} className="tly-muted">Loading entries…</td></tr>
            )}
            {!loading && data.length === 0 && (
              <tr>
                <td colSpan={canWrite ? 6 : 5} className="tly-muted">
                  No entries match. Entries are posted automatically as parcels are delivered and
                  settlements paid.
                </td>
              </tr>
            )}
            {!loading && data.map((entry, index) => {
              const debitLines = entry.lines.filter((line) => line.debit > 0);
              const creditLines = entry.lines.filter((line) => line.credit > 0);
              return (
                <tr key={entry.id} className={entry.status !== 'posted' ? 'tly-muted' : undefined}>
                  <td className="sno">{(page - 1) * pageSize + index + 1}</td>
                  <td>
                    <div>{entry.memo || VOUCHER_TYPES[entry.sourceType] || 'Journal entry'}</div>
                    <div className="tly-muted je-meta">
                      {/* The voucher number is the way into the printable
                          voucher, which carries the full lines and a place to
                          sign — this row already shows the breakdown, so
                          following the link is only for the document itself. */}
                      <Link to={`/finance/voucher/${entry.id}`}>{entry.entryNo}</Link>
                      {' · '}
                      {VOUCHER_TYPES[entry.sourceType] ?? 'Journal'}
                      {entry.postedByName && <> · by {entry.postedByName}</>}
                    </div>
                    {entry.reversalOfNo && <div className="tly-muted je-meta">reverses {entry.reversalOfNo}</div>}
                    {entry.status !== 'posted' && <EntryStatusChip status={entry.status} />}
                  </td>
                  <td>
                    {debitLines.map((line, i) => (
                      <div key={i} className="je-line">
                        <span className="je-acct">{line.accountName}</span>
                        {line.partyName && <span className="tly-muted"> — {line.partyName}</span>}
                        <span className="je-side">Dr.</span>
                        <span className="je-inline-amt">{money(line.debit)}</span>
                      </div>
                    ))}
                  </td>
                  <td>
                    {creditLines.map((line, i) => (
                      <div key={i} className="je-line je-line-cr">
                        <span className="je-to">To</span>
                        <span className="je-acct">{line.accountName}</span>
                        {line.partyName && <span className="tly-muted"> — {line.partyName}</span>}
                        <span className="je-inline-amt">{money(line.credit)}</span>
                      </div>
                    ))}
                  </td>
                  <td className="tly-amt">{money(entry.totalAmount)}</td>
                  {canWrite && (
                    <td>
                      {/* Only manual entries can be reversed by hand. An
                          automated one would simply be re-posted the next
                          time its source record is touched. */}
                      {entry.status === 'posted' && entry.sourceType === 'manual' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Reverse this entry"
                          aria-label={`Reverse ${entry.entryNo}`}
                          onClick={() => {
                            setReversing(entry);
                            setReverseReason('');
                            setReverseError(null);
                          }}
                        >
                          <Undo2 size={15} />
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {!loading && data.length > 0 && (
            <tfoot>
              <tr className="tly-grand">
                <td colSpan={4} style={{ textAlign: 'right' }}>Total for this page</td>
                <td className="tly-amt">{money(pageTotal)}</td>
                {canWrite && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        ariaLabel="Journal pages"
        summary={`${total} entr${total === 1 ? 'y' : 'ies'}`}
      />

      {newEntryOpen && (
        <ManualEntryModal
          onClose={onNewEntryClose}
          onSaved={() => {
            onNewEntryClose();
            void load();
          }}
        />
      )}

      {reversing && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Reverse {reversing.entryNo}</h2>
              <Button variant="ghost" onClick={() => setReversing(null)} aria-label="Close">
                <X size={18} />
              </Button>
            </div>
            <p className="modal-desc">
              This posts an equal and opposite entry and marks the original voided. Nothing is deleted —
              both stay in the books.
            </p>
            <FormField
              label="Reason"
              required
              type="textarea"
              value={reverseReason}
              onChange={setReverseReason}
              placeholder="Why is this being reversed?"
            />
            {reverseError && <p className="error-text">{reverseError}</p>}
            <div className="modal-footer">
              <Button variant="outline" onClick={() => setReversing(null)} disabled={saving}>Cancel</Button>
              <Button variant="danger" onClick={submitReversal} disabled={saving || reverseReason.trim().length < 3}>
                {saving ? 'Reversing…' : 'Reverse entry'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default JournalTab;
