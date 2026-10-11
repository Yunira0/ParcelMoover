import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import { dayBookAction, printAction, quitAction } from '../../components/finance/tallyKeys';
import ToggleSwitch from '../../components/ToggleSwitch';
import FormField from '../../components/FormField';
import NepaliDatePicker from '../../components/NepaliDatePicker';
import Pagination from '../../components/Pagination';
import PartyPicker, { type PickedParty } from '../accounting/PartyPicker';
import {
  createAccount,
  getChart,
  setOpeningBalance,
  updateAccount,
  ACCOUNT_CLASSES,
  ACCOUNT_CLASS_LABELS,
  CLASS_NORMAL_SIDE,
  type AccountClass,
  type AccountNode,
} from '../../services/accounting.service';
import { useBackOr } from '../../hooks/useBackOr';

/**
 * Masters — the chart of accounts, as a tree you can add to and edit.
 *
 * Groups and accounts are the same row here, exactly as they are in the
 * database: a group is simply an account with children. That is what lets a
 * group's total be the sum of its subtree rather than a separate thing anyone
 * has to maintain.
 *
 * The screen's one real job is making the difference between editing and
 * redefining obvious. Renaming account 1200 is free. Moving it from Current
 * Assets to Direct Expense, once anything has been posted to it, silently
 * reverses the meaning of every one of those lines — so the form locks the
 * type the moment the account has been posted to, and says why.
 *
 * There is one type field, not a type and a sub-type. Nobody decides "expense"
 * and then which kind: they know it is rent. The accounting type the reports
 * group by is derived from the class on the server.
 */

interface FormState {
  code: string;
  name: string;
  subType: AccountClass;
  normalSide: 'debit' | 'credit';
  description: string;
}

const blankForm = (): FormState => ({
  code: '',
  name: '',
  subType: 'current_asset',
  normalSide: 'debit',
  description: '',
});

/** The thousand-block each type's codes live in: 1xxx assets … 5xxx expenses. */
const CODE_BLOCK: Record<AccountClass, number> = {
  fixed_asset: 1,
  intangible_asset: 1,
  current_asset: 1,
  long_term_liability: 2,
  current_liability: 2,
  capital: 3,
  reserves: 3,
  direct_income: 4,
  indirect_income: 4,
  direct_expense: 5,
  indirect_expense: 5,
};

/** The next free code in the type's block, after the highest one in use. */
function nextCode(nodes: AccountNode[], subType: AccountClass): string {
  const block = CODE_BLOCK[subType];
  const used = nodes
    .map((node) => Number(node.code))
    .filter((code) => Number.isInteger(code) && Math.floor(code / 1000) === block);
  return String(used.length ? Math.max(...used) + 1 : block * 1000);
}

/** Depth-first walk, so the tree can be rendered as indented rows. */
function flatten(nodes: AccountNode[]): AccountNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

const MastersPage: React.FC = () => {
  const navigate = useNavigate();
  const goBack = useBackOr('/accounting');

  const [chart, setChart] = useState<AccountNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  /** null = closed, otherwise the account code the opening balance is for. */
  const [opening, setOpening] = useState<string | null>(null);
  const [openingForm, setOpeningForm] = useState({ amount: '', asOf: '', reference: '' });
  const [openingParty, setOpeningParty] = useState<PickedParty | null>(null);

  /** null = closed, '' = adding a new account, otherwise the code being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setChart(await getChart());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => flatten(chart), [chart]);
  const current = useMemo(() => rows.find((row) => row.code === editing) ?? null, [rows, editing]);
  const locked = Boolean(current && current.lineCount > 0);

  // The whole chart loads in one call (getChart), so pagination here just
  // slices what's already in memory rather than re-fetching - a page boundary
  // can still land between a group and one of its children, since the tree is
  // flattened depth-first into one continuous list first.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pagedRows = useMemo(
    () => rows.slice((page - 1) * pageSize, page * pageSize),
    [rows, page, pageSize],
  );

  // A form replaces the list, so opening one from a row far down the list has
  // to bring the screen back to the top. Only one form is open at a time.
  const formRef = useRef<HTMLFormElement>(null);
  const showForm = () => requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));

  const openAdd = () => {
    const blank = blankForm();
    setForm({ ...blank, code: nextCode(rows, blank.subType) });
    setEditing('');
    setOpening(null);
    setNotice('');
    showForm();
  };

  const openEdit = (node: AccountNode) => {
    setForm({
      code: node.code,
      name: node.name,
      // An account saved before classes existed has none. Falling back to the
      // first one puts a real choice in the form rather than a blank that
      // saves as null the moment anything else is edited.
      subType: node.subType ?? ACCOUNT_CLASSES[0],
      normalSide: node.normalSide,
      description: node.description ?? '',
    });
    setEditing(node.code);
    setOpening(null);
    setNotice('');
    showForm();
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice('');
    try {
      if (editing === '') {
        await createAccount({
          code: form.code,
          name: form.name,
          subType: form.subType,
          normalSide: form.normalSide,
          description: form.description || null,
        });
        setNotice(`Account ${form.code} created.`);
      } else if (current) {
        await updateAccount(current.code, {
          name: form.name,
          description: form.description || null,
          // Only sent while still editable, so a locked account cannot be
          // redefined by a stale form value going along for the ride. The
          // server applies the same rule: re-filing within an accounting type
          // is allowed, moving across it is not once anything has posted.
          ...(locked ? {} : { subType: form.subType, normalSide: form.normalSide }),
        });
        setNotice(`Account ${current.code} updated.`);
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (node: AccountNode) => {
    setError(null);
    try {
      await updateAccount(node.code, { isActive: !node.isActive });
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const openOpening = (node: AccountNode) => {
    setOpening(node.code);
    setOpeningForm({ amount: '', asOf: '', reference: '' });
    setOpeningParty(null);
    setEditing(null);
    setNotice('');
    showForm();
  };

  const openingAccount = useMemo(() => rows.find((row) => row.code === opening) ?? null, [rows, opening]);

  const saveOpening = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!openingAccount) return;
    setSaving(true);
    setError(null);
    setNotice('');
    try {
      const result = await setOpeningBalance({
        accountCode: openingAccount.code,
        amount: Number(openingForm.amount),
        asOf: openingForm.asOf,
        partyType: openingParty ? (openingParty.partyType as 'rider' | 'vendor') : null,
        partyId: openingParty?.partyId ?? null,
        reference: openingForm.reference,
      });
      setNotice(
        result.created
          ? `Opening balance posted as ${result.entryNo}.`
          : `That opening balance was already recorded as ${result.entryNo ?? 'an earlier entry'}.`,
      );
      setOpening(null);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const formOpen = editing !== null || (opening !== null && openingAccount !== null);
  const closeForm = () => {
    setEditing(null);
    setOpening(null);
  };

  const openingReady =
    Boolean(openingForm.amount) &&
    Boolean(openingForm.asOf) &&
    openingForm.reference.trim().length >= 2 &&
    !(openingAccount?.isControl && !openingParty);

  // While a master form is open the screen is that form, as Tally's Ledger
  // Creation is: Ctrl+A accepts it, Esc quits back to the list. Otherwise it
  // is the list, and Alt+C creates — Tally's key for a new master.
  const actions: TallyAction[] = formOpen
    ? [
        {
          key: 'Ctrl+A',
          label: saving ? 'Saving…' : 'Accept',
          onSelect: () => formRef.current?.requestSubmit(),
          disabled: saving || (opening !== null && !openingReady),
          primary: true,
        },
        quitAction(closeForm),
      ]
    : [
        { key: 'Alt+C', label: 'Create', onSelect: openAdd, primary: true },
        printAction(),
        dayBookAction(navigate),
        quitAction(goBack),
      ];

  const formTitle = opening !== null
    ? 'Opening Balance'
    : editing === '' ? 'Ledger Creation' : 'Ledger Alteration';

  return (
    <TallyPage
      title={formOpen ? formTitle : 'Chart of Accounts'}
      period={formOpen ? undefined : `${rows.length} ledger${rows.length === 1 ? '' : 's'}`}
      periodLabel={formOpen ? undefined : 'Masters'}
      actions={actions}
      error={error}
      loading={loading}
      menu={!formOpen}
    >
      {notice && <p className="tly-note">{notice}</p>}

      {opening !== null && openingAccount && (
        <form ref={formRef} className="tly-voucher jv" onSubmit={saveOpening}>
          <div className="jv-meta">
            <div className="jv-meta-field">
              <span>Ledger :</span>
              <strong>{openingAccount.name} · {openingAccount.code}</strong>
            </div>
          </div>

          <p className="tly-note" style={{ margin: '0 var(--space-4)' }}>
            A starting position nothing in the system can produce — cash a rider was already holding when
            the books began, or a bank account opened with money in it. It posts against Opening Balance
            Equity, so the books stay balanced. The reference is its identity: recording the same one
            twice changes nothing rather than doubling the figure.
          </p>

          <div className="jv-form">
            <span className="jv-form-label">Amount :</span>
            <FormField
              label="Amount"
              hideLabel
              type="number"
              value={openingForm.amount}
              onChange={(amount) => setOpeningForm({ ...openingForm, amount })}
              placeholder="5000"
            />
            <span className="jv-form-hint">
              {openingAccount.normalSide === 'debit'
                ? 'Positive is what this account holds (Dr). Negative reverses it.'
                : 'Positive is what this account owes (Cr). Negative reverses it.'}
            </span>

            <span className="jv-form-label">As on :</span>
            <NepaliDatePicker
              value={openingForm.asOf}
              onChange={(asOf) => setOpeningForm({ ...openingForm, asOf })}
              placeholder="Date the position is stated as of"
              aria-label="As on"
            />

            <span className="jv-form-label">Reference :</span>
            <FormField
              label="Reference"
              hideLabel
              value={openingForm.reference}
              onChange={(reference) => setOpeningForm({ ...openingForm, reference })}
              placeholder="Migration from spreadsheet, Shrawan 2083"
            />

            {openingAccount.isControl && (
              <>
                {/* A control account's balance is the sum of its subledger, so
                    an opening with nobody named would sit in the total and in
                    none of the per-party ledgers meant to add up to it. */}
                <span className="jv-form-label">{openingAccount.subledgerType === 'vendor' ? 'Vendor' : 'Rider'} :</span>
                <PartyPicker
                  types={openingAccount.subledgerType === 'vendor' ? ['vendor'] : ['rider']}
                  value={openingParty}
                  onChange={setOpeningParty}
                  prompt=""
                />
              </>
            )}
          </div>

          <nav className="jv-menu" aria-label="Form menu">
            <button type="submit" className="jv-menu-item is-primary" disabled={saving || !openingReady}>
              {saving ? 'Posting…' : 'Accept'}
            </button>
            <button type="button" className="jv-menu-item" onClick={closeForm}>Quit</button>
          </nav>
        </form>
      )}

      {editing !== null && (
        <form ref={formRef} className="tly-voucher jv" onSubmit={save}>
          {locked && (
            <p className="tly-note" style={{ margin: 'var(--space-3) var(--space-4) 0' }}>
              {current?.lineCount} posted line(s) reference this ledger, so its type and normal side are
              fixed. Changing either would not correct those entries — it would silently change what every
              one of them means. Create a new ledger and point future postings at it instead.
            </p>
          )}

          {/* Tally's master form: a label column, one field per row. The
              locked fields say why they are locked rather than just going grey. */}
          <div className="jv-form">
            <span className="jv-form-label">Name :</span>
            <FormField label="Name" hideLabel value={form.name} onChange={(name) => setForm({ ...form, name })} placeholder="Nabil Bank" />

            <span className="jv-form-label">Code :</span>
            <FormField label="Code" hideLabel value={form.code} onChange={() => {}} disabled />
            <span className="jv-form-hint">
              {editing === ''
                ? 'Generated from the type: the next free number in its block.'
                : 'A code identifies the ledger everywhere it has been posted.'}
            </span>

            <span className="jv-form-label">Under :</span>
            <FormField
              label="Under"
              hideLabel
              type="select"
              value={form.subType}
              // The side follows the type, because getting that pair wrong
              // inverts the account. It stays editable underneath for the one
              // case that wants the other side: a contra account.
              onChange={(next) => {
                const subType = next as AccountClass;
                setForm({
                  ...form,
                  subType,
                  normalSide: CLASS_NORMAL_SIDE[subType],
                  ...(editing === '' ? { code: nextCode(rows, subType) } : {}),
                });
              }}
              disabled={locked}
              options={ACCOUNT_CLASSES.map((subType) => ({ value: subType, label: ACCOUNT_CLASS_LABELS[subType] }))}
            />
            {locked && <span className="jv-form-hint">Fixed — this ledger has posted lines.</span>}

            <span className="jv-form-label">Normal side :</span>
            <FormField
              label="Normal side"
              hideLabel
              type="select"
              value={form.normalSide}
              onChange={(next) => setForm({ ...form, normalSide: next as 'debit' | 'credit' })}
              disabled={locked}
              options={[
                { value: 'debit', label: 'Debit (Dr)' },
                { value: 'credit', label: 'Credit (Cr)' },
              ]}
            />

            <span className="jv-form-label">Description :</span>
            <FormField
              label="Description"
              hideLabel
              value={form.description}
              onChange={(description) => setForm({ ...form, description })}
              placeholder="What lands in this ledger, and when"
            />
          </div>

          <nav className="jv-menu" aria-label="Form menu">
            <button type="submit" className="jv-menu-item is-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Accept'}
            </button>
            <button type="button" className="jv-menu-item" onClick={closeForm}>Quit</button>
          </nav>
        </form>
      )}

      {!formOpen && (
        <div className="tly-voucher jv">
          <div className="tly-scroll">
            <table className="tly-sheet jv-sheet jv-report">
              <thead>
                <tr>
                  <th className="jv-col-account">Particulars</th>
                  <th style={{ width: '9%' }}>Code</th>
                  <th style={{ width: '18%' }}>Under</th>
                  <th style={{ width: '8%' }}>Side</th>
                  <th style={{ width: '22%' }}>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((node) => (
                  <tr key={node.code} className={node.isActive ? undefined : 'tly-muted'}>
                    <td style={{ paddingLeft: `calc(var(--space-3) + ${node.depth} * var(--space-5))` }}>
                      {node.children.length > 0 ? <strong>{node.name}</strong> : node.name}
                      {node.isControl && <span className="tly-muted"> · control ({node.subledgerType})</span>}
                      {!node.isActive && <span className="tly-muted"> (inactive)</span>}
                    </td>
                    <td>{node.code}</td>
                    <td>{node.subType ? ACCOUNT_CLASS_LABELS[node.subType] : <span className="tly-muted">—</span>}</td>
                    <td>{node.normalSide === 'debit' ? 'Dr' : 'Cr'}</td>
                    <td>
                      <div className="jv-row-actions">
                        <button type="button" className="jv-link" onClick={() => openEdit(node)}>Alter</button>
                        <button type="button" className="jv-link" onClick={() => openOpening(node)}>Opening</button>
                        <span className="tly-toggle">
                          <ToggleSwitch
                            checked={node.isActive}
                            onChange={() => void toggleActive(node)}
                            ariaLabel={`${node.isActive ? 'Deactivate' : 'Activate'} ${node.code} ${node.name}`}
                          />
                          <span>{node.isActive ? 'Active' : 'Inactive'}</span>
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="jv-pagination">
            <Pagination
              ariaLabel="Chart of accounts pagination"
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              pageSize={pageSize}
              pageSizeLabel="ledgers"
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              summary={`${rows.length} ledger${rows.length === 1 ? '' : 's'}`}
            />
          </div>
        </div>
      )}
    </TallyPage>
  );
};

export default MastersPage;
