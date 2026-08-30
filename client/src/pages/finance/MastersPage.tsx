import React, { useCallback, useEffect, useMemo, useState } from 'react';
import TallyPage, { type TallyAction } from '../../components/finance/TallyPage';
import Button from '../../components/Button';
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

/** Depth-first walk, so the tree can be rendered as indented rows. */
function flatten(nodes: AccountNode[]): AccountNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

const MastersPage: React.FC = () => {

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

  const openAdd = () => {
    setForm(blankForm());
    setEditing('');
    setNotice('');
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
    setNotice('');
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

  // One action, because this screen does one thing. Refresh repeated the
  // browser's own, and Day book and Back repeated the nav and the back button:
  // three keys to memorise for things the app already does, sitting beside the
  // one that matters.
  const actions: TallyAction[] = [{ key: 'F4', label: 'Add account', onSelect: openAdd, primary: true }];

  return (
    <TallyPage
      title="Masters — Chart of Accounts"
      period={`${rows.length} account${rows.length === 1 ? '' : 's'}`}
      actions={actions}
      error={error}
      loading={loading}
    >
      {notice && <p className="tly-note">{notice}</p>}

      {opening !== null && openingAccount && (
        <form className="tly-voucher" onSubmit={saveOpening}>
          <div className="tly-titlebar">
            <h2 className="tly-title">Opening balance — {openingAccount.code} {openingAccount.name}</h2>
          </div>

          <p className="tly-note">
            A starting position nothing in the system can produce — cash a rider was already holding when
            the books began, or a bank account opened with money in it. It posts against Opening Balance
            Equity, so the books stay balanced. The reference is its identity: recording the same one
            twice changes nothing rather than doubling the figure.
          </p>

          <div className="tly-form-grid">
            <FormField
              label="Amount"
              required
              type="number"
              value={openingForm.amount}
              onChange={(amount) => setOpeningForm({ ...openingForm, amount })}
              placeholder="5000"
              hint={
                openingAccount.normalSide === 'debit'
                  ? 'Positive is what this account holds. Negative reverses it.'
                  : 'Positive is what this account owes. Negative reverses it.'
              }
            />
            <label className="tly-form-date" aria-label="As of">
              <span>As of</span>
              <NepaliDatePicker
                value={openingForm.asOf}
                onChange={(asOf) => setOpeningForm({ ...openingForm, asOf })}
                placeholder="Date the position is stated as of"
              />
            </label>
            <FormField
              label="Reference"
              required
              value={openingForm.reference}
              onChange={(reference) => setOpeningForm({ ...openingForm, reference })}
              placeholder="Migration from spreadsheet, Shrawan 2083"
              gridColumn="1 / -1"
            />
          </div>

          {openingAccount.isControl && (
            <div className="tly-form-party">
              {/* A control account's balance is the sum of its subledger, so an
                  opening with nobody named would sit in the total and in none of
                  the per-party ledgers that are meant to add up to it. */}
              <PartyPicker
                types={openingAccount.subledgerType === 'vendor' ? ['vendor'] : ['rider']}
                value={openingParty}
                onChange={setOpeningParty}
                prompt={`Which ${openingAccount.subledgerType ?? 'party'} is this opening balance for?`}
              />
            </div>
          )}

          <div className="tly-form-actions">
            <Button type="button" variant="outline" onClick={() => setOpening(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={
                saving ||
                !openingForm.amount ||
                !openingForm.asOf ||
                openingForm.reference.trim().length < 2 ||
                (openingAccount.isControl && !openingParty)
              }
            >
              {saving ? 'Posting…' : 'Accept'}
            </Button>
          </div>
        </form>
      )}

      {editing !== null && (
        <form className="tly-voucher" onSubmit={save}>
          <div className="tly-titlebar">
            <h2 className="tly-title">{editing === '' ? 'Create account' : `Edit ${current?.code}`}</h2>
          </div>

          {locked && (
            <p className="tly-note">
              {current?.lineCount} posted line(s) reference this account, so its type and normal side are
              fixed. Changing either would not correct those entries — it would silently change what every
              one of them means. Create a new account and point future postings at it instead.
            </p>
          )}

          {/* The design system's FormField, the same control every other form
              in the app is built from, rather than bare inputs borrowing the
              filter strip's styling. The two locked fields say why they are
              locked rather than just going grey. */}
          <div className="tly-form-grid">
            <FormField
              label="Code"
              required
              value={form.code}
              onChange={(code) => setForm({ ...form, code })}
              disabled={editing !== ''}
              placeholder="1200"
              hint={editing === '' ? undefined : 'A code identifies the account everywhere it has been posted.'}
            />
            <FormField
              label="Name"
              required
              value={form.name}
              onChange={(name) => setForm({ ...form, name })}
              placeholder="Nabil Bank"
            />
            <FormField
              label="Type"
              type="select"
              value={form.subType}
              // The side follows the type, because getting that pair wrong
              // inverts the account and almost nobody wants an asset on the
              // credit side. It stays editable underneath for the one case
              // that wants the other side: a contra account.
              onChange={(next) => {
                const subType = next as AccountClass;
                setForm({ ...form, subType, normalSide: CLASS_NORMAL_SIDE[subType] });
              }}
              disabled={locked}
              options={ACCOUNT_CLASSES.map((subType) => ({
                value: subType,
                label: ACCOUNT_CLASS_LABELS[subType],
              }))}
              hint={locked ? 'Fixed — this account has posted lines.' : undefined}
            />
            <FormField
              label="Normal side"
              type="select"
              value={form.normalSide}
              onChange={(next) => setForm({ ...form, normalSide: next as 'debit' | 'credit' })}
              disabled={locked}
              options={[
                { value: 'debit', label: 'debit' },
                { value: 'credit', label: 'credit' },
              ]}
              hint={locked ? 'Fixed — this account has posted lines.' : undefined}
            />
            <FormField
              label="Description"
              value={form.description}
              onChange={(description) => setForm({ ...form, description })}
              placeholder="What lands in this account, and when"
              gridColumn="1 / -1"
            />
          </div>

          {/* Real Buttons, not `tly-key` styled ones. The key panel's flat rows
              are right for a list of shortcuts and wrong for a form's commit:
              this is the design system's primary action, and it should look
              like every other one in the app. */}
          <div className="tly-form-actions">
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Accept'}
            </Button>
          </div>
        </form>
      )}

      <div className="tly-scroll">
        <table className="tly-sheet">
          <thead>
            <tr>
              <th style={{ width: '8%' }}>Code</th>
              <th>Name</th>
              <th style={{ width: '18%' }}>Type</th>
              <th style={{ width: '10%' }}>Normal side</th>
              <th style={{ width: '24%' }}>&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((node) => (
              <tr key={node.code} className={node.isActive ? undefined : 'tly-muted'}>
                <td>{node.code}</td>
                <td style={{ paddingLeft: `calc(var(--space-3) + ${node.depth} * var(--space-5))` }}>
                  {node.children.length > 0 ? <strong>{node.name}</strong> : node.name}
                  {node.isControl && (
                    <span className="tly-muted"> · control ({node.subledgerType})</span>
                  )}
                </td>
                <td>
                  {node.subType ? ACCOUNT_CLASS_LABELS[node.subType] : <span className="tly-muted">—</span>}
                </td>
                <td>{node.normalSide}</td>
                <td>
                  <div className="tly-row-actions">
                    <Button size="sm" variant="outline" onClick={() => openEdit(node)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openOpening(node)}>
                      Opening
                    </Button>
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

      <Pagination
        ariaLabel="Chart of accounts pagination"
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        pageSize={pageSize}
        pageSizeLabel="accounts"
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        summary={`${rows.length} account${rows.length === 1 ? '' : 's'}`}
      />
    </TallyPage>
  );
};

export default MastersPage;
