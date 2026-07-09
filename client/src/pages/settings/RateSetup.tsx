import React, { useEffect, useState } from 'react';
import Button from '../../components/Button';
import {
  listManagedLocations,
  updateLocation,
  type Destination,
} from '../../services/locations.service';
import {
  getPricingSettings,
  updatePricingSettings,
  type PricingSettings,
} from '../../services/pricing.service';
import './RateSetup.css';

const ZONE_OPTIONS = [
  { value: '', label: '—' },
  { value: 'major_cities', label: 'Major cities' },
  { value: 'urban_areas', label: 'Urban areas' },
  { value: 'remote_areas', label: 'Remote areas' },
];

const VALLEY_OPTIONS = [
  { value: '', label: '—' },
  { value: 'inside', label: 'Inside valley' },
  { value: 'outside', label: 'Outside valley' },
];

type RowEdit = { rate: string; zone: string; valley: string };

const RateSetup: React.FC = () => {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [rows, setRows] = useState<Record<string, RowEdit>>({});
  const [loading, setLoading] = useState(true);
  const [savingRow, setSavingRow] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [locRes, setRes] = await Promise.all([listManagedLocations(), getPricingSettings()]);
      if (locRes?.success) {
        setDestinations(locRes.data);
        const initial: Record<string, RowEdit> = {};
        locRes.data.forEach((d) => {
          initial[d.id] = {
            rate: d.perDestinationRate != null ? String(d.perDestinationRate) : '',
            zone: d.zone || '',
            valley: d.valley || '',
          };
        });
        setRows(initial);
      }
      if (setRes?.success) setSettings(setRes.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const setRow = (id: string, patch: Partial<RowEdit>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const saveRow = async (id: string) => {
    const row = rows[id];
    setSavingRow(id);
    setMsg('');
    try {
      await updateLocation(id, {
        perDestinationRate: row.rate.trim() === '' ? null : Number(row.rate),
        zone: row.zone || null,
        valley: row.valley || null,
      });
      setMsg('Saved.');
      setTimeout(() => setMsg(''), 2000);
    } catch (err: any) {
      setMsg(err.response?.data?.message || 'Failed to save row.');
    } finally {
      setSavingRow(null);
    }
  };

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
        flatInsideValley: settings.flatInsideValley,
        flatOutsideValley: settings.flatOutsideValley,
        extraWeightPercent: settings.extraWeightPercent,
        freeWeightKg: settings.freeWeightKg,
      });
      setMsg('Rates saved.');
      setTimeout(() => setMsg(''), 2000);
    } catch (err: any) {
      setMsg(err.response?.data?.message || 'Failed to save rates.');
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading || !settings) return <p className="rate-muted">Loading rate setup…</p>;

  return (
    <div className="rate-setup">
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
        </div>

        <h3>Flat rates</h3>
        <p className="rate-muted">A vendor on the “Flat” model is charged inside- or outside-valley.</p>
        <div className="rate-grid">
          <label>Inside valley (Rs.)
            <input type="number" min={0} value={settings.flatInsideValley ?? ''}
              onChange={(e) => setSetting('flatInsideValley', e.target.value)} />
          </label>
          <label>Outside valley (Rs.)
            <input type="number" min={0} value={settings.flatOutsideValley ?? ''}
              onChange={(e) => setSetting('flatOutsideValley', e.target.value)} />
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

        <div className="rate-actions">
          <Button variant="primary" onClick={saveSettings} disabled={savingSettings}>
            {savingSettings ? 'Saving…' : 'Save Rates'}
          </Button>
        </div>
      </section>

      {/* ── Per-destination rate + zone/valley classification ──────────── */}
      <section className="rate-card">
        <h3>Per-destination rates &amp; classification</h3>
        <p className="rate-muted">
          Set each destination’s own rate (for the “Per-destination” model), and assign its zone and
          valley side (used by the zone and flat models).
        </p>
        {destinations.length === 0 ? (
          <p className="rate-muted">No destinations yet. Add them in the “Destinations &amp; Areas” tab first.</p>
        ) : (
          <div className="rate-table-wrap">
            <table className="rate-table">
              <thead>
                <tr>
                  <th>Destination</th>
                  <th>Per-destination rate (Rs.)</th>
                  <th>Zone</th>
                  <th>Valley</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {destinations.map((d) => {
                  const row = rows[d.id];
                  if (!row) return null;
                  return (
                    <tr key={d.id}>
                      <td>{d.name}{d.code ? ` (${d.code})` : ''}</td>
                      <td>
                        <input type="number" min={0} value={row.rate}
                          onChange={(e) => setRow(d.id, { rate: e.target.value })} placeholder="e.g. 155" />
                      </td>
                      <td>
                        <select value={row.zone} onChange={(e) => setRow(d.id, { zone: e.target.value })}>
                          {ZONE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <select value={row.valley} onChange={(e) => setRow(d.id, { valley: e.target.value })}>
                          {VALLEY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <Button variant="outline" size="sm" disabled={savingRow === d.id} onClick={() => saveRow(d.id)}>
                          {savingRow === d.id ? 'Saving…' : 'Save'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {msg && <p className="rate-msg">{msg}</p>}
    </div>
  );
};

export default RateSetup;
