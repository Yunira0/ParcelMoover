import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, X } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import ToggleSwitch from '../components/ToggleSwitch';
import {
  createAnnouncement,
  getAnnouncement,
  updateAnnouncement,
} from '../services/announcements.service';
import './AnnouncementFormPage.css';

interface AnnouncementFormState {
  title: string;
  body: string;
  isEnabled: boolean;
  startsAt: string;
  endsAt: string;
  sortOrder: string;
}

const emptyForm: AnnouncementFormState = {
  title: '',
  body: '',
  isEnabled: true,
  startsAt: '',
  endsAt: '',
  sortOrder: '0',
};

// Day-granularity scheduling: a start date takes effect at the start of that
// day, an end date holds through the end of it.
const toStartOfDayIso = (adDay: string) => (adDay ? `${adDay}T00:00:00` : null);
const toEndOfDayIso = (adDay: string) => (adDay ? `${adDay}T23:59:59` : null);

const AnnouncementFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const isEdit = !!editId;

  const [form, setForm] = useState<AnnouncementFormState>(emptyForm);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isEdit || !editId) return;
    getAnnouncement(editId)
      .then((a) => {
        setForm({
          title: a.title,
          body: a.body,
          isEnabled: a.isEnabled,
          startsAt: a.startsAt ? a.startsAt.slice(0, 10) : '',
          endsAt: a.endsAt ? a.endsAt.slice(0, 10) : '',
          sortOrder: String(a.sortOrder),
        });
      })
      .catch(() => setError('Failed to load that announcement.'))
      .finally(() => setLoading(false));
  }, [isEdit, editId]);

  const set = <K extends keyof AnnouncementFormState>(key: K, value: AnnouncementFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.title.trim()) {
      setError('A title is required.');
      return;
    }
    if (!form.body.trim()) {
      setError('A body is required.');
      return;
    }
    if (form.startsAt && form.endsAt && form.startsAt > form.endsAt) {
      setError('End date must be on or after the start date.');
      return;
    }

    setSaving(true);
    try {
      const input = {
        title: form.title.trim(),
        body: form.body.trim(),
        isEnabled: form.isEnabled,
        startsAt: toStartOfDayIso(form.startsAt),
        endsAt: toEndOfDayIso(form.endsAt),
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (isEdit && editId) {
        await updateAnnouncement(editId, input);
      } else {
        await createAnnouncement(input);
      }
      navigate('/announcements');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to save that announcement.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="anfp-page">
        <p className="anfp-muted">Loading announcement…</p>
      </div>
    );
  }

  return (
    <div className="anfp-page">
      <button type="button" className="anfp-back" onClick={() => navigate('/announcements')}>
        <ArrowLeft size={16} /> Back to Announcements
      </button>

      <div className="anfp-header">
        <h1>{isEdit ? 'Edit Announcement' : 'New Announcement'}</h1>
        <p>A short operational notice shown in the vendor dashboard's Announcements card.</p>
      </div>

      <form className="anfp-form" onSubmit={handleSubmit} noValidate>
        <section className="anfp-section">
          <div className="anfp-fields">
            <FormField
              label="Title"
              required
              value={form.title}
              onChange={(v) => set('title', v)}
              placeholder="e.g. Notice regarding vendor payment on Dashain"
            />
            <FormField
              label="Body"
              required
              type="textarea"
              rows={6}
              value={form.body}
              onChange={(v) => set('body', v)}
              placeholder="The full notice text vendors see when they open this announcement."
            />

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
                hint="Lower shows first when more than one announcement is live."
              />
              <div className="form-group">
                <label>Enabled</label>
                <div className="anfp-toggle-row">
                  <ToggleSwitch checked={form.isEnabled} onChange={(v) => set('isEnabled', v)} ariaLabel="Announcement enabled" />
                  <span className="anfp-toggle-label">
                    {form.isEnabled ? 'Live within its date window' : 'Draft — hidden from vendors'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <p className="anfp-error" role="alert">
            <X size={14} /> {error}
          </p>
        )}

        <div className="anfp-actions">
          <Button type="button" variant="secondary" onClick={() => navigate('/announcements')}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Announcement'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default AnnouncementFormPage;
