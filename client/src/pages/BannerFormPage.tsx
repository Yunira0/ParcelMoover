import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ImagePlus, X } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import ToggleSwitch from '../components/ToggleSwitch';
import {
  bannerImageUrl,
  createBanner,
  getBanner,
  updateBanner,
  type BannerDisplayType,
} from '../services/banners.service';
import './BannerFormPage.css';

interface BannerFormState {
  name: string;
  displayType: BannerDisplayType;
  linkUrl: string;
  isEnabled: boolean;
  startsAt: string;
  endsAt: string;
  sortOrder: string;
}

const emptyForm: BannerFormState = {
  name: '',
  displayType: 'permanent',
  linkUrl: '',
  isEnabled: true,
  startsAt: '',
  endsAt: '',
  sortOrder: '0',
};

// Day-granularity scheduling: a start date takes effect at the start of that
// day, an end date holds through the end of it — so "ends today" still shows
// today instead of expiring at the first instant of the day.
const toStartOfDayIso = (adDay: string) => (adDay ? `${adDay}T00:00:00` : null);
const toEndOfDayIso = (adDay: string) => (adDay ? `${adDay}T23:59:59` : null);

const BannerFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const isEdit = !!editId;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<BannerFormState>(emptyForm);
  const [image, setImage] = useState<File | null>(null);
  const [existingImage, setExistingImage] = useState<{ id: string; path: string } | null>(null);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isEdit || !editId) return;
    getBanner(editId)
      .then((banner) => {
        setForm({
          name: banner.name,
          displayType: banner.displayType,
          linkUrl: banner.linkUrl ?? '',
          isEnabled: banner.isEnabled,
          startsAt: banner.startsAt ? banner.startsAt.slice(0, 10) : '',
          endsAt: banner.endsAt ? banner.endsAt.slice(0, 10) : '',
          sortOrder: String(banner.sortOrder),
        });
        setExistingImage({ id: banner.id, path: banner.imagePath });
      })
      .catch(() => setError('Failed to load that banner.'))
      .finally(() => setLoading(false));
  }, [isEdit, editId]);

  const set = <K extends keyof BannerFormState>(key: K, value: BannerFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const previewUrl = image
    ? URL.createObjectURL(image)
    : existingImage
      ? bannerImageUrl(existingImage.id, existingImage.path)
      : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim()) {
      setError('A banner name is required.');
      return;
    }
    if (!isEdit && !image) {
      setError('A banner image is required.');
      return;
    }
    if (form.startsAt && form.endsAt && form.startsAt > form.endsAt) {
      setError('End date must be on or after the start date.');
      return;
    }

    setSaving(true);
    try {
      const input = {
        name: form.name.trim(),
        linkUrl: form.linkUrl.trim() || null,
        displayType: form.displayType,
        isEnabled: form.isEnabled,
        startsAt: toStartOfDayIso(form.startsAt),
        endsAt: toEndOfDayIso(form.endsAt),
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (isEdit && editId) {
        await updateBanner(editId, input, image);
      } else {
        await createBanner(input, image!);
      }
      navigate('/banners');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to save that banner.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bfp-page">
        <p className="bfp-muted">Loading banner…</p>
      </div>
    );
  }

  return (
    <div className="bfp-page">
      <button type="button" className="bfp-back" onClick={() => navigate('/banners')}>
        <ArrowLeft size={16} /> Back to Banner Management
      </button>

      <div className="bfp-header">
        <h1>{isEdit ? 'Edit Banner' : 'New Banner'}</h1>
        <p>An admin-only label plus the image vendors will see — the image carries the message.</p>
      </div>

      <form className="bfp-form" onSubmit={handleSubmit} noValidate>
        <section className="bfp-section">
          <div className="bfp-image-field">
            {previewUrl ? (
              <div className="bfp-image-preview-wrap">
                <img src={previewUrl} alt="Banner preview" className="bfp-image-preview" />
                <button
                  type="button"
                  className="bfp-image-replace"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Replace image
                </button>
              </div>
            ) : (
              <button type="button" className="bfp-image-dropzone" onClick={() => fileInputRef.current?.click()}>
                <ImagePlus size={22} />
                <span>Upload banner image</span>
                <small>JPG, PNG, or WebP · max 5 MB · wide creatives (~1600×270) read best</small>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            />
          </div>
        </section>

        <section className="bfp-section">
          <div className="bfp-fields">
            <FormField
              label="Name"
              required
              value={form.name}
              onChange={(v) => set('name', v)}
              placeholder="e.g. Dashain delivery cutoff notice"
              hint="Admin-only label to identify this banner in the list — vendors never see it."
            />

            <div className="form-grid">
              <FormField
                label="Display type"
                type="select"
                value={form.displayType}
                onChange={(v) => set('displayType', v as BannerDisplayType)}
                options={[
                  { value: 'permanent', label: 'Permanent — stays on the dashboard' },
                  { value: 'modal', label: 'Modal — pops up once, then dismissed' },
                ]}
              />
              <FormField
                label="Link URL"
                value={form.linkUrl}
                onChange={(v) => set('linkUrl', v)}
                placeholder="https://... (optional)"
                hint="Vendors are taken here if they click the banner."
              />
            </div>

            <div className="form-grid">
              <FormField
                label="Starts"
                type="date"
                value={form.startsAt}
                onChange={(v) => set('startsAt', v)}
                placeholder="Immediately"
              />
              <FormField
                label="Ends"
                type="date"
                value={form.endsAt}
                onChange={(v) => set('endsAt', v)}
                placeholder="No end date"
              />
            </div>

            <div className="form-grid">
              <FormField
                label="Priority"
                type="number"
                value={form.sortOrder}
                onChange={(v) => set('sortOrder', v)}
                hint="Lower shows first if more than one banner is live at once."
              />
              <div className="form-group">
                <label>Enabled</label>
                <div className="bfp-toggle-row">
                  <ToggleSwitch checked={form.isEnabled} onChange={(v) => set('isEnabled', v)} ariaLabel="Banner enabled" />
                  <span className="bfp-toggle-label">
                    {form.isEnabled ? 'Live within its date window' : 'Draft — hidden from vendors'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <p className="bfp-error" role="alert">
            <X size={14} /> {error}
          </p>
        )}

        <div className="bfp-actions">
          <Button type="button" variant="secondary" onClick={() => navigate('/banners')}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Banner'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default BannerFormPage;
