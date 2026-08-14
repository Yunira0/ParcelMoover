import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import PartyPicker, { type PartyKind, type PickedParty } from './PartyPicker';
import { money } from './format';
import {
  createManualEntry,
  listAccounts,
  type Account,
} from '../../services/accounting.service';
import { apiErrorMessage } from '../../utils/serverValidation';
import '../../components/Modal.css';
import './Accounting.css';

// The payment voucher — money leaving cash or a bank account.
//
// One payment is always the same two lines: credit what it came out of, debit
// what it was for. The journal form can express that too, but it asks the user
// to say it in debits and credits and to keep them balanced; here the direction
// is fixed by the screen you are on, so there is one amount and nothing to
// balance. It still posts an ordinary journal entry, so it reverses, reports
// and reconciles exactly like everything else.
//
// This replaced the separate expense screen: an expense was never anything but
// a cash payment against a 5xxx account, and having two ways to record one
// event meant two places to look for it.

/** Cash in hand. The one funding account that is not derivable from the chart. */
const CASH_IN_HAND = '1000';

/** Owed to vendors — paying a vendor their COD is a debit against this. */
const VENDOR_CONTROL = '2000';

const paisa = (value: string) => Math.round((Number(value) || 0) * 100);

interface PaymentVoucherModalProps {
  /** Which register opened this — fixes the side the money leaves from. */
  scope: 'cash' | 'bank';
  onClose: () => void;
  onSaved: () => void;
}

const PaymentVoucherModal: React.FC<PaymentVoucherModalProps> = ({ scope, onClose, onSaved }) => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paidFromCode, setPaidFromCode] = useState(scope === 'cash' ? CASH_IN_HAND : '');
  const [accountCode, setAccountCode] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [party, setParty] = useState<PickedParty | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    listAccounts()
      .then((rows) => setAccounts(rows.filter((account) => account.isActive)))
      .catch(() => setError('Could not load the chart of accounts'));
  }, []);

  const byCode = useMemo(() => new Map(accounts.map((a) => [a.code, a])), [accounts]);

  /**
   * What the money can come out of.
   *
   * Bank accounts are not a fixed list — one is created alongside each payment
   * method — so they are derived the same way the server derives them for the
   * bank register: a non-control asset that is not cash in hand.
   */
  const fundingOptions = useMemo(
    () =>
      accounts
        .filter((account) =>
          scope === 'cash'
            ? account.code === CASH_IN_HAND
            : account.type === 'asset' && !account.isControl && account.code !== CASH_IN_HAND,
        )
        .map((account) => ({ id: account.code, label: account.name })),
    [accounts, scope],
  );

  // Costs (5000-5900), plus the vendor payable: a payout is money leaving for a
  // vendor rather than a cost, but it is still a payment made on this screen.
  // Everything else — transfers between accounts, corrections — is a different
  // voucher and does not belong in this list.
  const accountOptions = useMemo(
    () =>
      accounts
        .filter((account) => {
          const code = Number(account.code);
          return account.code === VENDOR_CONTROL || (Number.isFinite(code) && code >= 5000 && code <= 5900);
        })
        .map((account) => ({ id: account.code, label: account.name })),
    [accounts],
  );

  // The vendor payable keeps a per-vendor subledger, so the server requires a
  // vendor on that line and refuses any other kind of party. A cost account
  // keeps none, so the party there is free attribution: whoever was paid.
  const subledger = byCode.get(accountCode)?.subledgerType ?? null;
  const partyKinds: PartyKind[] =
    subledger === 'vendor' || subledger === 'rider' ? [subledger] : ['rider', 'vendor', 'user'];

  /** Changing the account drops any party, which may no longer be valid for it. */
  const selectAccount = (code: string) => {
    setAccountCode(code);
    setParty(null);
  };

  const value = paisa(amount);
  const canSave =
    Boolean(paidFromCode) &&
    Boolean(accountCode) &&
    value > 0 &&
    memo.trim().length >= 3 &&
    Boolean(party) &&
    !saving;

  const submit = async () => {
    setSaving(true);
    setError(null);
    // The reference is not a column on a journal line, so it rides along in the
    // line memo — losing it would make a payment unidentifiable a month later,
    // which is the whole point of a voucher. Who it was paid to is not memo
    // text: it goes on the line as a party, so the payment turns up in that
    // person's ledger.
    try {
      await createManualEntry({
        entryDate,
        memo: memo.trim(),
        lines: [
          {
            accountCode,
            debit: Number(amount),
            ...(reference.trim() ? { memo: `Ref: ${reference.trim()}` } : {}),
            ...(party ? { partyType: party.partyType, partyId: party.partyId } : {}),
          },
          { accountCode: paidFromCode, credit: Number(amount) },
        ],
      });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not post the payment'));
    } finally {
      setSaving(false);
    }
  };

  const fundingAccount = byCode.get(paidFromCode);
  const paidToAccount = byCode.get(accountCode);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-content" style={{ width: 620 }}>
        <div className="modal-header">
          <h2>{scope === 'cash' ? 'New cash payment' : 'New bank payment'}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close"><X size={18} /></Button>
        </div>
        <p className="modal-desc">
          Money paid out of {scope === 'cash' ? 'cash in hand' : 'a bank or wallet account'} — a cost, or a
          payout to a vendor. Posts a journal entry like any other.
        </p>

        <div className="acc-form acc-modal-body">
          <div className="form-grid">
            <FormField label="Date" required type="date" value={entryDate} onChange={setEntryDate} />
            <FormField
              label="Amount"
              required
              type="decimal"
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
            />
          </div>

          <div className="form-grid">
            <FormField
              label="Paid from"
              required
              type="searchable-select"
              value={paidFromCode}
              onChange={setPaidFromCode}
              placeholder={scope === 'cash' ? 'Cash in hand' : 'Select a bank or wallet…'}
              searchPlaceholder="Search accounts..."
              searchableOptions={fundingOptions}
              disabled={scope === 'cash'}
            />
            <FormField
              label="Paid for"
              required
              type="searchable-select"
              value={accountCode}
              onChange={selectAccount}
              placeholder="Select an account…"
              searchPlaceholder="Search the chart of accounts..."
              searchableOptions={accountOptions}
            />
          </div>

          {/* form-group so the label sits like every other field's, even though
              the control underneath is a search rather than an input. */}
          <div className="form-group">
            <label>Paid to<span className="required">*</span></label>
            {/* No prompt: the "Paid to" label above already says what this is,
                and the search placeholder says who can be picked. */}
            <PartyPicker types={partyKinds} value={party} onChange={setParty} prompt="" />
          </div>

          <FormField
            label="Reference"
            value={reference}
            onChange={setReference}
            placeholder="Bill or voucher no."
          />

          <FormField
            label="Description"
            required
            value={memo}
            onChange={setMemo}
            placeholder="What was this payment for?"
          />

          {/* The entry as it will be posted. A voucher hides the double entry;
              it should not hide it from someone who wants to check it. */}
          {value > 0 && fundingAccount && paidToAccount && (
            <div className="acc-entry-totals">
              <span>Debit <strong>{paidToAccount.name}</strong> {money(value / 100)}</span>
              <span>Credit <strong>{fundingAccount.name}</strong> {money(value / 100)}</span>
            </div>
          )}

          {error && <p className="error-text">{error}</p>}
        </div>

        <div className="modal-footer">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!canSave}>
            {saving ? 'Posting…' : 'Post payment'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PaymentVoucherModal;
