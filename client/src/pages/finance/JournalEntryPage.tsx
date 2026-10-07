import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import { dayBookAction, quitAction, voucherActions } from '../../components/finance/tallyKeys';
import FormField from '../../components/FormField';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import PartyPicker, { type PartyKind, type PickedParty } from '../accounting/PartyPicker';
import {
  createManualEntry,
  isPostableByHand,
  listAccounts,
  type Account,
} from '../../services/accounting.service';
import { formatAmount } from '../../utils/format';
import { todayNepalAd } from '../../utils/nepaliDate';
import { useBackOr } from '../../hooks/useBackOr';
import '../../components/finance/tallyVoucher.css';

/**
 * A hand-written journal voucher, laid out as Tally's Journal screen: date and
 * voucher number across the top, one ruled sheet of Ledger Account / Debit /
 * Credit, the narration at the foot with the totals ruled off beside it, and
 * the keyed actions on the right.
 *
 * The sheet itself is the preview — what is typed on it is what posts.
 *
 * Every line can name who it was for — a rider, vendor or admin/staff login —
 * under the account, the way Tally shows a party under its ledger. That tag is
 * what puts a salary, an advance or a fuel bill on the person's own ledger.
 */

interface LineDraft {
  key: number;
  accountCode: string;
  debit: string;
  credit: string;
  party: PickedParty | null;
}

let nextKey = 0;
const emptyLine = (): LineDraft => ({ key: nextKey++, accountCode: '', debit: '', credit: '', party: null });

const paisa = (value: string) => Math.round((Number(value) || 0) * 100);

const ALL_KINDS: PartyKind[] = ['rider', 'vendor', 'user'];

/** Ruled rows the sheet always shows, as the paper form does. */
const MIN_ROWS = 8;

const JournalEntryPage: React.FC = () => {
  const navigate = useNavigate();
  const goBack = useBackOr('/accounting/transactions/journal');

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entryDate, setEntryDate] = useState(todayNepalAd);
  const [reference, setReference] = useState('');
  const [narration, setNarration] = useState('');
  const [lines, setLines] = useState<LineDraft[]>(() => [emptyLine(), emptyLine()]);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [posted, setPosted] = useState<{ id: string; entryNo: string } | null>(null);

  useEffect(() => {
    listAccounts()
      .then((rows) => setAccounts(rows.filter((account) => account.isActive && isPostableByHand(account))))
      .catch((err) => setError(err));
  }, []);

  const byCode = useMemo(() => new Map(accounts.map((account) => [account.code, account])), [accounts]);
  const accountOptions = useMemo(
    () => accounts.map((account) => ({ id: account.code, label: `${account.name} · ${account.code}` })),
    [accounts],
  );

  /** Who a line may name. A control account only takes its own kind of party. */
  const kindsFor = useCallback((code: string): PartyKind[] => {
    const subledger = byCode.get(code)?.subledgerType;
    return subledger === 'rider' || subledger === 'vendor' ? [subledger] : ALL_KINDS;
  }, [byCode]);

  const partyRequired = (line: LineDraft) => Boolean(byCode.get(line.accountCode)?.isControl);

  const update = (key: number, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  // The person stays when they are still valid for the new account, so fixing
  // a wrong account pick doesn't mean searching for them again.
  const setAccount = (line: LineDraft, accountCode: string) =>
    update(line.key, {
      accountCode,
      party: line.party && kindsFor(accountCode).includes(line.party.partyType) ? line.party : null,
    });

  const addLine = useCallback(() => setLines((current) => [...current, emptyLine()]), []);

  const hasAmount = (line: LineDraft) => paisa(line.debit) > 0 || paisa(line.credit) > 0;
  const used = lines.filter((line) => line.accountCode && hasAmount(line));

  const totals = useMemo(() => {
    const debit = lines.reduce((sum, line) => sum + paisa(line.debit), 0);
    const credit = lines.reduce((sum, line) => sum + paisa(line.credit), 0);
    return { debit, credit };
  }, [lines]);

  // The first problem in reading order, shown under the totals so a disabled
  // Post always has its reason next to it.
  const problem = (() => {
    const lineNo = (line: LineDraft) => lines.indexOf(line) + 1;
    const twoSided = lines.find((line) => paisa(line.debit) > 0 && paisa(line.credit) > 0);
    if (twoSided) return `Line ${lineNo(twoSided)} has both a debit and a credit. A line moves money one way.`;
    const noAccount = lines.find((line) => !line.accountCode && hasAmount(line));
    if (noAccount) return `Line ${lineNo(noAccount)} has an amount but no ledger account.`;
    const noAmount = lines.find((line) => line.accountCode && !hasAmount(line));
    if (noAmount) return `Line ${lineNo(noAmount)} has an account but no amount.`;
    const noParty = used.find((line) => partyRequired(line) && !line.party);
    if (noParty) return `Line ${lineNo(noParty)} is a control account — pick who it belongs to.`;
    if (used.length < 2) return 'A journal entry needs at least two lines.';
    if (totals.debit !== totals.credit) return `Debit and credit are out by ${formatAmount(Math.abs(totals.debit - totals.credit) / 100)}.`;
    if (narration.trim().length < 3) return 'Add a narration saying what this entry is for.';
    return null;
  })();

  const canSave = !problem && !saving;

  const submit = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setPosted(null);
    try {
      const memo = reference.trim() ? `Ref: ${reference.trim()}` : null;
      const entry = await createManualEntry({
        entryDate,
        memo: narration.trim(),
        lines: used.map((line) => ({
          accountCode: line.accountCode,
          // Whole paisa, the same figures the totals summed.
          ...(paisa(line.debit) > 0 ? { debit: paisa(line.debit) / 100 } : { credit: paisa(line.credit) / 100 }),
          ...(memo ? { memo } : {}),
          ...(line.party ? { partyType: line.party.partyType, partyId: line.party.partyId } : {}),
        })),
      });
      // Tally stays in Add mode after accepting a voucher, ready for the next.
      setPosted({ id: entry.id, entryNo: entry.entryNo });
      setLines([emptyLine(), emptyLine()]);
      setReference('');
      setNarration('');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }, [canSave, reference, entryDate, narration, used]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void submit();
  };

  // Printing opens the voucher just posted, which is the document with the
  // signature blocks; an unposted sheet has nothing to file yet.
  const print = useCallback(() => posted && navigate(`/finance/voucher/${posted.id}`), [posted, navigate]);

  // Tally's voucher keys: F5/F6/F7 switch the voucher type, Ctrl+A accepts.
  const actions: TallyAction[] = useMemo(() => [
    ...voucherActions(navigate).map((action) => (action.key === 'F7' ? { ...action, disabled: true } : action)),
    { key: 'Alt+A', label: 'Add line', onSelect: addLine },
    { key: 'Ctrl+A', label: saving ? 'Posting…' : 'Accept', onSelect: () => void submit(), disabled: !canSave, primary: true },
    { key: 'Alt+P', label: 'Print', onSelect: print, disabled: !posted },
    dayBookAction(navigate),
    quitAction(goBack),
  ], [navigate, addLine, saving, submit, canSave, print, posted, goBack]);

  // The menu line carries the voucher's own actions; switching type stays on
  // the key panel.
  const menu = actions.filter((action) => !['F5', 'F6', 'F7'].includes(action.key));

  const blanks = Math.max(0, MIN_ROWS - lines.length);
  const started = totals.debit > 0 || totals.credit > 0;
  const balanced = totals.debit === totals.credit && totals.debit > 0;

  return (
    <TallyPage title="Journal" actions={actions} error={error}>
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

        {posted && (
          <p className="jv-posted" role="status">
            Posted as <Link to={`/finance/voucher/${posted.id}`}>{posted.entryNo}</Link>. Ready for the next voucher.
          </p>
        )}

        <div className="tly-scroll">
          <table className="tly-sheet jv-sheet">
            <thead>
              <tr>
                <th className="jv-col-account">Ledger Account</th>
                <th className="tly-amt">Debit</th>
                <th className="tly-amt">Credit</th>
                <th className="jv-col-remove" aria-label="Remove line" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const required = partyRequired(line);
                const invalid = paisa(line.debit) > 0 && paisa(line.credit) > 0;
                const isCredit = paisa(line.credit) > 0;
                return (
                  <tr key={line.key} className={invalid ? 'jv-invalid' : undefined}>
                    <td className={isCredit ? 'jv-account jv-account-cr' : 'jv-account'}>
                      <div className="jv-account-row">
                        <span className="jv-side">{isCredit ? 'Cr' : 'Dr'}</span>
                        <FormField
                          label={`Line ${index + 1} ledger account`}
                          hideLabel
                          type="searchable-select"
                          value={line.accountCode}
                          onChange={(code) => setAccount(line, code)}
                          placeholder="Select ledger…"
                          searchPlaceholder="Search the chart of accounts..."
                          searchableOptions={accountOptions}
                        />
                      </div>
                      <div className="jv-who">
                        <span className={required && !line.party ? 'jv-who-label jv-who-required' : 'jv-who-label'}>
                          {required ? 'Who *' : 'Who'}
                        </span>
                        <PartyPicker
                          types={kindsFor(line.accountCode)}
                          value={line.party}
                          onChange={(party) => update(line.key, { party })}
                          prompt=""
                          inputLabel={`Line ${index + 1} who`}
                        />
                      </div>
                    </td>
                    <td className="tly-amt jv-amt">
                      <FormField
                        label={`Line ${index + 1} debit`}
                        hideLabel
                        type="decimal"
                        value={line.debit}
                        // Clears the other side only once something real is
                        // typed, so deleting your way out of a mistake doesn't
                        // wipe it.
                        onChange={(value) => update(line.key, paisa(value) > 0 ? { debit: value, credit: '' } : { debit: value })}
                        placeholder=""
                      />
                    </td>
                    <td className="tly-amt jv-amt">
                      <FormField
                        label={`Line ${index + 1} credit`}
                        hideLabel
                        type="decimal"
                        value={line.credit}
                        onChange={(value) => update(line.key, paisa(value) > 0 ? { credit: value, debit: '' } : { credit: value })}
                        placeholder=""
                      />
                    </td>
                    <td className="jv-col-remove">
                      <button
                        type="button"
                        className="jv-remove"
                        onClick={() => setLines((current) => current.filter((candidate) => candidate.key !== line.key))}
                        disabled={lines.length <= 2}
                        aria-label={`Remove line ${index + 1}`}
                        title="Remove line"
                      >
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {/* Blank ruled rows; clicking one starts the next line. */}
              {Array.from({ length: blanks }, (_, index) => (
                <tr key={`blank-${index}`} className="tly-blank jv-blank" onClick={index === 0 ? addLine : undefined}>
                  <td className="jv-account">{index === 0 && <span className="jv-blank-hint">+ Add line (Alt+A)</span>}</td>
                  <td />
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
                <td className="tly-amt jv-total">{formatAmount(totals.debit / 100)}</td>
                <td className="tly-amt jv-total">{formatAmount(totals.credit / 100)}</td>
                <td className="jv-col-remove" />
              </tr>
              <tr className="jv-status-row">
                <td colSpan={4}>
                  <span className={balanced ? 'jv-status is-balanced' : 'jv-status'}>
                    {!started
                      ? 'Nothing entered yet'
                      : balanced
                        ? 'Balanced'
                        : `Out by ${formatAmount(Math.abs(totals.debit - totals.credit) / 100)}`}
                  </span>
                  {problem && started && <span className="jv-problem">{problem}</span>}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Tally's menu line: the same actions as the key panel, along the foot
            of the voucher where the eye ends up after the narration. */}
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

export default JournalEntryPage;
