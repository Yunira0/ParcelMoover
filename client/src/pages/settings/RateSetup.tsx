import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, Trash2 } from 'lucide-react';
import Button from '../../components/Button';
import Pagination from '../../components/Pagination';
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
  { value: 'inside_valley', label: 'Inside valley' },
];

// A single control for the combined valley + ring-road classification, so the
// table doesn't need a second, sometimes-disabled column for a flag that only
// ever means something alongside "inside valley". "inside_outside_ring" is a
// UI-only value: it writes valley="inside" + ringRoad="outside" together.
const VALLEY_RING_ROAD_OPTIONS = [
  { value: '', label: '—' },
  { value: 'inside', label: 'Inside valley' },
  { value: 'inside_outside_ring', label: 'Inside valley — outside ring road' },
  { value: 'outside', label: 'Outside valley' },
];

type RowEdit = { rate: string; branchRate: string; zone: string; valley: string; ringRoad: string };

// Maps a row's stored valley/ringRoad pair to the single merged select value above.
function toValleyRingRoadValue(row: RowEdit): string {
  if (row.valley === 'inside' && row.ringRoad === 'outside') return 'inside_outside_ring';
  return row.valley;
}

const PAGE_SIZE = 10;

const RateSetup: React.FC = () => {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [rows, setRows] = useState<Record<string, RowEdit>>({});
  const [loading, setLoading] = useState(true);
  const [savingRow, setSavingRow] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [msg, setMsg] = useState('');
  const [page, setPage] = useState(1);
  const [pageSizeChoice, setPageSizeChoice] = useState(PAGE_SIZE);
  const [searchQuery, setSearchQuery] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [locRes, setRes] = await Promise.all([listManagedLocations(), getPricingSettings()]);
      if (locRes?.success) {
        // The endpoint returns newest-first (for the Destinations tab); the
        // rates table reads better alphabetically.
        setDestinations([...locRes.data].sort((a, b) => a.name.localeCompare(b.name)));
        const initial: Record<string, RowEdit> = {};
        locRes.data.forEach((d) => {
          initial[d.id] = {
            rate: d.perDestinationRate != null ? String(d.perDestinationRate) : '',
            branchRate: d.branchPerDestinationRate != null ? String(d.branchPerDestinationRate) : '',
            zone: d.zone || '',
            valley: d.valley || '',
            ringRoad: d.ringRoad || '',
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

  const filteredDestinations = useMemo(() => {
    if (!searchQuery.trim()) return destinations;
    const q = searchQuery.toLowerCase();
    return destinations.filter(
      (d) => d.name.toLowerCase().includes(q) || (d.code && d.code.toLowerCase().includes(q)),
    );
  }, [destinations, searchQuery]);

  useEffect(() => { setPage(1); }, [searchQuery]);

  const setRow = (id: string, patch: Partial<RowEdit>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const saveRow = async (id: string) => {
    const row = rows[id];
    setSavingRow(id);
    setMsg('');
    try {
      await updateLocation(id, {
        perDestinationRate: row.rate.trim() === '' ? null : Number(row.rate),
        branchPerDestinationRate: row.branchRate.trim() === '' ? null : Number(row.branchRate),
        zone: row.zone || null,
        valley: row.valley || null,
        ringRoad: row.ringRoad || null,
      });
      setMsg('Saved.');
      setTimeout(() => setMsg(''), 2000);
    } catch (err: any) {
      setMsg(err.response?.data?.message || 'Failed to save row.');
    } finally {
      setSavingRow(null);
    }
  };

  // Wipes the per-destination and branch rates for one row in a single click,
  // instead of manually blanking both inputs and hitting Save. Sends the nulls
  // directly rather than going through local row state, so it can't race a
  // pending edit the way reading rows[id] right after a setRow call would.
  const clearRow = async (id: string) => {
    setSavingRow(id);
    setMsg('');
    try {
      await updateLocation(id, { perDestinationRate: null, branchPerDestinationRate: null });
      setRow(id, { rate: '', branchRate: '' });
      setMsg('Cleared.');
      setTimeout(() => setMsg(''), 2000);
    } catch (err: any) {
      setMsg(err.response?.data?.message || 'Failed to clear rates.');
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
        zoneInsideValley: settings.zoneInsideValley,
        flatInsideValley: settings.flatInsideValley,
        flatOutsideValley: settings.flatOutsideValley,
        flatOutsideRingRoad: settings.flatOutsideRingRoad,
        extraWeightPercent: settings.extraWeightPercent,
        freeWeightKg: settings.freeWeightKg,
        returnInsideValleyPercent: settings.returnInsideValleyPercent,
        returnOutsideValleyPercent: settings.returnOutsideValleyPercent,
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
    } catch (err: any) {
      setMsg(err.response?.data?.message || 'Failed to save rates.');
    } finally {
      setSavingSettings(false);
    }
  };

  if (loading || !settings) return <p className="rate-muted">Loading rate setup…</p>;

  const totalPages = Math.max(1, Math.ceil(filteredDestinations.length / pageSizeChoice));
  const currentPage = Math.min(page, totalPages);
  const pagedDestinations = filteredDestinations.slice(
    (currentPage - 1) * pageSizeChoice,
    currentPage * pageSizeChoice,
  );

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
          <label>Branch — flat inside valley (Rs.)
            <input type="number" min={0} value={settings.branchFlatInsideValley ?? ''}
              onChange={(e) => setSetting('branchFlatInsideValley', e.target.value)} />
          </label>
          <label>Branch — flat outside valley (Rs.)
            <input type="number" min={0} value={settings.branchFlatOutsideValley ?? ''}
              onChange={(e) => setSetting('branchFlatOutsideValley', e.target.value)} />
          </label>
          <label>Branch — outside ring road (Rs.)
            <input type="number" min={0} value={settings.branchFlatOutsideRingRoad ?? ''}
              onChange={(e) => setSetting('branchFlatOutsideRingRoad', e.target.value)} />
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
          valley side (used by the zone and flat models), plus whether an inside-valley destination
          sits outside the ring road.
        </p>
        {destinations.length === 0 ? (
          <p className="rate-muted">No destinations yet. Add them in the “Destinations &amp; Areas” tab first.</p>
        ) : (
          <>
            <div className="rate-search">
              <Search size={15} className="rate-search-icon" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search destinations or codes…"
                className="rate-search-input"
              />
              {searchQuery && (
                <button type="button" className="rate-search-clear" onClick={() => setSearchQuery('')}>
                  <X size={14} />
                </button>
              )}
            </div>
            {filteredDestinations.length === 0 ? (
              <p className="rate-muted">No destinations match “{searchQuery}”.</p>
            ) : (
          <div className="rate-table-wrap">
            <table className="rate-table">
              <thead>
                <tr>
                  <th>Destination</th>
                  <th>Per-destination rate (Rs.)</th>
                  <th>Branch rate (Rs.)</th>
                  <th>Zone</th>
                  <th>Valley</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pagedDestinations.map((d) => {
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
                        <input type="number" min={0} value={row.branchRate}
                          onChange={(e) => setRow(d.id, { branchRate: e.target.value })} placeholder="e.g. 100" />
                      </td>
                      <td>
                        <select value={row.zone} onChange={(e) => setRow(d.id, { zone: e.target.value })}>
                          {ZONE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td>
                        <select
                          value={toValleyRingRoadValue(row)}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRow(
                              d.id,
                              v === 'inside_outside_ring'
                                ? { valley: 'inside', ringRoad: 'outside' }
                                : { valley: v, ringRoad: '' },
                            );
                          }}
                        >
                          {VALLEY_RING_ROAD_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td className="rate-table-actions">
                        <Button variant="outline" size="sm" disabled={savingRow === d.id} onClick={() => saveRow(d.id)}>
                          {savingRow === d.id ? 'Saving…' : 'Save'}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={savingRow === d.id || (!row.rate && !row.branchRate)}
                          onClick={() => clearRow(d.id)}
                          title="Clear this destination's per-destination and branch rates"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
            )}
          </>
        )}
        {filteredDestinations.length > 0 && (
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setPage}
            ariaLabel="Destination rates pages"
            pageSize={pageSizeChoice}
            pageSizeLabel="destinations"
            onPageSizeChange={(size) => {
              setPageSizeChoice(size);
              setPage(1);
            }}
            summary={`Showing ${(currentPage - 1) * pageSizeChoice + 1}–${Math.min(currentPage * pageSizeChoice, filteredDestinations.length)} of ${filteredDestinations.length} destinations`}
          />
        )}
      </section>

      {msg && <p className="rate-msg">{msg}</p>}
    </div>
  );
};

export default RateSetup;
