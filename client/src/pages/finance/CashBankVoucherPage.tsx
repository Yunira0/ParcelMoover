import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import { dayBookAction, quitAction } from '../../components/finance/tallyKeys';
import FormField from '../../components/FormField';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import PartyPicker, { type PartyKind, type PickedParty } from '../accounting/PartyPicker';
import {
  createManualEntry,
  isPostableByHand,
  listBranchCodOutstanding,
  receiveBranchCod,
  type Account,
  type BranchCodOutstanding,
} from '../../services/accounting.service';
import { listAccounts } from '../../queries/lookups';
import { formatAmount } from '../../utils/format';
import { todayNepalAd } from '../../utils/nepaliDate';
import { useBackOr } from '../../hooks/useBackOr';
import '../../components/finance/tallyVoucher.css';

/**
 * Payment and Receipt — the two vouchers that move cash and bank money — laid
 * out as Tally's: the cash or bank "Account:" on its own line, then a ruled
 * sheet of Particulars and Amount, the narration and total at the foot. F5/F6
 * switch the type in place, the same keys Cash & Bank uses to open this
 * screen, so the shortcut means the same thing everywhere in the section.
 *
 * A voucher can carry several particulars — paying fuel, rent and a rider's
 * salary out of the same cash in one go — and the cash/bank side takes their
 * total. A Payment debits each particular and credits the account the money
 * left; a Receipt debits the account it landed in and credits each particular.
 *
 * Cash from a branch is the exception. COD with Branch is driven by the
 * branch's statements, so a Receipt against it is sent to the branch COD
 * endpoint, which pays those statements down oldest first and lets each
 * re-post its own entry — a hand-written credit to it would leave them
 * showing unpaid. It goes on a voucher of its own for that reason.
 */

type VoucherType = 'payment' | 'receipt';
const TYPES: VoucherType[] = ['payment', 'receipt'];

const COPY: Record<VoucherType, { title: string; accountHint: string; whoHint: string }> = {
  payment: { title: 'Payment', accountHint: 'paid from', whoHint: 'Paid to' },
  receipt: { title: 'Receipt', accountHint: 'received into', whoHint: 'Received from' },
};

interface LineDraft {
  key: number;
  accountCode: string;
  amount: string;
  party: PickedParty | null;
  /** Only on a COD with Branch line: the branch the cash came from. */
  branchId: string;
}

let nextKey = 0;
const emptyLine = (): LineDraft => ({ key: nextKey++, accountCode: '', amount: '', party: null, branchId: '' });

const paisa = (value: string) => Math.round((Number(value) || 0) * 100);

const ALL_KINDS: PartyKind[] = ['rider', 'vendor', 'user'];

/** Ruled rows the sheet always shows, as the paper form does. */
const MIN_ROWS = 8;

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
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine()]);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [posted, setPosted] = useState<{ id: string; entryNo: string; detail?: string } | null>(null);
  const [branchCodAccount, setBranchCodAccount] = useState<Account | null>(null);
  const [branches, setBranches] = useState<BranchCodOutstanding[]>([]);

  const loadBranches = useCallback(() => {
    listBranchCodOutstanding()
      .then(setBranches)
      .catch(() => setBranches([]));
  }, []);

  useEffect(() => {
    listAccounts()
      .then((rows) => {
        setAccounts(rows.filter((account) => account.isActive && isPostableByHand(account)));
        setBranchCodAccount(
          rows.find((account) => account.isActive && account.isControl && account.subledgerType === 'location') ?? null,
        );
      })
      .catch((err) => setError(err));
    loadBranches();
    // Active only: a deactivated bank account must not be offered as the
    // account money moved through.
    listAccounts('cash_bank')
      .then((rows) => setCashBankAccounts(rows.filter((account) => account.isActive)))
      .catch((err) => setError(err));
  }, [loadBranches]);

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
    setLines([emptyLine()]);
    setPosted(null);
  }, [setSearchParams]);

  const primaryOptions = useMemo(
    () => cashBankAccounts
      .filter((account) => source === 'all' || (source === 'cash' ? account.code === '1000' : account.code !== '1000'))
      .map((account) => ({ id: account.code, label: account.name })),
    [cashBankAccounts, source],
  );
  const activePrimaryCode = primaryOptions.some((option) => option.id === primaryCode) ? primaryCode : '';
  const primaryAccount = byCode.get(activePrimaryCode);

  // Only what the voucher can plausibly be for, chosen by account type rather
  // than code, since custom accounts can use any code. Money goes out to
  // expenses, liabilities and other assets - and, for a deposit, to another
  // cash or bank account; it comes in from income, liabilities and other
  // assets. Equity, and income on a payment or expenses on a receipt, never
  // belong on these vouchers.
  const counterOptions = useMemo(() => {
    const cashBankCodes = new Set(cashBankAccounts.map((account) => account.code));
    if (type === 'payment') {
      return accounts
        .filter((account) => cashBankCodes.has(account.code)
          ? account.code !== activePrimaryCode
          : account.type === 'expense' || account.type === 'liability' || account.type === 'asset')
        .map((account) => ({ id: account.code, label: account.name }));
    }
    return [
      ...(branchCodAccount
        ? [{ id: branchCodAccount.code, label: `${branchCodAccount.name} (cash from a branch)` }]
        : []),
      ...accounts
        .filter((account) => !cashBankCodes.has(account.code)
          && (account.type === 'revenue' || account.type === 'liability' || account.type === 'asset'))
        .map((account) => ({ id: account.code, label: account.name })),
    ];
  }, [type, accounts, cashBankAccounts, branchCodAccount, activePrimaryCode]);

  const isBranchLine = useCallback(
    (line: LineDraft) => type === 'receipt' && Boolean(branchCodAccount) && line.accountCode === branchCodAccount?.code,
    [type, branchCodAccount],
  );
  const branchOptions = useMemo(
    () => branches.map((branch) => ({
      id: branch.branchId,
      label: `${branch.branchName} · owes ${formatAmount(branch.outstanding)} on ${branch.statements} statement${branch.statements === 1 ? '' : 's'}`,
    })),
    [branches],
  );

  /** Who a line may name. A control account only takes its own kind of party. */
  const kindsFor = useCallback((code: string): PartyKind[] => {
    const subledger = byCode.get(code)?.subledgerType;
    return subledger === 'rider' || subledger === 'vendor' ? [subledger] : ALL_KINDS;
  }, [byCode]);

  // Only a control account (vendor payable, rider COD) needs someone named -
  // the server refuses those lines without one. Rent or a bank charge has no
  // rider, vendor or user to pick, so elsewhere it is optional.
  const partyRequired = (line: LineDraft) => Boolean(byCode.get(line.accountCode)?.isControl);

  const update = (key: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const setAccount = (line: LineDraft, accountCode: string) =>
    update(line.key, {
      accountCode,
      party: line.party && kindsFor(accountCode).includes(line.party.partyType) ? line.party : null,
      branchId: '',
    });

  const addLine = useCallback(() => setLines((current) => [...current, emptyLine()]), []);

  const used = lines.filter((line) => line.accountCode && paisa(line.amount) > 0);
  const total = lines.reduce((sum, line) => sum + paisa(line.amount), 0);
  const branchLine = lines.find(isBranchLine) ?? null;
  const branch = branches.find((candidate) => candidate.branchId === branchLine?.branchId) ?? null;

  const problem = (() => {
    const lineNo = (line: LineDraft) => lines.indexOf(line) + 1;
    if (!activePrimaryCode) return `Pick the cash or bank account this was ${COPY[type].accountHint}.`;
    const noAccount = lines.find((line) => !line.accountCode && paisa(line.amount) > 0);
    if (noAccount) return `Line ${lineNo(noAccount)} has an amount but no ledger account.`;
    const noAmount = lines.find((line) => line.accountCode && paisa(line.amount) <= 0);
    if (noAmount) return `Line ${lineNo(noAmount)} has an account but no amount.`;
    const self = used.find((line) => line.accountCode === activePrimaryCode);
    if (self) return `Line ${lineNo(self)} is the same account as the one money ${type === 'payment' ? 'left' : 'landed in'}.`;
    if (branchLine) {
      if (lines.some((line) => line !== branchLine && (line.accountCode || paisa(line.amount) > 0))) {
        return 'Cash from a branch goes on a voucher of its own — remove the other lines.';
      }
      if (branches.length === 0) return 'No branch has an open COD statement to receive against.';
      if (!branch) return 'Pick the branch this cash came from.';
      if (paisa(branchLine.amount) > Math.round(branch.outstanding * 100)) {
        return `${branch.branchName} only owes ${formatAmount(branch.outstanding)} on open statements.`;
      }
    }
    const noParty = used.find((line) => !isBranchLine(line) && partyRequired(line) && !line.party);
    if (noParty) return `Line ${lineNo(noParty)} is a control account — pick who it belongs to.`;
    if (used.length === 0) return 'Add at least one particular with an amount.';
    if (narration.trim().length < 3) return 'Add a narration saying what this was for.';
    return null;
  })();

  const canSave = !problem && !saving;

  const submit = useCallback(async () => {
    if (!canSave || !primaryAccount) return;
    setSaving(true);
    setError(null);
    setPosted(null);
    try {
      if (branchLine && branch) {
        const receipt = await receiveBranchCod({
          branchId: branch.branchId,
          amount: paisa(branchLine.amount) / 100,
          accountCode: primaryAccount.code,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          narration: narration.trim(),
        });
        const applied = receipt.allocations
          .map((allocation) => `${allocation.statementNo} ${formatAmount(allocation.amount)}${allocation.settled ? ' (settled)' : ''}`)
          .join(', ');
        const entry = receipt.entries[0];
        setPosted({
          id: entry?.id ?? '',
          entryNo: entry?.entryNo ?? 'branch statements',
          detail: `${branch.branchName}: applied to ${applied}.`,
        });
        setLines([emptyLine()]);
        setReference('');
        setNarration('');
        loadBranches();
        return;
      }

      const memo = reference.trim() ? `Ref: ${reference.trim()}` : null;
      // The reference and the party belong to each particular — what the money
      // was for, or who it came from — not to the cash/bank side.
      const counterLines = used.map((line) => ({
        accountCode: line.accountCode,
        ...(type === 'receipt' ? { credit: paisa(line.amount) / 100 } : { debit: paisa(line.amount) / 100 }),
        ...(memo ? { memo } : {}),
        ...(line.party ? { partyType: line.party.partyType, partyId: line.party.partyId } : {}),
      }));
      const primaryLine = {
        accountCode: primaryAccount.code,
        ...(type === 'receipt' ? { debit: total / 100 } : { credit: total / 100 }),
      };
      const entry = await createManualEntry({
        entryDate,
        memo: narration.trim(),
        lines: type === 'receipt' ? [primaryLine, ...counterLines] : [...counterLines, primaryLine],
      });
      // Stay put and clear only the entry-specific fields — Tally leaves a
      // voucher screen open after Accept so a run of similar entries doesn't
      // mean re-opening it each time. The account and type carry over.
      setPosted({ id: entry.id, entryNo: entry.entryNo });
      setLines([emptyLine()]);
      setReference('');
      setNarration('');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }, [canSave, primaryAccount, branchLine, branch, loadBranches, reference, used, type, total, entryDate, narration]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void submit();
  };

  // Printing opens the voucher just posted, which is the document with the
  // signature blocks; an unposted sheet has nothing to file yet.
  const print = useCallback(() => posted?.id && navigate(`/finance/voucher/${posted.id}`), [posted, navigate]);

  // Tally's voucher keys: F5/F6/F7 switch the voucher type, Ctrl+A accepts.
  const actions: TallyAction[] = useMemo(() => [
    { key: 'F5', label: 'Payment', onSelect: () => setType('payment'), disabled: type === 'payment' },
    { key: 'F6', label: 'Receipt', onSelect: () => setType('receipt'), disabled: type === 'receipt' },
    { key: 'F7', label: 'Journal', onSelect: () => navigate('/finance/journal/new') },
    { key: 'F8', label: 'Ledger', onSelect: () => navigate(`/finance/ledger/${activePrimaryCode}`), disabled: !activePrimaryCode },
    { key: 'Alt+A', label: 'Add line', onSelect: addLine },
    { key: 'Ctrl+A', label: saving ? 'Posting…' : 'Accept', onSelect: () => void submit(), disabled: !canSave, primary: true },
    { key: 'Alt+P', label: 'Print', onSelect: print, disabled: !posted?.id },
    dayBookAction(navigate),
    quitAction(goBack),
  ], [setType, type, addLine, navigate, activePrimaryCode, saving, submit, canSave, print, posted, goBack]);

  // The menu line carries the voucher's own actions; switching type and the
  // ledger stay on the key panel.
  const menu = actions.filter((action) => !['F5', 'F6', 'F7', 'F8'].includes(action.key));

  const copy = COPY[type];
  const title = source === 'all' ? copy.title : `${source === 'cash' ? 'Cash' : 'Bank'} ${copy.title}`;
  const blanks = Math.max(0, MIN_ROWS - lines.length);

  return (
    <TallyPage title={title} actions={actions} error={error}>
      <form className="tly-voucher jv" onSubmit={handleSubmit}>
        <div className="jv-meta">
          <label className="jv-meta-field">
            <span>Voucher Date :</span>
            <NepaliDatePicker value={entryDate} onChange={setEntryDate} aria-label="Voucher date" />
          </label>
          <div className="jv-meta-field">
            <span>Ref. :</span>
            <FormField label="Reference" hideLabel value={reference} onChange={setReference} placeholder="Bill or voucher no." />
          </div>
          <div className="jv-meta-field jv-meta-no">
            <span>Voucher No.:</span>
            {/* Numbered by the server when it posts, so two people entering
                at once can't be handed the same number. */}
            <strong>Auto</strong>
          </div>
        </div>

        <div className="jv-account-bar">
          <span>Account :</span>
          <FormField
            label={type === 'payment' ? 'Paid from' : 'Received into'}
            hideLabel
            type="searchable-select"
            value={activePrimaryCode}
            onChange={setPrimaryCode}
            placeholder={source === 'all' ? 'Select a cash or bank account…' : `Select a ${source} account…`}
            searchPlaceholder="Search accounts..."
            searchableOptions={primaryOptions}
          />
          <small>({copy.accountHint})</small>
        </div>

        {posted && (
          <p className="jv-posted" role="status">
            Posted as {posted.id ? <Link to={`/finance/voucher/${posted.id}`}>{posted.entryNo}</Link> : posted.entryNo}.
            {posted.detail && <> {posted.detail}</>} Ready for the next voucher.
          </p>
        )}

        <div className="tly-scroll">
          <table className="tly-sheet jv-sheet jv-sheet-single">
            <thead>
              <tr>
                <th className="jv-col-account">Particulars</th>
                <th className="tly-amt">Amount</th>
                <th className="jv-col-remove" aria-label="Remove line" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const required = partyRequired(line);
                return (
                  <tr key={line.key}>
                    <td className="jv-account">
                      <div className="jv-account-row">
                        <FormField
                          label={`Line ${index + 1} ledger account`}
                          hideLabel
                          type="searchable-select"
                          value={line.accountCode}
                          onChange={(code) => setAccount(line, code)}
                          placeholder="Select ledger…"
                          searchPlaceholder="Search the chart of accounts..."
                          searchableOptions={counterOptions}
                        />
                      </div>
                      {isBranchLine(line) ? (
                        <div className="jv-who">
                          <span className={line.branchId ? 'jv-who-label' : 'jv-who-label jv-who-required'}>Branch *</span>
                          <FormField
                            label={`Line ${index + 1} branch`}
                            hideLabel
                            type="searchable-select"
                            value={line.branchId}
                            onChange={(branchId) => update(line.key, { branchId })}
                            placeholder={branches.length ? 'Select the branch…' : 'No branch has an open COD statement'}
                            searchPlaceholder="Search branches..."
                            searchableOptions={branchOptions}
                          />
                        </div>
                      ) : (
                        <div className="jv-who">
                          <span className={required && !line.party ? 'jv-who-label jv-who-required' : 'jv-who-label'}>
                            {copy.whoHint}{required ? ' *' : ''}
                          </span>
                          <PartyPicker
                            types={kindsFor(line.accountCode)}
                            value={line.party}
                            onChange={(party) => update(line.key, { party })}
                            prompt=""
                            inputLabel={`Line ${index + 1} ${copy.whoHint.toLowerCase()}`}
                          />
                        </div>
                      )}
                    </td>
                    <td className="tly-amt jv-amt">
                      <FormField
                        label={`Line ${index + 1} amount`}
                        hideLabel
                        type="decimal"
                        value={line.amount}
                        onChange={(value) => update(line.key, { amount: value })}
                        placeholder=""
                      />
                    </td>
                    <td className="jv-col-remove">
                      <button
                        type="button"
                        className="jv-remove"
                        onClick={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))}
                        disabled={lines.length <= 1}
                        aria-label={`Remove line ${index + 1}`}
                        title="Remove line"
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {/* Blank ruled rows; clicking the first one starts the next line. */}
              {Array.from({ length: blanks }, (_, index) => (
                <tr key={`blank-${index}`} className="tly-blank jv-blank" onClick={index === 0 ? addLine : undefined}>
                  <td className="jv-account">{index === 0 && <span className="jv-blank-hint">+ Add line (Alt+A)</span>}</td>
                  <td />
                  <td className="jv-col-remove" />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="jv-foot">
                <td className="jv-narr">
                  <label>
                    <span>Narr:</span>
                    <textarea
                      value={narration}
                      onChange={(event) => setNarration(event.target.value)}
                      placeholder="What was this for?"
                      rows={2}
                      aria-label="Narration"
                      aria-required="true"
                    />
                  </label>
                </td>
                <td className="tly-amt jv-total">{formatAmount(total / 100)}</td>
                <td className="jv-col-remove" />
              </tr>
              <tr className="jv-status-row">
                <td colSpan={3}>
                  {/* The other side of the entry, spelled out, since the sheet
                      only lists the particulars. */}
                  {primaryAccount && total > 0 ? (
                    <span className="jv-problem" style={{ marginLeft: 0 }}>
                      {branchLine
                        ? `Dr ${primaryAccount.name} ${formatAmount(total / 100)} — pays ${branch?.branchName ?? 'the branch'}'s COD statements, oldest first.`
                        : type === 'payment'
                        ? `Cr ${primaryAccount.name} ${formatAmount(total / 100)} — Dr each particular above.`
                        : `Dr ${primaryAccount.name} ${formatAmount(total / 100)} — Cr each particular above.`}
                    </span>
                  ) : null}
                  {problem && (total > 0 || lines.some((line) => line.accountCode)) && (
                    <span className="jv-status" style={{ marginLeft: primaryAccount && total > 0 ? 'var(--space-3)' : 0 }}>
                      {problem}
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Tally's menu line: the voucher's actions along the foot, where the
            eye ends up after the narration. */}
        <nav className="jv-menu" aria-label="Voucher menu">
          {menu.map((action) => (
            <button
              key={action.key}
              type={action.key === 'Ctrl+A' ? 'submit' : 'button'}
              className={action.primary ? 'jv-menu-item is-primary' : 'jv-menu-item'}
              onClick={action.key === 'Ctrl+A' ? undefined : action.onSelect}
              disabled={action.disabled}
            >
              {action.label}
            </button>
          ))}
        </nav>
      </form>
    </TallyPage>
  );
};

export default CashBankVoucherPage;
