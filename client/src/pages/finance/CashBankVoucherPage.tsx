import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import PartyPicker, { type PartyKind, type PickedParty } from '../accounting/PartyPicker';
import {
  createManualEntry,
  listAccounts,
  type Account,
} from '../../services/accounting.service';
import { formatMoney } from '../../utils/format';
import '../../components/finance/tally.css';
import '../accounting/Accounting.css';

/**
 * Payment and Receipt — the two vouchers that move cash and bank money — as
 * one screen instead of a modal per direction. F5/F6 switch the type in
 * place, the same keys Cash & Bank uses to open this screen, so the shortcut
 * means the same thing everywhere in the section.
 *
 * Each type is still the same two-line entry the ledger already understands:
 * a Payment debits what the money was for and credits the account it left; a
 * Receipt debits the account it landed in and credits what it was for. The
 * preview sheet shows exactly that pair before anything posts.
 */

/** Owed to vendors — paying a vendor their COD is a debit against this. */
const VENDOR_CONTROL = '2000';

type VoucherType = 'payment' | 'receipt';
const TYPES: VoucherType[] = ['payment', 'receipt'];

const COPY: Record<VoucherType, {
  heading: string;
  primaryLabel: string;
  counterLabel: string;
  partyLabel: string;
  desc: string;
}> = {
  payment: {
    heading: 'New Payment Voucher',
    primaryLabel: 'Paid From',
    counterLabel: 'Paid For',
    partyLabel: 'Paid To',
    desc: 'Money paid out of cash or a bank account — a cost, or a payout to a vendor.',
  },
  receipt: {
    heading: 'New Receipt Voucher',
    primaryLabel: 'Received Into',
    counterLabel: 'Received For',
    partyLabel: 'Received From',
    desc: 'Money received into cash or a bank account, for anything the automatic postings do not already cover.',
  },
};

const CashBankVoucherPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const typeParam = searchParams.get('type');
  const type: VoucherType = TYPES.includes(typeParam as VoucherType) ? (typeParam as VoucherType) : 'payment';

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cashBankAccounts, setCashBankAccounts] = useState<Account[]>([]);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [primaryCode, setPrimaryCode] = useState('');
  const [counterCode, setCounterCode] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const [party, setParty] = useState<PickedParty | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    listAccounts()
      .then((rows) => setAccounts(rows.filter((account) => account.isActive)))
      .catch((err) => setError(err));
    listAccounts('cash_bank')
      .then(setCashBankAccounts)
      .catch((err) => setError(err));
  }, []);

  const byCode = useMemo(
    () => new Map([...accounts, ...cashBankAccounts].map((a) => [a.code, a])),
    [accounts, cashBankAccounts],
  );

  const setType = (next: VoucherType) => {
    setSearchParams({ type: next }, { replace: true });
    setCounterCode('');
    setParty(null);
    setNotice('');
  };

  const primaryOptions = useMemo(
    () => cashBankAccounts.map((account) => ({ id: account.code, label: `${account.name} · ${account.code}` })),
    [cashBankAccounts],
  );

  // What the "other side" of the entry can be depends on the voucher type: a
  // Payment only ever pays a cost or the vendor payable; a Receipt is
  // everything else — any ledger that is not itself cash or bank, since a
  // transfer between two of our own cash/bank accounts isn't something this
  // screen posts.
  const counterOptions = useMemo(() => {
    if (type === 'payment') {
      return accounts
        .filter((account) => {
          const code = Number(account.code);
          return account.code === VENDOR_CONTROL || (Number.isFinite(code) && code >= 5000 && code <= 5900);
        })
        .map((account) => ({ id: account.code, label: `${account.name} · ${account.code}` }));
    }
    const cashBankCodes = new Set(cashBankAccounts.map((account) => account.code));
    return accounts
      .filter((account) => !cashBankCodes.has(account.code))
      .map((account) => ({ id: account.code, label: `${account.name} · ${account.code}` }));
  }, [type, accounts, cashBankAccounts]);

  const subledger = byCode.get(counterCode)?.subledgerType ?? null;
  const partyKinds: PartyKind[] =
    subledger === 'vendor' || subledger === 'rider' ? [subledger] : ['rider', 'vendor', 'user'];

  const selectCounter = (code: string) => {
    setCounterCode(code);
    setParty(null);
  };

  const value = Number(amount) || 0;
  const canSave =
    Boolean(primaryCode) &&
    Boolean(counterCode) &&
    primaryCode !== counterCode &&
    value > 0 &&
    narration.trim().length >= 3 &&
    Boolean(party) &&
    !saving;

  const primaryAccount = byCode.get(primaryCode);
  const counterAccount = byCode.get(counterCode);

  // A Receipt debits the account the money landed in and credits what it was
  // for; a Payment debits what it was for and credits the account it left.
  const debitAccount = type === 'receipt' ? primaryAccount : counterAccount;
  const creditAccount = type === 'receipt' ? counterAccount : primaryAccount;

  const submit = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setNotice('');
    try {
      // The reference and the party belong to the counter account — what the
      // money was for, or who it came from — regardless of which side of the
      // entry that account lands on. A Receipt debits the primary (cash/bank)
      // side, so putting them on "the debit line" the way Payment does would
      // tag the wrong line, and silently drop the party a control account
      // (vendor payable, rider COD) requires.
      const counterLine = {
        accountCode: counterAccount!.code,
        ...(type === 'receipt' ? { credit: value } : { debit: value }),
        ...(reference.trim() ? { memo: `Ref: ${reference.trim()}` } : {}),
        ...(party ? { partyType: party.partyType, partyId: party.partyId } : {}),
      };
      const primaryLine = {
        accountCode: primaryAccount!.code,
        ...(type === 'receipt' ? { debit: value } : { credit: value }),
      };
      const entry = await createManualEntry({
        entryDate,
        memo: narration.trim(),
        lines: type === 'receipt' ? [primaryLine, counterLine] : [counterLine, primaryLine],
      });
      // Stay put and clear only the entry-specific fields — Tally leaves a
      // voucher screen open after Accept so a run of similar entries (paying
      // five vendors from the same bank account) doesn't mean re-opening this
      // screen each time. The account and type carry over; the amount and who
      // it was for do not.
      setNotice(`Posted as ${entry.entryNo}.`);
      setAmount('');
      setReference('');
      setNarration('');
      setParty(null);
      setCounterCode('');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const copy = COPY[type];

  const actions: TallyAction[] = [
    { key: 'F5', label: 'Payment', onSelect: () => setType('payment'), primary: type === 'payment' },
    { key: 'F6', label: 'Receipt', onSelect: () => setType('receipt'), primary: type === 'receipt' },
    { key: 'F8', label: 'Ledger', onSelect: () => navigate(`/finance/ledger/${primaryCode}`), disabled: !primaryCode },
    { key: 'F9', label: saving ? 'Posting…' : 'Post', onSelect: () => void submit(), disabled: !canSave },
    { key: 'Escape', label: 'Cancel', onSelect: () => navigate(-1) },
  ];

  return (
    <TallyPage title="Voucher Entry" actions={actions} error={error} loading={false}>
      <form className="tly-voucher" onSubmit={handleSubmit}>
        <div className="tly-titlebar">
          <h2 className="tly-title">{copy.heading}</h2>
        </div>

        <p className="tly-note">{copy.desc}</p>
        {notice && <p className="tly-note">{notice}</p>}

        <div className="tly-form-grid">
          <label className="tly-form-date" aria-label="Date">
            <span>Date</span>
            <NepaliDatePicker value={entryDate} onChange={setEntryDate} placeholder="Date of this voucher" />
          </label>
          <FormField label="Amount" required type="decimal" value={amount} onChange={setAmount} placeholder="0.00" />

          <FormField
            label={copy.primaryLabel}
            required
            type="searchable-select"
            value={primaryCode}
            onChange={setPrimaryCode}
            placeholder="Select a cash or bank account…"
            searchPlaceholder="Search accounts..."
            searchableOptions={primaryOptions}
          />
          <FormField
            label={copy.counterLabel}
            required
            type="searchable-select"
            value={counterCode}
            onChange={selectCounter}
            placeholder="Select an account…"
            searchPlaceholder="Search the chart of accounts..."
            searchableOptions={counterOptions}
          />

          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label>
              {copy.partyLabel}
              <span className="required">*</span>
            </label>
            <PartyPicker types={partyKinds} value={party} onChange={setParty} prompt="" />
          </div>

          <FormField label="Reference" value={reference} onChange={setReference} placeholder="Bill or voucher no." />
          <FormField
            label="Narration"
            required
            value={narration}
            onChange={setNarration}
            placeholder="What was this for?"
            gridColumn="1 / -1"
          />
        </div>

        <p className="tly-note">Posts exactly as shown — Dr. the account debited, Cr. the account it left.</p>

        {value > 0 && debitAccount && creditAccount ? (
          <div className="tly-scroll">
            <table className="tly-sheet tly-sheet-form">
              <thead>
                <tr>
                  <th style={{ width: '10%' }}>&nbsp;</th>
                  <th>Particulars</th>
                  <th className="tly-amt">Debit</th>
                  <th className="tly-amt">Credit</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="tly-muted">Dr.</td>
                  <td>
                    {debitAccount.name}
                    {/* The party rides on whichever line is the counter
                        account — the credit line for a Receipt, since that is
                        what actually posts. */}
                    {type !== 'receipt' && party && <span className="tly-muted"> — {party.partyName}</span>}
                  </td>
                  <td className="tly-amt">{formatMoney(value)}</td>
                  <td className="tly-amt" />
                </tr>
                <tr>
                  <td className="tly-muted">Cr.</td>
                  <td>
                    To {creditAccount.name}
                    {type === 'receipt' && party && <span className="tly-muted"> — {party.partyName}</span>}
                  </td>
                  <td className="tly-amt" />
                  <td className="tly-amt">{formatMoney(value)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="tly-muted" style={{ padding: '0 var(--space-4) var(--space-3)' }}>
            Fill in the amount and both accounts to see the entry.
          </p>
        )}

        <div className="tly-form-actions">
          <Button type="button" variant="outline" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!canSave}>
            {saving ? 'Posting…' : 'Post voucher'}
          </Button>
        </div>
      </form>
    </TallyPage>
  );
};

export default CashBankVoucherPage;
