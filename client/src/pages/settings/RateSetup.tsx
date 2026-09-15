import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Button from '../../components/Button';
import { apiErrorMessage } from '../../utils/serverValidation';
import {
  getPricingSettings,
  updatePricingSettings,
  type PricingSettings,
} from '../../services/pricing.service';
import './RateSetup.css';

const RateSetup: React.FC = () => {
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const setRes = await getPricingSettings();
      if (setRes?.success) setSettings(setRes.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const setSetting = (key: keyof PricingSettings, value: string) =>
    setSettings((prev) => (prev ? { ...prev, [key]: value === '' ? null : Number(value) } : prev));

  const saveSettings = async () => {
    if (!settings) return;
    setSavingSettings(true);
    setMsg('');
    try {
      await updatePricingSettings({
        zoneMajorCities: settings.zoneMajorCities,
        zoneUrbanAreas: settings.zoneUrbanAreas,
        zoneRemoteAreas: settings.zoneRemoteAreas,
        zoneInsideValley: settings.zoneInsideValley,
        flatInsideValley: settings.flatInsideValley,
        flatOutsideValley: settings.flatOutsideValley,
        flatOutsideRingRoad: settings.flatOutsideRingRoad,
        extraWeightPercent: settings.extraWeightPercent,
        freeWeightKg: settings.freeWeightKg,
        returnInsideValleyPercent: settings.returnInsideValleyPercent,
        returnOutsideValleyPercent: settings.returnOutsideValleyPercent,
        branchReturnInsideValleyPercent: settings.branchReturnInsideValleyPercent,
        branchReturnOutsideValleyPercent: settings.branchReturnOutsideValleyPercent,
        branchZoneMajorCities: settings.branchZoneMajorCities,
        branchZoneUrbanAreas: settings.branchZoneUrbanAreas,
        branchZoneRemoteAreas: settings.branchZoneRemoteAreas,
        branchZoneInsideValley: settings.branchZoneInsideValley,
        branchFlatInsideValley: settings.branchFlatInsideValley,
        branchFlatOutsideValley: settings.branchFlatOutsideValley,
        branchFlatOutsideRingRoad: settings.branchFlatOutsideRingRoad,
      });
      setMsg('Rates saved.');
      setTimeout(() => setMsg(''), 2000);
    } catch (err) {
      setMsg(apiErrorMessage(err, 'Failed to save rates.'));
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading || !settings) return <p className="rate-muted">Loading rate setup…</p>;

  return (
    <div className="rate-setup">
      {/* Per-destination rates moved to the Rates tab, where they read as one
          origin (head office) among all of them. */}
      <section className="rate-card rate-card--link">
        <div>
          <h3>Per-destination rates &amp; classification</h3>
          <p className="rate-muted">
            Each destination’s own rate, zone and valley side now live on the Rates tab — pick
            the head-office origin there to edit them.
          </p>
        </div>
        <Link to="/settings?tab=rates" className="rate-link-btn">
          Open Rates <ArrowRight size={15} />
        </Link>
      </section>

      {/* ── Zone-based & Flat global rates ─────────────────────────────── */}
      <section className="rate-card">
        <h3>Zone rates</h3>
        <p className="rate-muted">A vendor on the “Zone” model is charged by the destination’s zone.</p>
        <div className="rate-grid">
          <label>Major cities (Rs.)
            <input type="number" min={0} value={settings.zoneMajorCities ?? ''}
              onChange={(e) => setSetting('zoneMajorCities', e.target.value)} />
          </label>
          <label>Urban areas (Rs.)
            <input type="number" min={0} value={settings.zoneUrbanAreas ?? ''}
              onChange={(e) => setSetting('zoneUrbanAreas', e.target.value)} />
          </label>
          <label>Remote areas (Rs.)
            <input type="number" min={0} value={settings.zoneRemoteAreas ?? ''}
              onChange={(e) => setSetting('zoneRemoteAreas', e.target.value)} />
          </label>
          <label>Inside valley (Rs.)
            <input type="number" min={0} value={settings.zoneInsideValley ?? ''}
              onChange={(e) => setSetting('zoneInsideValley', e.target.value)} />
          </label>
        </div>

        <h3>Flat rates</h3>
        <p className="rate-muted">
          A vendor on the “Flat” model is charged inside- or outside-valley. Inside-valley
          destinations flagged “outside ring road” below are charged the ring-road rate instead,
          when set.
        </p>
        <div className="rate-grid">
          <label>Inside valley (Rs.)
            <input type="number" min={0} value={settings.flatInsideValley ?? ''}
              onChange={(e) => setSetting('flatInsideValley', e.target.value)} />
          </label>
          <label>Outside valley (Rs.)
            <input type="number" min={0} value={settings.flatOutsideValley ?? ''}
              onChange={(e) => setSetting('flatOutsideValley', e.target.value)} />
          </label>
          <label>Outside ring road (Rs.)
            <input type="number" min={0} value={settings.flatOutsideRingRoad ?? ''}
              onChange={(e) => setSetting('flatOutsideRingRoad', e.target.value)} />
          </label>
          <label>Free weight (kg)
            <input type="number" min={0} step="0.1" value={settings.freeWeightKg ?? ''}
              onChange={(e) => setSetting('freeWeightKg', e.target.value)} />
          </label>
          <label>Extra weight surcharge (%)
            <input type="number" min={0} max={100} step="0.1" value={settings.extraWeightPercent ?? ''}
              onChange={(e) => setSetting('extraWeightPercent', e.target.value)} />
          </label>
        </div>

        <h3>Return rates</h3>
        <p className="rate-muted">
          A return parcel carries no COD but is billed this percent of the normal delivery rate,
          by the destination’s valley side. Vendors can override these on their profile.
        </p>
        <div className="rate-grid">
          <label>Inside valley (% of delivery)
            <input type="number" min={0} max={100} step="0.1" value={settings.returnInsideValleyPercent ?? ''}
              onChange={(e) => setSetting('returnInsideValleyPercent', e.target.value)} />
          </label>
          <label>Outside valley (% of delivery)
            <input type="number" min={0} max={100} step="0.1" value={settings.returnOutsideValleyPercent ?? ''}
              onChange={(e) => setSetting('returnOutsideValleyPercent', e.target.value)} />
          </label>
          <label>Branch — inside branch area (%)
            <input type="number" min={0} max={100} step="0.1" value={settings.branchReturnInsideValleyPercent ?? ''}
              onChange={(e) => setSetting('branchReturnInsideValleyPercent', e.target.value)} />
          </label>
          <label>Branch — outside branch area (%)
            <input type="number" min={0} max={100} step="0.1" value={settings.branchReturnOutsideValleyPercent ?? ''}
              onChange={(e) => setSetting('branchReturnOutsideValleyPercent', e.target.value)} />
          </label>
        </div>

        <h3>Branch delivery rates</h3>
        <p className="rate-muted">
          Charges for branch delivery (parcel dropped at a branch, not the customer’s door).
          Leave blank to fall back to the matching home-delivery rate.
        </p>
        <div className="rate-grid">
          <label>Branch — major cities (Rs.)
            <input type="number" min={0} value={settings.branchZoneMajorCities ?? ''}
              onChange={(e) => setSetting('branchZoneMajorCities', e.target.value)} />
          </label>
          <label>Branch — urban areas (Rs.)
            <input type="number" min={0} value={settings.branchZoneUrbanAreas ?? ''}
              onChange={(e) => setSetting('branchZoneUrbanAreas', e.target.value)} />
          </label>
          <label>Branch — remote areas (Rs.)
            <input type="number" min={0} value={settings.branchZoneRemoteAreas ?? ''}
              onChange={(e) => setSetting('branchZoneRemoteAreas', e.target.value)} />
          </label>
          <label>Branch — zone inside valley (Rs.)
            <input type="number" min={0} value={settings.branchZoneInsideValley ?? ''}
              onChange={(e) => setSetting('branchZoneInsideValley', e.target.value)} />
          </label>
          <label>Branch — flat inside branch area (Rs.)
            <input type="number" min={0} value={settings.branchFlatInsideValley ?? ''}
              onChange={(e) => setSetting('branchFlatInsideValley', e.target.value)} />
          </label>
          <label>Branch — flat outside branch area (Rs.)
            <input type="number" min={0} value={settings.branchFlatOutsideValley ?? ''}
              onChange={(e) => setSetting('branchFlatOutsideValley', e.target.value)} />
          </label>
        </div>

        <div className="rate-actions">
          <Button variant="primary" onClick={saveSettings} disabled={savingSettings}>
            {savingSettings ? 'Saving…' : 'Save Rates'}
          </Button>
        </div>
      </section>


      {msg && <p className="rate-msg">{msg}</p>}
    </div>
  );
};

export default RateSetup;
