import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { TallyAction } from '../../components/finance/TallyPage';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import PartyPicker, { type PartyKind, type PickedParty } from '../accounting/PartyPicker';
import {
  createManualEntry,
  isPostableByHand,
  listAccounts,
  type Account,
} from '../../services/accounting.service';
import { formatMoney } from '../../utils/format';
import { todayNepalAd } from '../../utils/nepaliDate';
import { useBackOr } from '../../hooks/useBackOr';
import './CashBankVoucherPage.css';

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

type VoucherType = 'payment' | 'receipt';
const TYPES: VoucherType[] = ['payment', 'receipt'];

const COPY: Record<VoucherType, {
  heading: string;
  primaryLabel: string;
  counterLabel: string;
  partyLabel: string;
}> = {
  payment: {
    heading: 'Payment',
    primaryLabel: 'Paid From',
    counterLabel: 'Paid For',
    partyLabel: 'Paid To',
  },
  receipt: {
    heading: 'Receipt',
    primaryLabel: 'Received Into',
    counterLabel: 'Received For',
    partyLabel: 'Received From',
  },
};

const CashBankVoucherPage: React.FC = () => {
  const navigate = useNavigate();
  const goBack = useBackOr('/finance/cash-bank');
  const [searchParams, setSearchParams] = useSearchParams();

  const typeParam = searchParams.get('type');
  const type: VoucherType = TYPES.includes(typeParam as VoucherType) ? (typeParam as VoucherType) : 'payment';
  const sourceParam = searchParams.get('source');
  const source = sourceParam === 'cash' || sourceParam === 'bank' ? sourceParam : 'all';

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cashBankAccounts, setCashBankAccounts] = useState<Account[]>([]);
  const [entryDate, setEntryDate] = useState(todayNepalAd);
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
      .then((rows) => setAccounts(rows.filter((account) => account.isActive && isPostableByHand(account))))
      .catch((err) => setError(err));
    // Active only: a deactivated bank account must not be offered as the
    // account money moved through.
    listAccounts('cash_bank')
      .then((rows) => setCashBankAccounts(rows.filter((account) => account.isActive)))
      .catch((err) => setError(err));
  }, []);

  const byCode = useMemo(
    () => new Map([...accounts, ...cashBankAccounts].map((a) => [a.code, a])),
    [accounts, cashBankAccounts],
  );

  const setType = useCallback((next: VoucherType) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.set('type', next);
      return params;
    }, { replace: true });
    setCounterCode('');
    setParty(null);
    setNotice('');
  }, [setSearchParams]);

  const primaryOptions = useMemo(
    () => cashBankAccounts
      .filter((account) => source === 'all' || (source === 'cash' ? account.code === '1000' : account.code !== '1000'))
      .map((account) => ({ id: account.code, label: `${account.name} · ${account.code}` })),
    [cashBankAccounts, source],
  );
  const activePrimaryCode = primaryOptions.some((option) => option.id === primaryCode) ? primaryCode : '';

  // Payments use the full active chart, just like Journal. Custom accounts
  // can use any code, so a numeric range must not determine eligibility.
  // Receipts retain their existing exclusion of cash/bank counter accounts.
  const counterOptions = useMemo(() => {
    if (type === 'payment') {
      return accounts.map((account) => ({ id: account.code, label: `${account.name} · ${account.code}` }));
    }
    const cashBankCodes = new Set(cashBankAccounts.map((account) => account.code));
    return accounts
      .filter((account) => !cashBankCodes.has(account.code))
      .map((account) => ({ id: account.code, label: `${account.name} · ${account.code}` }));
  }, [type, accounts, cashBankAccounts]);

  const counter = byCode.get(counterCode);
  const subledger = counter?.subledgerType ?? null;
  const partyKinds: PartyKind[] =
    subledger === 'vendor' || subledger === 'rider' ? [subledger] : ['rider', 'vendor', 'user'];
  // Only a control account (vendor payable, rider COD) needs someone named -
  // the server refuses those lines without one. Rent or a bank charge has no
  // rider, vendor or user to pick, so elsewhere it is optional.
  const partyRequired = Boolean(counter?.isControl);

  const selectCounter = (code: string) => {
    setCounterCode(code);
    setParty(null);
  };

  // Whole paisa, so what posts is the figure the preview shows.
  const value = Math.round((Number(amount) || 0) * 100) / 100;
  const canSave =
    Boolean(activePrimaryCode) &&
    Boolean(counterCode) &&
    activePrimaryCode !== counterCode &&
    value > 0 &&
    narration.trim().length >= 3 &&
    (!partyRequired || Boolean(party)) &&
    !saving;

  const primaryAccount = byCode.get(activePrimaryCode);
  const counterAccount = byCode.get(counterCode);

  // A Receipt debits the account the money landed in and credits what it was
  // for; a Payment debits what it was for and credits the account it left.
  const debitAccount = type === 'receipt' ? primaryAccount : counterAccount;
  const creditAccount = type === 'receipt' ? counterAccount : primaryAccount;

  const submit = useCallback(async () => {
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
  }, [canSave, counterAccount, type, value, reference, party, primaryAccount, entryDate, narration]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const copy = COPY[type];

  const actions: TallyAction[] = useMemo(() => [
    { key: 'F5', label: 'Payment', onSelect: () => setType('payment'), primary: type === 'payment' },
    { key: 'F6', label: 'Receipt', onSelect: () => setType('receipt'), primary: type === 'receipt' },
    { key: 'F8', label: 'Ledger', onSelect: () => navigate(`/finance/ledger/${activePrimaryCode}`), disabled: !activePrimaryCode },
    { key: 'F9', label: saving ? 'Posting…' : 'Post', onSelect: () => void submit(), disabled: !canSave },
    { key: 'Escape', label: 'Cancel', onSelect: goBack },
  ], [setType, type, navigate, activePrimaryCode, saving, submit, canSave, goBack]);

  // All Cash & Bank vouchers keep the familiar shortcuts in their action bar.
  // Manual journal posting is a staff-only action: App.tsx guards this route
  // with the accounting permission, so it is outside the vendor Partner API.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const action = actions.find((candidate) => candidate.key === event.key);
      if (!action || action.disabled) return;
      event.preventDefault();
      action.onSelect();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);

  const voucherName = source === 'all' ? type : `${source} ${type}`;
  const counterSide = type === 'receipt' ? 'credit' : 'debit';
  const previewParty = party && <span className="cash-receipt-preview-party"> · {party.partyName}</span>;

  return (
      <div className="cash-receipt-workspace">
        <header className="cash-receipt-heading">
          <span className="cash-receipt-heading-badge">Voucher Entry</span>
          <h1>New {voucherName} voucher</h1>
          <span className="cash-receipt-heading-state">{source === 'all' ? copy.heading : `${source === 'cash' ? 'Cash' : 'Bank'} ${copy.heading}`}</span>
        </header>

        <form className="cash-receipt-form" onSubmit={handleSubmit}>
          {error != null && (
            <p className="cash-receipt-message cash-receipt-message-error" role="alert">
              {(error as { response?: { data?: { message?: string } }; message?: string }).response?.data?.message
                ?? (error as Error).message
                ?? 'The voucher could not be posted. Review the details and try again.'}
            </p>
          )}
          {notice && <p className="cash-receipt-message cash-receipt-message-success" role="status">{notice}</p>}

          <section className="cash-receipt-details" aria-labelledby="cash-receipt-details-title">
            <h2 id="cash-receipt-details-title">Voucher details</h2>
            <div className="cash-receipt-details-grid">
              <div className="cash-receipt-date-field">
                <span className="cash-receipt-field-label">Date</span>
                <NepaliDatePicker value={entryDate} onChange={setEntryDate} aria-label="Date" />
              </div>
              <FormField label="Reference" value={reference} onChange={setReference} placeholder="Bill or voucher no." />
              <FormField
                label={copy.primaryLabel}
                required
                type="searchable-select"
                value={activePrimaryCode}
                onChange={setPrimaryCode}
                placeholder={source === 'all' ? 'Select a cash or bank account…' : `Select a ${source} account…`}
                searchPlaceholder="Search accounts..."
                searchableOptions={primaryOptions}
              />
            </div>
          </section>

          <section className="cash-receipt-ledger" aria-label="Receipt ledger details">
            <div className="cash-receipt-ledger-head" aria-hidden="true">
              <span>Ledger account</span><span>Sub ledger</span><span>{copy.heading}</span>
            </div>
            <div className="cash-receipt-ledger-grid">
              <div className="cash-receipt-ledger-cell">
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
                <small>Account to {counterSide}</small>
              </div>
              <div className="cash-receipt-ledger-cell">
                <span className="cash-receipt-party-label">{copy.partyLabel} {partyRequired ? <span aria-hidden="true">*</span> : <span>(optional)</span>}</span>
                <PartyPicker types={partyKinds} value={party} onChange={setParty} prompt="" inputLabel={copy.partyLabel} />
                <small>{type === 'receipt' ? 'Person or party making this payment' : 'Person or party receiving this payment'}</small>
              </div>
              <div className="cash-receipt-ledger-cell">
                <FormField label="Amount" required type="decimal" value={amount} onChange={setAmount} placeholder="0.00" />
                <small>Value {type === 'receipt' ? 'received' : 'paid'}</small>
              </div>
            </div>
          </section>

          <section className="cash-receipt-narration" aria-label="Narration">
            <FormField
              label="Narration"
              required
              type="textarea"
              rows={1}
              value={narration}
              onChange={setNarration}
              placeholder="What was this for?"
            />
          </section>

          <section className="cash-receipt-preview" aria-labelledby="cash-receipt-preview-title">
            <h2 id="cash-receipt-preview-title">Entry preview</h2>
            <p>{type === 'receipt'
              ? 'Debit the receiving account; credit the account this receipt is for.'
              : 'Debit the account this payment is for; credit the account it leaves.'}</p>
            <div className="cash-receipt-preview-rows" aria-live="polite">
              <div className="cash-receipt-preview-row">
                <span className="cash-receipt-side">Dr.</span>
                <span>{debitAccount?.name ?? (type === 'receipt' ? 'Receiving account' : 'Account paid for')}{type === 'payment' && previewParty}</span>
                <strong>{value > 0 ? formatMoney(value) : '—'}</strong>
              </div>
              <div className="cash-receipt-preview-row">
                <span className="cash-receipt-side">Cr.</span>
                <span>{creditAccount?.name ?? (type === 'receipt' ? 'Account received for' : 'Paying account')}{type === 'receipt' && previewParty}</span>
                <strong>{value > 0 ? formatMoney(value) : '—'}</strong>
              </div>
            </div>
          </section>

          <footer className="cash-receipt-actions">
            <nav className="cash-receipt-shortcuts" aria-label="Voucher shortcuts">
              {actions.map((action) => (
                <Button
                  key={action.key}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={action.primary ? 'cash-receipt-shortcut is-active' : 'cash-receipt-shortcut'}
                  onClick={action.onSelect}
                  disabled={action.disabled}
                >
                  <kbd>{action.key === 'Escape' ? 'Esc' : action.key}</kbd><span>{action.label}</span>
                </Button>
              ))}
            </nav>
            <div className="cash-receipt-buttons">
              <Button type="button" variant="outline" onClick={goBack}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={!canSave}>{saving ? 'Posting…' : 'Post voucher'}</Button>
            </div>
          </footer>
        </form>
      </div>
  );
};

export default CashBankVoucherPage;
