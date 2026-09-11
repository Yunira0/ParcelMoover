import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import DeliveryRatesImport from './DeliveryRatesImport';
import Table from '../components/Table';
import FormField from '../components/FormField';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import ToggleSwitch from '../components/ToggleSwitch';
import StatusChip from '../components/StatusChip';
import { listManagedLocations, type Destination } from '../services/locations.service';
import {
  deleteDeliveryRate,
  listDeliveryRates,
  setDeliveryRateActive,
  upsertDeliveryRate,
  type DeliveryRate,
} from '../services/deliveryRates.service';
import { getCurrentUserLocationId, hasAdminPermission, isBranchWorkspaceUser } from '../utils/auth';
import './DeliveryRateSettings.css';

const defaultFormState = {
  originLocationId: '',
  destinationLocationId: '',
  baseCharge: '',
  branchBaseCharge: '',
  returnPercent: '',
  branchReturnPercent: '',
  extraWeightPercent: '',
  freeWeightKg: '2',
};

const RATE_FIELD_MAP: Record<string, string> = {
  originLocationId: 'originLocationId',
  destinationLocationId: 'destinationLocationId',
  baseCharge: 'baseCharge',
  extraWeightPercent: 'extraWeightPercent',
  freeWeightKg: 'freeWeightKg',
};

const DeliveryRateSettings: React.FC = () => {
  // The server scopes a branch-scoped admin to routes originating from their
  // own hub; lock the Origin field to match instead of letting them pick one
  // that would just get rejected on save.
  const isBranchWorkspace = isBranchWorkspaceUser();
  const ownLocationId = getCurrentUserLocationId();
  // super_admin, an admin the super_admin granted SETTINGS_ACCESS to, or any
  // branch workspace admin - their access is already scoped to their own hub
  // server-side, so no separate delegation is needed on top of that.
  const canConfigure = hasAdminPermission('SETTINGS_ACCESS') || isBranchWorkspace;

  const [rates, setRates] = useState<DeliveryRate[]>([]);
  // Same destinations + covered areas as the super admin's Destinations &
  // Rates screen (they're the same underlying locations), so a covered area
  // can be picked as its own origin/destination here too, not just its hub.
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState(() => (
    isBranchWorkspace && ownLocationId
      ? { ...defaultFormState, originLocationId: ownLocationId }
      : defaultFormState
  ));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // The rate currently being edited, or null when the form is adding a new
  // one. upsertDeliveryRate is keyed by (origin, destination), so editing
  // reuses the same submit path - only the origin/destination fields are
  // locked while editing, so the save can't accidentally spawn a second row.
  const [editingRate, setEditingRate] = useState<DeliveryRate | null>(null);
  const [statusSavingIds, setStatusSavingIds] = useState<Set<string>>(new Set());
  const [statusError, setStatusError] = useState('');
  // Same inline "are you sure" pattern as Settings > Destinations & Areas,
  // instead of a native window.confirm.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // destinationLocationId -> its active covered areas' names, from the same
  // Destinations & Rates data as the picker below - looked up by id rather
  // than name so it can't be fooled by two destinations sharing a name.
  const coveredAreasByDestinationId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const d of destinations) {
      map.set(d.id, d.areas.filter(a => a.isActive).map(a => a.name));
    }
    return map;
  }, [destinations]);

  const filteredRates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rates;
    return rates.filter((r) => {
      if (r.originLocationName.toLowerCase().includes(q) || r.destinationLocationName.toLowerCase().includes(q)) {
        return true;
      }
      const areas = coveredAreasByDestinationId.get(r.destinationLocationId);
      return areas?.some((name) => name.toLowerCase().includes(q)) ?? false;
    });
  }, [rates, searchQuery, coveredAreasByDestinationId]);

  const loadRates = async () => {
    setLoading(true);
    try {
      const res = await listDeliveryRates();
      if (res?.success) setRates(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canConfigure) return;
    loadRates();
    (async () => {
      try {
        const res = await listManagedLocations();
        if (res?.success && Array.isArray(res.data)) {
          setDestinations(res.data);
        }
      } catch (err) {
        console.error('Failed to load locations:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canConfigure]);

  if (!canConfigure) {
    return (
      <div className="delivery-rate-settings-page">
        <h1>Access restricted</h1>
        <p>Delivery rate settings are only available to super admins or admins granted settings access.</p>
      </div>
    );
  }

  const blankForm = () => (
    isBranchWorkspace && ownLocationId
      ? { ...defaultFormState, originLocationId: ownLocationId }
      : defaultFormState
  );

  const openCreateForm = () => {
    setEditingRate(null);
    setForm(blankForm());
    setFieldErrors({});
    setGeneralError('');
    setShowForm(true);
    setShowImport(false);
  };

  const openEditForm = (rate: DeliveryRate) => {
    setEditingRate(rate);
    setForm({
      originLocationId: rate.originLocationId,
      destinationLocationId: rate.destinationLocationId,
      baseCharge: String(rate.baseCharge),
      branchBaseCharge: rate.branchBaseCharge != null ? String(rate.branchBaseCharge) : '',
      returnPercent: rate.returnPercent ? String(rate.returnPercent) : '',
      branchReturnPercent: rate.branchReturnPercent != null ? String(rate.branchReturnPercent) : '',
      extraWeightPercent: rate.extraWeightPercent ? String(rate.extraWeightPercent) : '',
      freeWeightKg: String(rate.freeWeightKg),
    });
    setFieldErrors({});
    setGeneralError('');
    setShowForm(true);
    setShowImport(false);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingRate(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFieldErrors({});
    setGeneralError('');

    const errors: Record<string, string> = {};
    if (!form.originLocationId) errors.originLocationId = 'Please select an origin location.';
    if (!form.destinationLocationId) errors.destinationLocationId = 'Please select a destination location.';
    const baseCharge = Number(form.baseCharge);
    if (!(baseCharge >= 0) || form.baseCharge === '') errors.baseCharge = 'Base charge must be a non-negative number.';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    try {
      await upsertDeliveryRate({
        originLocationId: form.originLocationId,
        destinationLocationId: form.destinationLocationId,
        baseCharge,
        branchBaseCharge: form.branchBaseCharge ? Number(form.branchBaseCharge) : null,
        returnPercent: form.returnPercent ? Number(form.returnPercent) : 0,
        branchReturnPercent: form.branchReturnPercent ? Number(form.branchReturnPercent) : null,
        extraWeightPercent: form.extraWeightPercent ? Number(form.extraWeightPercent) : 0,
        freeWeightKg: form.freeWeightKg ? Number(form.freeWeightKg) : 2,
      });
      setForm(blankForm());
      closeForm();
      await loadRates();
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.errors?.length) {
        const mapped: Record<string, string> = {};
        const unmapped: string[] = [];
        for (const e of data.errors as { field: string; message: string }[]) {
          const key = RATE_FIELD_MAP[e.field];
          if (key) mapped[key] = e.message;
          else unmapped.push(e.message);
        }
        setFieldErrors(mapped);
        if (unmapped.length > 0) setGeneralError(unmapped[0]);
      } else {
        setGeneralError(data?.message || 'Failed to save delivery rate.');
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (rate: DeliveryRate) => {
    const nextActive = !rate.isActive;
    setStatusError('');
    setStatusSavingIds(prev => new Set(prev).add(rate.id));
    setRates(prev => prev.map(r => (r.id === rate.id ? { ...r, isActive: nextActive } : r)));
    try {
      await setDeliveryRateActive(rate.id, nextActive);
    } catch (err) {
      console.error('Failed to update delivery rate status:', err);
      setRates(prev => prev.map(r => (r.id === rate.id ? { ...r, isActive: rate.isActive } : r)));
      setStatusError(
        `Failed to set ${rate.originLocationName} → ${rate.destinationLocationName} ${nextActive ? 'active' : 'inactive'}. Please try again.`,
      );
    } finally {
      setStatusSavingIds(prev => {
        const next = new Set(prev);
        next.delete(rate.id);
        return next;
      });
    }
  };

  const handleDelete = async (rate: DeliveryRate) => {
    setDeleting(true);
    setStatusError('');
    try {
      await deleteDeliveryRate(rate.id);
      setConfirmDeleteId(null);
      if (editingRate?.id === rate.id) closeForm();
      await loadRates();
    } catch (err: any) {
      setStatusError(err?.response?.data?.message || 'Failed to delete delivery rate.');
      setConfirmDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

  const columns = [
    { header: 'ORIGIN', accessor: (r: DeliveryRate) => r.originLocationName },
    { header: 'DESTINATION', accessor: (r: DeliveryRate) => r.destinationLocationName },
    {
      header: 'COVERED AREAS',
      accessor: (r: DeliveryRate) => {
        const areas = coveredAreasByDestinationId.get(r.destinationLocationId);
        return areas && areas.length > 0 ? areas.join(', ') : '—';
      },
    },
    { header: 'BASE CHARGE', accessor: (r: DeliveryRate) => r.baseCharge.toLocaleString() },
    { header: 'BRANCH CHARGE', accessor: (r: DeliveryRate) => (r.branchBaseCharge != null ? r.branchBaseCharge.toLocaleString() : '—') },
    { header: 'RETURN %', accessor: (r: DeliveryRate) => `${r.returnPercent}%${r.branchReturnPercent != null ? ` (branch ${r.branchReturnPercent}%)` : ''}` },
    { header: 'EXTRA % / KG', accessor: (r: DeliveryRate) => `${r.extraWeightPercent}%` },
    { header: 'FREE WEIGHT', accessor: (r: DeliveryRate) => `${r.freeWeightKg} kg` },
    {
      header: 'STATUS',
      accessor: (r: DeliveryRate) => (
        <div className="rate-status-cell">
          <ToggleSwitch
            checked={r.isActive}
            disabled={statusSavingIds.has(r.id)}
            onChange={() => toggleActive(r)}
            ariaLabel={`Set ${r.originLocationName} → ${r.destinationLocationName} ${r.isActive ? 'inactive' : 'active'}`}
          />
          <StatusChip variant="solid" tone={r.isActive ? 'success' : 'danger'}>
            {r.isActive ? 'active' : 'inactive'}
          </StatusChip>
        </div>
      ),
    },
    {
      header: 'ACTIONS',
      accessor: (r: DeliveryRate) =>
        confirmDeleteId === r.id ? (
          <div className="rate-confirm-delete">
            <span>Delete this route?</span>
            <button
              type="button"
              className="rate-confirm-btn rate-confirm-btn--danger"
              disabled={deleting}
              onClick={() => handleDelete(r)}
            >
              {deleting ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button type="button" className="rate-confirm-btn" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="rate-actions-cell">
            <button type="button" className="rate-edit-btn" title="Edit rate" onClick={() => openEditForm(r)}>
              <Pencil size={15} />
            </button>
            <button
              type="button"
              className="rate-delete-btn"
              title="Delete rate"
              onClick={() => setConfirmDeleteId(r.id)}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ),
    },
  ];

  // Each active destination followed by its own active covered areas, so
  // either can be picked as a route's origin/destination - the description
  // disambiguates an area from its hub and from same-named areas under
  // different hubs. Inactive locations are omitted; the server would reject
  // them as an origin/destination anyway.
  const locationSelectOptions = destinations
    .filter(d => d.isActive)
    .flatMap(d => [
      { id: d.id, label: d.name, description: 'Destination' },
      ...d.areas.filter(a => a.isActive).map(a => ({ id: a.id, label: a.name, description: `Covered area of ${d.name}` })),
    ]);

  return (
    <div className="delivery-rate-settings-page">
      <PageHeader
        title="Route Rates"
        subtitle="Delivery, return and extra-weight charges per origin → destination route (e.g. Hetauda → Imadol, Hetauda → Pokhara). Branch-origin orders price off this table."
        actionLabel="Add Rate"
        actionIcon={<Plus size={16} />}
        onAction={() => (showForm ? closeForm() : openCreateForm())}
      />

      <div className="delivery-rate-toolbar">
        <Button
          variant={showImport ? 'primary' : 'secondary'}
          onClick={() => { setShowImport(v => !v); setShowForm(false); }}
        >
          <Upload size={15} /> {showImport ? 'Close Import' : 'Import from Excel'}
        </Button>
      </div>

      {showImport && <DeliveryRatesImport onImported={loadRates} />}

      {!showImport && showForm && (
        <form className="delivery-rate-form" onSubmit={handleSave}>
          {editingRate && (
            <p className="delivery-rate-editing-banner">
              Editing {editingRate.originLocationName} → {editingRate.destinationLocationName}
            </p>
          )}
          <div className="delivery-rate-form-row">
            <FormField
              label="Origin"
              required
              type="searchable-select"
              searchableOptions={locationSelectOptions}
              value={form.originLocationId}
              onChange={id => setForm(prev => ({ ...prev, originLocationId: id }))}
              placeholder="Select origin"
              error={fieldErrors.originLocationId}
              disabled={isBranchWorkspace || Boolean(editingRate)}
              hint={
                editingRate
                  ? 'The route can\'t be changed here - add a new rate instead.'
                  : isBranchWorkspace
                  ? 'Routes can only originate from your own branch.'
                  : undefined
              }
            />
            <FormField
              label="Destination"
              required
              type="searchable-select"
              searchableOptions={locationSelectOptions}
              value={form.destinationLocationId}
              onChange={id => setForm(prev => ({ ...prev, destinationLocationId: id }))}
              placeholder="Select destination"
              error={fieldErrors.destinationLocationId}
              disabled={Boolean(editingRate)}
            />
          </div>
          <div className="delivery-rate-form-row">
            <FormField
              label="Base Charge (covers free weight)"
              required
              type="number"
              min={0}
              value={form.baseCharge}
              onChange={value => setForm(prev => ({ ...prev, baseCharge: value }))}
              placeholder="e.g. 100"
              error={fieldErrors.baseCharge}
            />
            <FormField
              label="Branch Delivery Charge (optional)"
              type="number"
              min={0}
              value={form.branchBaseCharge}
              onChange={value => setForm(prev => ({ ...prev, branchBaseCharge: value }))}
              placeholder="e.g. 80"
            />
            <FormField
              label="Free Weight (kg)"
              type="number"
              min={0}
              step="0.1"
              value={form.freeWeightKg}
              onChange={value => setForm(prev => ({ ...prev, freeWeightKg: value }))}
              error={fieldErrors.freeWeightKg}
            />
            <FormField
              label="Extra Weight Surcharge (% of base, per kg)"
              type="number"
              min={0}
              value={form.extraWeightPercent}
              onChange={value => setForm(prev => ({ ...prev, extraWeightPercent: value }))}
              placeholder="e.g. 10"
              error={fieldErrors.extraWeightPercent}
            />
            <FormField
              label="Return Charge (% of delivery charge)"
              type="number"
              min={0}
              max={100}
              value={form.returnPercent}
              onChange={value => setForm(prev => ({ ...prev, returnPercent: value }))}
              placeholder="e.g. 50 · 0 = free return"
              error={fieldErrors.returnPercent}
            />
            <FormField
              label="Branch Return Charge (% · optional)"
              type="number"
              min={0}
              max={100}
              value={form.branchReturnPercent}
              onChange={value => setForm(prev => ({ ...prev, branchReturnPercent: value }))}
              placeholder="Falls back to the return %"
            />
          </div>
          {generalError && <p className="delivery-rate-error">{generalError}</p>}
          <div className="delivery-rate-form-actions">
            <Button type="button" variant="secondary" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving...' : editingRate ? 'Update Rate' : 'Save Rate'}
            </Button>
          </div>
        </form>
      )}

      {!showImport && (
        <>
          <div className="delivery-rate-search">
            <Search size={15} className="delivery-rate-search-icon" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by origin, destination or covered area…"
              className="delivery-rate-search-input"
            />
            {searchQuery && (
              <button type="button" className="delivery-rate-search-clear" onClick={() => setSearchQuery('')}>
                <X size={14} />
              </button>
            )}
          </div>
          {statusError && <p className="delivery-rate-error">{statusError}</p>}
          <Table
            columns={columns}
            data={filteredRates}
            selectable={false}
            loading={loading}
            loadingMessage="Loading delivery rates..."
            emptyMessage={searchQuery ? `No routes match "${searchQuery}".` : 'No delivery rates configured yet.'}
          />
        </>
      )}
    </div>
  );
};

export default DeliveryRateSettings;
