import React, { useEffect, useState } from 'react';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import FormField from '../components/FormField';
import {
  getSlaSettings,
  updateSlaSettings,
  SLA_GROUPS,
  type SlaSettings as SlaSettingsMap,
} from '../services/sla.service';
import './SlaSettings.css';

// Form state keeps each hour value as a string so an empty field cleanly maps
// to "SLA disabled" (null) on save.
type FormState = Record<string, string>;

const toForm = (data: SlaSettingsMap): FormState => {
  const form: FormState = {};
  for (const group of SLA_GROUPS) {
    for (const { key } of group.keys) {
      const v = data[key];
      form[key] = v === null || v === undefined ? '' : String(v);
    }
  }
  return form;
};

const SlaSettings: React.FC = () => {
  const [form, setForm] = useState<FormState>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getSlaSettings();
      if (res?.success) setForm(toForm(res.data));
    } catch {
      setError('Failed to load SLA settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const setValue = (key: string, value: string) => {
    setForm((p) => ({ ...p, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const payload: SlaSettingsMap = {};
      for (const group of SLA_GROUPS) {
        for (const { key } of group.keys) {
          const raw = (form[key] ?? '').trim();
          payload[key] = raw === '' ? null : Math.max(0, Math.round(Number(raw)));
        }
      }
      const res = await updateSlaSettings(payload);
      if (res?.success) {
        setForm(toForm(res.data));
        setSaved(true);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save SLA settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sla-page">
      <PageHeader
        title="SLA"
        subtitle="Set how many hours an order may sit in each status before it shows up in “Needs attention”. Leave a field blank to disable that SLA."
      />

      {error && <p className="sla-error">{error}</p>}

      {loading ? (
        <p className="sla-muted">Loading SLA settings…</p>
      ) : (
        <>
          <div className="sla-groups">
            {SLA_GROUPS.map((group) => (
              <section key={group.title} className="sla-card">
                <h3 className="sla-card-title">{group.title}</h3>
                <div className="sla-grid">
                  {group.keys.map(({ key, label }) => (
                    <FormField
                      key={key}
                      label={label}
                      type="number"
                      min={0}
                      value={form[key] ?? ''}
                      onChange={(v) => setValue(key, v)}
                      placeholder="e.g. 24"
                      hint="hours"
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="sla-actions">
            {saved && <span className="sla-saved">Saved.</span>}
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save SLA Settings'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default SlaSettings;
