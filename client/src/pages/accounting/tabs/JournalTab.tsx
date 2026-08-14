import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Undo2, X } from 'lucide-react';
import Button from '../../../components/Button';
import Table from '../../../components/Table';
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
import '../Accounting.css';

// The full day book. Every entry the system has ever posted, newest first, with
// its lines readable in place — a journal you have to click through twice to
// see the debits and credits is not a journal.
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

  const [data, setData] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set());
  const [reversing, setReversing] = useState<JournalEntry | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseError, setReverseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pageSize = 25;

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
  }, [range, page, search, sourceType, status]);

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

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total]);

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

      <Table
        selectable={false}
        loading={loading}
        loadingMessage="Loading entries…"
        data={data}
        expandedIds={expanded}
        columns={[
          {
            header: '',
            width: '44px',
            accessor: (entry) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toggle(entry.id)}
                aria-label={expanded.has(entry.id) ? 'Hide lines' : 'Show lines'}
                aria-expanded={expanded.has(entry.id)}
              >
                {expanded.has(entry.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </Button>
            ),
          },
          { header: 'Date (BS)', width: '110px', accessor: 'bsDate' },
          {
            header: 'Particulars',
            // The ledger the voucher is against, the way a day book names it —
            // the debit side, since that is what the money became. The
            // narration sits under it, as it does on the voucher itself.
            accessor: (entry) => {
              const debits = entry.lines.filter((line) => line.debit > 0);
              const lead = debits[0]?.accountName ?? entry.lines[0]?.accountName ?? '—';
              return (
                <>
                  <span className="acc-line-account">
                    {lead}
                    {debits.length > 1 && <span className="acc-sub">and {debits.length - 1} more</span>}
                  </span>
                  {entry.memo && <span className="acc-sub">{entry.memo}</span>}
                  {entry.postedByName && <span className="acc-sub">by {entry.postedByName}</span>}
                </>
              );
            },
          },
          {
            header: 'Vch Type',
            width: '120px',
            accessor: (entry) => (
              <span title={SOURCE_LABELS[entry.sourceType] ?? entry.sourceType}>
                {VOUCHER_TYPES[entry.sourceType] ?? 'Journal'}
              </span>
            ),
          },
          {
            header: 'Vch No.',
            width: '160px',
            accessor: (entry) => (
              <>
                <span className="acc-entry-no">{entry.entryNo}</span>
                {entry.reversalOfNo && <span className="acc-sub">reverses {entry.reversalOfNo}</span>}
                {/* Only worth a chip when it is not the ordinary case. */}
                {entry.status !== 'posted' && <EntryStatusChip status={entry.status} />}
              </>
            ),
          },
          {
            header: 'Debit',
            width: '130px',
            className: 'acc-num',
            accessor: (entry) => <span className="acc-num">{money(entry.totalAmount)}</span>,
          },
          {
            header: 'Credit',
            width: '130px',
            className: 'acc-num',
            // Equal to the debit by construction — a day book prints both
            // columns anyway, because the pair is the proof it balanced.
            accessor: (entry) => <span className="acc-num">{money(entry.totalAmount)}</span>,
          },
          ...(canWrite
            ? [{
                header: '',
                width: '60px',
                // Only manual entries can be reversed by hand. An automated one
                // would simply be re-posted the next time its source record is
                // touched.
                accessor: (entry: JournalEntry) =>
                  entry.status === 'posted' && entry.sourceType === 'manual' ? (
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
                  ) : null,
              }]
            : []),
        ]}
        renderExpandedRow={(entry) => (
          <ul className="acc-lines">
            {entry.lines.map((line, index) => {
              const isCredit = line.credit > 0;
              return (
                <li key={index} className={`acc-line ${isCredit ? 'acc-line-credit' : ''}`}>
                  {/* By what was debited, To what was credited. */}
                  <span className="acc-line-prefix">{isCredit ? 'To' : 'By'}</span>
                  <span className="acc-line-account">
                    {line.accountName}
                    {line.partyName && <span className="acc-sub">{line.partyName}</span>}
                    {line.trackingId && <span className="acc-sub">{line.trackingId}</span>}
                    {line.memo && <span className="acc-sub">{line.memo}</span>}
                  </span>
                  <span className="acc-line-amount">{isCredit ? '' : money(line.debit)}</span>
                  <span className="acc-line-amount">{isCredit ? money(line.credit) : ''}</span>
                </li>
              );
            })}
          </ul>
        )}
        emptyMessage="No entries match. Entries are posted automatically as parcels are delivered and settlements paid."
      />

      {/* What a day book carries at the foot of the page: this page's columns
          added up. Page, not the whole filtered set — it totals what is printed
          above it, which is the only figure the reader can check by eye. */}
      {!loading && data.length > 0 && (
        <div className="acc-daybook-total">
          <span>Total for this page</span>
          <span className="acc-num">{money(pageTotal)}</span>
          <span className="acc-num">{money(pageTotal)}</span>
        </div>
      )}

      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          ariaLabel="Journal pages"
          summary={`${total} entr${total === 1 ? 'y' : 'ies'}`}
        />
      )}

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
