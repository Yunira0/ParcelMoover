import React, { useEffect, useState } from 'react';
import FormField from '../FormField';
import Button from '../Button';
import {
  getVendorVolumeSettings,
  updateVendorVolumeSettings,
} from '../../services/vendorVolume.service';
import './VendorVolumeLimitPanel.css';

// Super admin only - the daily-parcel threshold behind the "High volume
// vendor" filter tab. A vendor qualifies once any single day's parcel count
// exceeds this, so this is deliberately the only knob: everything else about
// how that's computed lives server-side.
const VendorVolumeLimitPanel: React.FC = () => {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getVendorVolumeSettings();
      if (res?.success) setValue(String(res.data.highVolumeDailyParcels));
    } catch {
      setError('Failed to load the volume limit.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError('Enter a whole number of parcels per day, at least 1.');
      return;
    }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const res = await updateVendorVolumeSettings(Math.round(parsed));
      if (res?.success) {
        setValue(String(res.data.highVolumeDailyParcels));
        setSaved(true);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to save the volume limit.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="vendor-volume-panel">
      <p className="vendor-volume-panel-hint">
        A vendor moves into "High volume vendor" once they place more than this many
        parcels in a single day.
      </p>

      {error && <p className="vendor-volume-panel-error">{error}</p>}

      {loading ? (
        <p className="vendor-volume-panel-hint">Loading…</p>
      ) : (
        <div className="vendor-volume-panel-form">
          <FormField
            label="Parcels per day"
            type="number"
            min={1}
            value={value}
            onChange={(v) => { setValue(v); setSaved(false); }}
            placeholder="e.g. 100"
          />
          <div className="vendor-volume-panel-actions">
            {saved && <span className="vendor-volume-panel-saved">Saved.</span>}
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
};

export default VendorVolumeLimitPanel;
