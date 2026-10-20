import React, { useEffect, useState } from 'react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import PageHeader from '../components/PageHeader';
import Pagination from '../components/Pagination';
import StatusChip from '../components/StatusChip';
import Table from '../components/Table';
import { createBank, getBanks, updateBank, type Bank } from '../services/banks.service';
import { apiErrorMessage } from '../utils/serverValidation';
import './BankManagement.css';
import { useToast } from '../components/toast';
import { Skeleton } from '../components/Skeleton';

/**
 * The banks vendors can be paid through, with their bank codes. Feeds every
 * bank-name picker. A bank's name can't be changed (vendors store it), so a
 * bank is replaced by disabling it and adding the new one.
 */
const BankManagement: React.FC = () => {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', code: '' });
  const [editing, setEditing] = useState<{ id: string; code: string } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const toast = useToast();

  // The whole list is already in memory, so paging is a slice of it.
  const totalPages = Math.max(1, Math.ceil(banks.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedBanks = banks.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    getBanks()
      .then(setBanks)
      .catch((err) => setError(apiErrorMessage(err, 'Failed to load banks')))
      .finally(() => setLoading(false));
  }, []);

  // Every write goes the same way: run it, then refresh the list or say why not.
  const save = async (write: () => Promise<unknown>, onDone: () => void = () => {}) => {
    setSaving(true);
    setError('');
    try {
      await write();
      onDone();
      setBanks(await getBanks());
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to save bank'));
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = (event: React.FormEvent) => {
    event.preventDefault();
    void save(() => createBank(form), () => setForm({ name: '', code: '' }));
  };

  const columns = [
    { header: 'BANK NAME', accessor: (bank: Bank) => bank.name },
    {
      header: 'BANK CODE',
      accessor: (bank: Bank) =>
        editing?.id === bank.id ? (
          <FormField
            label="Bank code"
            hideLabel
            value={editing.code}
            onChange={(code) => setEditing({ id: bank.id, code })}
          />
        ) : (
          bank.code
        ),
    },
    {
      header: 'STATUS',
      accessor: (bank: Bank) => (
        <StatusChip tone={bank.isActive ? 'success' : 'neutral'}>{bank.isActive ? 'Active' : 'Disabled'}</StatusChip>
      ),
    },
    {
      header: 'ACTION',
      accessor: (bank: Bank) =>
        editing?.id === bank.id ? (
          <div className="banks-actions">
            <Button
              size="sm"
              disabled={saving}
              onClick={() => save(() => updateBank(bank.id, { code: editing.code }), () => setEditing(null))}
            >
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="banks-actions">
            <Button size="sm" variant="secondary" onClick={() => setEditing({ id: bank.id, code: bank.code })}>
              Edit code
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={saving}
              onClick={() => save(() => updateBank(bank.id, { isActive: !bank.isActive }))}
            >
              {bank.isActive ? 'Disable' : 'Enable'}
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="banks-page">
      <PageHeader title="Banks" />

      <form className="banks-add" onSubmit={handleAdd}>
        <FormField
          label="Bank name"
          required
          value={form.name}
          onChange={(name) => setForm((prev) => ({ ...prev, name }))}
          placeholder="e.g. Nabil Bank Ltd."
        />
        <FormField
          label="Bank code"
          required
          value={form.code}
          onChange={(code) => setForm((prev) => ({ ...prev, code }))}
          placeholder="e.g. 0401"
        />
        <Button type="submit" disabled={saving || !form.name.trim() || !form.code.trim()}>
          Add bank
        </Button>
      </form>

      {error && <p className="banks-error">{error}</p>}

      <Table
        columns={columns}
        data={pagedBanks}
        selectable={false}
        loading={loading}
        emptyMessage="No banks yet. Add one above."
      />

      <Pagination
        ariaLabel="Bank pages"
        page={currentPage}
        totalPages={totalPages}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        pageSizeLabel="banks"
        summary={
          loading
            ? <Skeleton width={140} className="skeleton-inline" />
            : banks.length === 0
              ? 'No banks'
              : `Showing ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, banks.length)} of ${banks.length} banks`
        }
      />
    </div>
  );
};

export default BankManagement;
