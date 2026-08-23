import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import { getJournalEntry, reverseEntry, type JournalEntry } from '../../services/accounting.service';
import { formatMoney } from '../../utils/format';

/**
 * One journal entry as a voucher.
 *
 * Laid out as the printed J.V. it replaces - reference, explanation, debit,
 * credit, ruled to a total - rather than as a web table of the same columns.
 * That is not nostalgia: this is the document that gets printed, signed and
 * filed, and a form whose screen version and paper version have the same shape
 * is one nobody has to reconcile in their head.
 *
 * Blank rows are padded in for the same reason the paper form has them: they
 * say "this is the whole entry", where a table that simply stops does not.
 */
const MIN_ROWS = 8;

const JournalVoucherPage: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reversing, setReversing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntry(await getJournalEntry(id));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const lines = entry?.lines ?? [];
    return {
      debit: lines.reduce((sum, line) => sum + line.debit, 0),
      credit: lines.reduce((sum, line) => sum + line.credit, 0),
    };
  }, [entry]);

  const reverse = async () => {
    if (!entry) return;
    const reason = window.prompt('Reason for reversing this voucher:');
    // An empty reason is a cancelled prompt or a shrug. Neither is a reason,
    // and this entry is about to become permanent history either way.
    if (!reason?.trim()) return;

    setReversing(true);
    setError(null);
    try {
      await reverseEntry(entry.id, reason.trim());
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setReversing(false);
    }
  };

  const actions: TallyAction[] = [
    { key: 'F5', label: 'Print', onSelect: () => window.print() },
    {
      key: 'F8',
      label: 'Reverse',
      onSelect: () => void reverse(),
      // A voided voucher has already been answered by its reversal. Reversing
      // it again would just be a third entry saying nothing.
      disabled: !entry || entry.status === 'voided' || reversing,
    },
    { key: 'F12', label: 'Day book', onSelect: () => navigate('/accounting/transactions/journal') },
    { key: 'Escape', label: 'Back', onSelect: () => navigate(-1) },
  ];

  const lines = entry?.lines ?? [];
  const blanks = Math.max(0, MIN_ROWS - lines.length);

  return (
    <TallyPage
      title="Journal Voucher"
      period={entry ? `${entry.bsDate} · ${entry.periodKey}` : undefined}
      actions={actions}
      error={error}
      loading={loading}
    >
      {entry && (
        <div className="tly-voucher">
          {entry.status === 'voided' && (
            <p className="tly-note tly-note-danger">
              This voucher has been reversed
              {entry.reversalOfNo ? ` by ${entry.reversalOfNo}` : ''}. It is kept for the record;
              the reversal that cancels it carries the correction.
            </p>
          )}

          <div className="tly-voucher-meta">
            <span className="tly-field">
              <span>J.V. No.</span>
              <strong>{entry.entryNo}</strong>
            </span>
            <span className="tly-field">
              <span>Date</span>
              <strong>{entry.bsDate}</strong>
            </span>
          </div>

          <div className="tly-scroll">
            <table className="tly-sheet">
              <thead>
                <tr>
                  <th style={{ width: '18%' }}>Reference</th>
                  <th className="tly-explanation">Explanation</th>
                  <th className="tly-amt">Debit</th>
                  <th className="tly-amt">Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={index} className={line.credit > 0 ? 'tly-credit-line' : undefined}>
                    <td>{line.trackingId ?? line.accountCode}</td>
                    <td>
                      {line.accountName}
                      {line.partyName && <> — {line.partyName}</>}
                      {line.memo && (
                        <>
                          <br />
                          <span className="tly-muted">{line.memo}</span>
                        </>
                      )}
                    </td>
                    <td className="tly-amt">{line.debit > 0 ? formatMoney(line.debit) : ''}</td>
                    <td className="tly-amt">{line.credit > 0 ? formatMoney(line.credit) : ''}</td>
                  </tr>
                ))}

                {/* The narration sits in the explanation column under the lines,
                    where it does on the paper form. */}
                {entry.memo && (
                  <tr>
                    <td />
                    <td colSpan={3}>
                      <span className="tly-muted">Narration: </span>
                      {entry.memo}
                    </td>
                  </tr>
                )}

                {Array.from({ length: blanks }, (_, index) => (
                  <tr key={`blank-${index}`} className="tly-blank">
                    <td />
                    <td />
                    <td />
                    <td />
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td />
                  <td style={{ textAlign: 'right' }}>Total</td>
                  <td className="tly-amt">{formatMoney(totals.debit)}</td>
                  <td className="tly-amt">{formatMoney(totals.credit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="tly-signatures">
            <div className="tly-signature">
              <span className="tly-signature-name">{entry.postedByName ?? ' '}</span>
              <div className="tly-signature-rule" />
              Prepared by
            </div>
            <div className="tly-signature">
              <span className="tly-signature-name">&nbsp;</span>
              <div className="tly-signature-rule" />
              Approved by
            </div>
          </div>
        </div>
      )}
    </TallyPage>
  );
};

export default JournalVoucherPage;
