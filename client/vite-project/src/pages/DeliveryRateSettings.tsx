import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import Table from '../components/Table';
import FormField from '../components/FormField';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import { getLocations } from '../services/users.service';
import {
  listDeliveryRates,
  setDeliveryRateActive,
  upsertDeliveryRate,
  type DeliveryRate,
} from '../services/deliveryRates.service';
import './DeliveryRateSettings.css';

const getCurrentUser = (): { roles: string[] } | null => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
};

const defaultFormState = {
  originLocationId: '',
  destinationLocationId: '',
  baseCharge: '',
  extraWeightPercent: '',
  freeWeightKg: '2',
};

const DeliveryRateSettings: React.FC = () => {
  const currentUser = getCurrentUser();
  const isSuperAdmin = Boolean(currentUser?.roles?.includes('super_admin'));

  const [rates, setRates] = useState<DeliveryRate[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(defaultFormState);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
    if (!isSuperAdmin) return;
    loadRates();
    (async () => {
      try {
        const res = await getLocations();
        if (res?.success && Array.isArray(res.data)) {
          setLocations(res.data.map((l: any) => ({ id: l.id, name: l.name })));
        }
      } catch (err) {
        console.error('Failed to load locations:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return (
      <div className="delivery-rate-settings-page">
        <h1>Access restricted</h1>
        <p>Delivery rate settings are only available to super admins.</p>
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.originLocationId || !form.destinationLocationId) {
      setError('Please select both origin and destination.');
      return;
    }
    const baseCharge = Number(form.baseCharge);
    if (!(baseCharge >= 0)) {
      setError('Base charge must be a non-negative number.');
      return;
    }
    setSaving(true);
    try {
      await upsertDeliveryRate({
        originLocationId: form.originLocationId,
        destinationLocationId: form.destinationLocationId,
        baseCharge,
        extraWeightPercent: form.extraWeightPercent ? Number(form.extraWeightPercent) : 0,
        freeWeightKg: form.freeWeightKg ? Number(form.freeWeightKg) : 2,
      });
      setForm(defaultFormState);
      setShowForm(false);
      await loadRates();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save delivery rate.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (rate: DeliveryRate) => {
    await setDeliveryRateActive(rate.id, !rate.isActive);
    loadRates();
  };

  const columns = [
    { header: 'ORIGIN', accessor: (r: DeliveryRate) => r.originLocationName },
    { header: 'DESTINATION', accessor: (r: DeliveryRate) => r.destinationLocationName },
    { header: 'BASE CHARGE', accessor: (r: DeliveryRate) => r.baseCharge.toLocaleString() },
    { header: 'EXTRA % / KG', accessor: (r: DeliveryRate) => `${r.extraWeightPercent}%` },
    { header: 'FREE WEIGHT', accessor: (r: DeliveryRate) => `${r.freeWeightKg} kg` },
    {
      header: 'STATUS',
      accessor: (r: DeliveryRate) => (
        <button
          type="button"
          className={`rate-status-toggle ${r.isActive ? 'active' : 'inactive'}`}
          onClick={() => toggleActive(r)}
        >
          {r.isActive ? 'Active' : 'Inactive'}
        </button>
      ),
    },
  ];

  const locationSelectOptions = locations.map(l => ({ id: l.id, label: l.name }));

  return (
    <div className="delivery-rate-settings-page">
      <PageHeader
        title="Delivery Rates"
        subtitle="Configure the base delivery charge and extra-weight surcharge per route."
        actionLabel="Add Rate"
        actionIcon={<Plus size={16} />}
        onAction={() => setShowForm(v => !v)}
      />

      {showForm && (
        <form className="delivery-rate-form" onSubmit={handleSave}>
          <div className="delivery-rate-form-row">
            <FormField
              label="Origin"
              required
              type="searchable-select"
              searchableOptions={locationSelectOptions}
              value={form.originLocationId}
              onChange={id => setForm(prev => ({ ...prev, originLocationId: id }))}
              placeholder="Select origin"
            />
            <FormField
              label="Destination"
              required
              type="searchable-select"
              searchableOptions={locationSelectOptions}
              value={form.destinationLocationId}
              onChange={id => setForm(prev => ({ ...prev, destinationLocationId: id }))}
              placeholder="Select destination"
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
            />
            <FormField
              label="Free Weight (kg)"
              type="number"
              min={0}
              step="0.1"
              value={form.freeWeightKg}
              onChange={value => setForm(prev => ({ ...prev, freeWeightKg: value }))}
            />
            <FormField
              label="Extra Weight Surcharge (% of base, per kg)"
              type="number"
              min={0}
              value={form.extraWeightPercent}
              onChange={value => setForm(prev => ({ ...prev, extraWeightPercent: value }))}
              placeholder="e.g. 10"
            />
          </div>
          {error && <p className="delivery-rate-error">{error}</p>}
          <div className="delivery-rate-form-actions">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Rate'}
            </Button>
          </div>
        </form>
      )}

      <Table
        columns={columns}
        data={rates}
        selectable={false}
        loading={loading}
        loadingMessage="Loading delivery rates..."
        emptyMessage="No delivery rates configured yet."
      />
    </div>
  );
};

export default DeliveryRateSettings;
