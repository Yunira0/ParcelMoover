import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Ruler } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Button from '../../components/Button';
import {
  getMyLabelSize,
  updateMyLabelSize,
  type LabelSize,
} from '../../services/vendorPrintSettings.service';
import { apiErrorMessage } from '../../utils/serverValidation';
import './VendorPrintSettings.css';

const DEFAULT_WIDTH_MM = 100;
const DEFAULT_HEIGHT_MM = 75;
const MIN_MM = 20;
const MAX_MM = 300;
const MM_PER_INCH = 25.4;

type PresetKey = 'default' | '100x150' | '75x50' | '50x25' | 'custom';

const PRESETS: { key: PresetKey; label: string; sub: string; widthMm: number | null; heightMm: number | null }[] = [
  { key: 'default', label: 'Default', sub: `${DEFAULT_WIDTH_MM} x ${DEFAULT_HEIGHT_MM}mm`, widthMm: null, heightMm: null },
  { key: '100x150', label: '4x6in', sub: '100 x 150mm', widthMm: 100, heightMm: 150 },
  { key: '75x50', label: '3x2in', sub: '75 x 50mm', widthMm: 75, heightMm: 50 },
  { key: '50x25', label: '2x1in', sub: '50 x 25mm', widthMm: 50, heightMm: 25 },
  { key: 'custom', label: 'Custom', sub: 'Enter your own', widthMm: null, heightMm: null },
];

// Which fixed preset (if any) a raw {widthMm, heightMm} override matches -
// falls back to 'custom' for anything else, 'default' for a null override.
function presetForSize(size: LabelSize): PresetKey {
  if (size.widthMm === null && size.heightMm === null) return 'default';
  const match = PRESETS.find(
    (p) => p.key !== 'default' && p.key !== 'custom' && p.widthMm === size.widthMm && p.heightMm === size.heightMm,
  );
  return match?.key ?? 'custom';
}

const mmToIn = (mm: number) => (mm / MM_PER_INCH).toFixed(1);

// Scales a widthMm x heightMm rectangle to fit inside a maxW x maxH pixel
// box, preserving aspect ratio - the tile swatches and the preview box both
// need to render correctly whether the label is landscape (e.g. 50x25) or
// portrait (e.g. 100x150), which a plain CSS aspect-ratio can't do once it's
// also bounded by a max-width AND max-height at the same time.
function fitBox(widthMm: number, heightMm: number, maxW: number, maxH: number) {
  const scale = Math.min(maxW / widthMm, maxH / heightMm);
  return { width: Math.round(widthMm * scale), height: Math.round(heightMm * scale) };
}

const VendorPrintSettings: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<LabelSize>({ widthMm: null, heightMm: null });

  const [preset, setPreset] = useState<PresetKey>('default');
  const [customWidth, setCustomWidth] = useState('');
  const [customHeight, setCustomHeight] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMyLabelSize();
      setSaved(data);
      const key = presetForSize(data);
      setPreset(key);
      if (key === 'custom') {
        setCustomWidth(String(data.widthMm ?? ''));
        setCustomHeight(String(data.heightMm ?? ''));
      }
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to load your print settings.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The size implied by what's currently selected, used to drive both the
  // live preview and the Save button - independent of whether it's been
  // saved yet.
  const displaySize: LabelSize =
    preset === 'default'
      ? { widthMm: DEFAULT_WIDTH_MM, heightMm: DEFAULT_HEIGHT_MM }
      : preset === 'custom'
        ? { widthMm: Number(customWidth) || null, heightMm: Number(customHeight) || null }
        : (() => {
            const p = PRESETS.find((x) => x.key === preset)!;
            return { widthMm: p.widthMm, heightMm: p.heightMm };
          })();

  const isDisplaySizeValid =
    displaySize.widthMm !== null &&
    displaySize.heightMm !== null &&
    Number.isInteger(displaySize.widthMm) &&
    Number.isInteger(displaySize.heightMm) &&
    displaySize.widthMm >= MIN_MM &&
    displaySize.widthMm <= MAX_MM &&
    displaySize.heightMm >= MIN_MM &&
    displaySize.heightMm <= MAX_MM;

  // What would actually be submitted: the preset's raw override (null for
  // "default"), or the validated custom value.
  const pendingSize: LabelSize | null = !isDisplaySizeValid
    ? null
    : preset === 'default'
      ? { widthMm: null, heightMm: null }
      : { widthMm: displaySize.widthMm, heightMm: displaySize.heightMm };

  const isUnchanged =
    pendingSize !== null && pendingSize.widthMm === saved.widthMm && pendingSize.heightMm === saved.heightMm;

  const handleSave = async () => {
    if (!pendingSize) return;
    setSaving(true);
    setSaveError('');
    setSaveMessage('');
    try {
      const updated = await updateMyLabelSize(pendingSize);
      setSaved(updated);
      setSaveMessage('Saved. New labels will print at this size.');
    } catch (err) {
      setSaveError(apiErrorMessage(err, 'Failed to save print settings.'));
    } finally {
      setSaving(false);
    }
  };

  const currentLabel =
    saved.widthMm === null
      ? `Using the default (${DEFAULT_WIDTH_MM} x ${DEFAULT_HEIGHT_MM}mm)`
      : `${saved.widthMm} x ${saved.heightMm}mm`;

  return (
    <div className="print-settings-page">
      <PageHeader
        title="Print Settings"
        subtitle="Set your sticker size so shipping labels print correctly on your printer."
      />

      {loading ? (
        <div className="loading-state">Loading print settings...</div>
      ) : error ? (
        <p className="print-settings-error">{error}</p>
      ) : (
        <div className="print-settings-grid">
          <section className="print-settings-card">
            <h3>Sticker size</h3>
            <p className="print-settings-hint">
              Match this to the label stock loaded in your printer. Currently: <strong>{currentLabel}</strong>.
            </p>

            <div className="print-settings-tiles" role="radiogroup" aria-label="Label size">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="radio"
                  aria-checked={preset === p.key}
                  className={`print-settings-tile${preset === p.key ? ' print-settings-tile-active' : ''}`}
                  onClick={() => setPreset(p.key)}
                  disabled={saving}
                >
                  <span className="print-settings-tile-visual">
                    {p.key === 'custom' ? (
                      <Ruler size={20} className="print-settings-tile-icon" />
                    ) : (
                      <span
                        className="print-settings-tile-swatch"
                        style={fitBox(p.widthMm ?? DEFAULT_WIDTH_MM, p.heightMm ?? DEFAULT_HEIGHT_MM, 48, 36)}
                      />
                    )}
                  </span>
                  <span className="print-settings-tile-label">{p.label}</span>
                  <span className="print-settings-tile-sub">{p.sub}</span>
                </button>
              ))}
            </div>

            {preset === 'custom' && (
              <div className="print-settings-custom">
                <label className="print-settings-field">
                  Width (mm)
                  <input
                    type="number"
                    min={MIN_MM}
                    max={MAX_MM}
                    value={customWidth}
                    onChange={(e) => setCustomWidth(e.target.value)}
                    disabled={saving}
                  />
                </label>
                <label className="print-settings-field">
                  Height (mm)
                  <input
                    type="number"
                    min={MIN_MM}
                    max={MAX_MM}
                    value={customHeight}
                    onChange={(e) => setCustomHeight(e.target.value)}
                    disabled={saving}
                  />
                </label>
              </div>
            )}

            {preset === 'custom' && !isDisplaySizeValid && (customWidth || customHeight) && (
              <p className="print-settings-error">
                Enter whole numbers between {MIN_MM} and {MAX_MM}mm for both width and height.
              </p>
            )}
            {saveError && <p className="print-settings-error">{saveError}</p>}
            {saveMessage && (
              <p className="print-settings-success">
                <CheckCircle2 size={14} /> {saveMessage}
              </p>
            )}

            <Button variant="primary" onClick={handleSave} disabled={saving || !pendingSize || isUnchanged}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </section>

          <section className="print-settings-card print-settings-preview">
            <h3>Preview</h3>
            <p className="print-settings-hint">
              Roughly to scale — this is the boundary every shipping label prints inside.
            </p>
            <div className="print-settings-preview-stage">
              {isDisplaySizeValid ? (
                <div
                  className="print-settings-preview-box"
                  style={fitBox(displaySize.widthMm!, displaySize.heightMm!, 220, 180)}
                >
                  <Ruler size={16} className="print-settings-preview-icon" />
                </div>
              ) : (
                <p className="print-settings-hint">Enter a valid width and height to preview.</p>
              )}
            </div>
            {isDisplaySizeValid && (
              <p className="print-settings-preview-dims">
                {displaySize.widthMm} x {displaySize.heightMm}mm
                <span className="print-settings-preview-in">
                  ({mmToIn(displaySize.widthMm!)}in x {mmToIn(displaySize.heightMm!)}in)
                </span>
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

export default VendorPrintSettings;
