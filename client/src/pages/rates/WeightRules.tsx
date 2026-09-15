import React, { useEffect, useState } from 'react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import { getPricingSettings, updatePricingSettings } from '../../services/pricing.service';
import { apiErrorMessage } from '../../utils/serverValidation';

interface Props {
  /** Saving these is super-admin only on the server. */
  canEdit: boolean;
}

// The two network-wide weight rules every vendor quote uses: parcels up to the
// free weight pay the base rate, each kg beyond it adds this percent of the
// base. A vendor's own extra-weight % overrides the percent; free weight has
// no per-vendor override. Branch route rates carry their own pair per route.
const WeightRules: React.FC<Props> = ({ canEdit }) => {
  const [saved, setSaved] = useState({ freeWeightKg: '', extraWeightPercent: '' });
  const [draft, setDraft] = useState({ freeWeightKg: '', extraWeightPercent: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getPricingSettings()
      .then((res) => {
        if (!res?.success) return;
        const next = {
          freeWeightKg: res.data.freeWeightKg == null ? '' : String(res.data.freeWeightKg),
          extraWeightPercent: res.data.extraWeightPercent == null ? '' : String(res.data.extraWeightPercent),
        };
        setSaved(next);
        setDraft(next);
      })
      .catch(() => setMsg('Couldn’t load weight rules.'));
  }, []);

  const dirty = draft.freeWeightKg !== saved.freeWeightKg || draft.extraWeightPercent !== saved.extraWeightPercent;

  const save = async () => {
    setSaving(true);
    setMsg('');
    try {
      await updatePricingSettings({
        // Free weight is required on the server, so a blank field leaves it unchanged.
        freeWeightKg: draft.freeWeightKg === '' ? undefined : Number(draft.freeWeightKg),
        extraWeightPercent: draft.extraWeightPercent === '' ? null : Number(draft.extraWeightPercent),
      });
      setSaved(draft);
      setMsg('Saved.');
      setTimeout(() => setMsg(''), 2000);
    } catch (err) {
      setMsg(apiErrorMessage(err, 'Failed to save weight rules.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <FormField
        label="Free weight (kg)"
        type="decimal"
        value={draft.freeWeightKg}
        onChange={(v) => setDraft((d) => ({ ...d, freeWeightKg: v }))}
        placeholder="e.g. 2"
        disabled={!canEdit || saving}
      />
      <FormField
        label="Extra weight surcharge (%)"
        type="decimal"
        value={draft.extraWeightPercent}
        onChange={(v) => setDraft((d) => ({ ...d, extraWeightPercent: v }))}
        placeholder="e.g. 50"
        disabled={!canEdit || saving}
      />
      {canEdit && (
        <Button variant="outline" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      )}
      {msg && <span className="rates-panel-status" role="status">{msg}</span>}
    </>
  );
};

export default WeightRules;
