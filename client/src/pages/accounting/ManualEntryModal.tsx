import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import PartyPicker, { type PickedParty } from './PartyPicker';
import { money } from './format';
import {
  createManualEntry,
  listAccounts,
  type Account,
} from '../../services/accounting.service';
import { apiErrorMessage } from '../../utils/serverValidation';
import '../../components/Modal.css';
import './Accounting.css';

// A hand-written journal entry, for the things no operational event covers —
// an owner putting capital in, a bank charge, a correction agreed with an
// accountant.
//
// The running debit/credit totals are the point of the form: an entry that does
// not balance cannot be posted, so the user should be able to see that before
// they press the button rather than after.
//
// The same applies to the party on a control account. 1010 and 2000 only mean
// anything broken down per rider or per vendor, so the server refuses an
// untagged line — which is right, but it has to be askable here or picking one
// of those accounts is a dead end.

interface LineDraft {
  accountCode: string;
  debit: string;
  credit: string;
  memo: string;
  party: PickedParty | null;
}

const emptyLine = (): LineDraft => ({
  accountCode: '',
  debit: '',
  credit: '',
  memo: '',
  party: null,
});

const paisa = (value: string) => Math.round((Number(value) || 0) * 100);

interface ManualEntryModalProps {
  onClose: () => void;
  onSaved: () => void;
}

const ManualEntryModal: React.FC<ManualEntryModalProps> = ({ onClose, onSaved }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listAccounts()
      .then((rows) => setAccounts(rows.filter((account) => account.isActive)))
      .catch(() => setError('Could not load the chart of accounts'));
  }, []);

  const totals = useMemo(() => {
    const debit = lines.reduce((sum, line) => sum + paisa(line.debit), 0);
    const credit = lines.reduce((sum, line) => sum + paisa(line.credit), 0);
    return { debit, credit, balanced: debit === credit && debit > 0 };
  }, [lines]);

  const update = (index: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const byCode = useMemo(() => new Map(accounts.map((account) => [account.code, account])), [accounts]);

  const accountOptions = useMemo(
    () => accounts.map((account) => ({ id: account.code, label: account.name })),
    [accounts],
  );

  /** The subledger a line must be tagged with, or null if it needs no party. */
  const subledgerOf = (line: LineDraft): 'vendor' | 'rider' | null => {
    const account = byCode.get(line.accountCode);
    if (!account?.isControl) return null;
    return account.subledgerType === 'rider' ? 'rider' : 'vendor';
  };

  /** Changing the account drops any party, which may no longer be valid for it. */
  const setAccount = (index: number, accountCode: string) =>
    update(index, { accountCode, party: null });

  const isUsed = (line: LineDraft) =>
    Boolean(line.accountCode) && (paisa(line.debit) > 0 || paisa(line.credit) > 0);

  const missingParty = lines.some((line) => isUsed(line) && subledgerOf(line) && !line.party);

  /**
   * Lines carrying an amount on both sides.
   *
   * A journal line is one direction — the database enforces it with a check
   * constraint, so this can never be saved. It is caught here as a plain
   * validation failure, which is what lets the fields above stop clearing each
   * other: the rule is explained rather than applied behind your back.
   */
  const twoSided = lines.reduce<number[]>((rows, line, index) => {
    if (paisa(line.debit) > 0 && paisa(line.credit) > 0) rows.push(index + 1);
    return rows;
  }, []);

  const canSave =
    totals.balanced &&
    memo.trim().length >= 3 &&
    !missingParty &&
    twoSided.length === 0 &&
    lines.every((line) => !line.accountCode || paisa(line.debit) > 0 || paisa(line.credit) > 0) &&
    lines.filter(isUsed).length >= 2;

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await createManualEntry({
        entryDate,
        memo: memo.trim(),
        lines: lines.filter(isUsed).map((line) => {
          const subledger = subledgerOf(line);
          return {
            accountCode: line.accountCode,
            // Only ever one side — the server rejects a line carrying both.
            ...(paisa(line.debit) > 0 ? { debit: Number(line.debit) } : { credit: Number(line.credit) }),
            ...(line.memo.trim() ? { memo: line.memo.trim() } : {}),
            ...(subledger && line.party
              ? { partyType: line.party.partyType, partyId: line.party.partyId }
              : {}),
          };
        }),
      });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not post the entry'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-content" style={{ width: 720 }}>
        <div className="modal-header">
          <h2>New journal entry</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close"><X size={18} /></Button>
        </div>
        <p className="modal-desc">
          For anything the system does not post on its own. Debits and credits must add up to the same total.
        </p>

        <div className="acc-form acc-modal-body">
          <div className="form-grid">
            <FormField label="Date" required type="date" value={entryDate} onChange={setEntryDate} />
          </div>

          <div className="acc-entry-lines">
            <div className="acc-entry-line acc-entry-head">
              <span>Account</span>
              <span>Debit</span>
              <span>Credit</span>
              <span />
            </div>

            {lines.map((line, index) => (
              <div
                className={`acc-entry-line-group${
                  twoSided.includes(index + 1) ? ' acc-entry-line-invalid' : ''
                }`}
                key={index}
              >
                <div className="acc-entry-line">
                  <FormField
                    label=""
                    type="searchable-select"
                    value={line.accountCode}
                    onChange={(value) => setAccount(index, value)}
                    placeholder="Select an account…"
                    searchPlaceholder="Search the chart of accounts..."
                    searchableOptions={accountOptions}
                  />
                  <FormField
                    label=""
                    type="decimal"
                    value={line.debit}
                    // Typing in one side clears the other only once something
                    // has actually been entered. Clearing on every keystroke
                    // wiped the opposite field while you were still deleting
                    // your way out of a mistake.
                    onChange={(value) =>
                      update(index, paisa(value) > 0 ? { debit: value, credit: '' } : { debit: value })
                    }
                    placeholder="0.00"
                  />
                  <FormField
                    label=""
                    type="decimal"
                    value={line.credit}
                    onChange={(value) =>
                      update(index, paisa(value) > 0 ? { credit: value, debit: '' } : { credit: value })
                    }
                    placeholder="0.00"
                  />
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                    disabled={lines.length <= 2}
                    aria-label={`Remove line ${index + 1}`}
                  >
                    <X size={14} />
                  </Button>
                </div>

                {/* Only on a control account, where the server requires it. */}
                {subledgerOf(line) && (
                  <PartyPicker
                    types={[subledgerOf(line)!]}
                    value={line.party}
                    onChange={(party) => update(index, { party })}
                  />
                )}
              </div>
            ))}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLines((current) => [...current, emptyLine()])}
              style={{ alignSelf: 'flex-start' }}
            >
              <Plus size={14} /> Add line
            </Button>
          </div>

          <div className="acc-entry-totals">
            <span>Debits <strong>{money(totals.debit / 100)}</strong></span>
            <span>Credits <strong>{money(totals.credit / 100)}</strong></span>
            <span className={totals.balanced ? 'acc-pos' : 'acc-neg'}>
              {totals.debit === totals.credit
                ? totals.debit === 0 ? 'Nothing entered yet' : 'Balanced'
                : `Out by ${money(Math.abs(totals.debit - totals.credit) / 100)}`}
            </span>
          </div>

          {/* Under the lines, where a voucher's narration goes: you write what
              the entry was for once you have written the entry. */}
          <FormField
            label="Description"
            required
            value={memo}
            onChange={setMemo}
            placeholder="What is this entry for?"
          />

          {twoSided.length > 0 && (
            <p className="acc-neg">
              {twoSided.length === 1 ? `Line ${twoSided[0]} has` : `Lines ${twoSided.join(', ')} have`} both a
              debit and a credit. A line moves money one way — clear whichever side is wrong, or put it on a
              line of its own.
            </p>
          )}
          {missingParty && (
            <p className="acc-muted">
              A control account only means something per party — name the rider or vendor on every line above.
            </p>
          )}
          {error && <p className="error-text">{error}</p>}
        </div>

        <div className="modal-footer">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSave || saving}>
            {saving ? 'Posting…' : 'Post entry'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ManualEntryModal;
