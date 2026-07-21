import React, { useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Upload, X, Eye, EyeOff } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Button from '../components/Button';
import FormField from '../components/FormField';
import {
  listVendorNotices,
  getVendorNoticeById,
  createVendorNotice,
  updateVendorNotice,
  hardDeleteVendorNotice,
  uploadNoticeImage,
  type VendorNotice,
} from '../services/vendorNotices.service';
import { isVendorSide } from '../utils/auth';
import './VendorNoticeManager.css';

type TargetMode = 'all' | 'specific';

interface FormData {
  title: string;
  imageUrl: string | null;
  isActive: boolean;
  isDismissable: boolean;
  target: TargetMode;
  targetVendorIds: string[];
}

const EMPTY_FORM: FormData = {
  title: '',
  imageUrl: null,
  isActive: true,
  isDismissable: true,
  target: 'all',
  targetVendorIds: [],
};

const VendorNoticeManager: React.FC = () => {
  const [notices, setNotices] = useState<VendorNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await listVendorNotices();
        if (!cancelled && res?.success) setNotices(res.data);
      } catch {
        if (!cancelled) setError('Failed to load notices.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const refreshNotices = async () => {
    try {
      const res = await listVendorNotices();
      if (res?.success) setNotices(res.data);
    } catch {
      setError('Failed to load notices.');
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setSaved(false);
    setError('');
  };

  const openEdit = async (id: string) => {
    try {
      const res = await getVendorNoticeById(id);
      if (res?.success) {
        const n = res.data;
        setEditingId(id);
        setForm({
          title: n.title,
          imageUrl: n.imageUrl,
          isActive: n.isActive,
          isDismissable: n.isDismissable,
          target: n.target as TargetMode,
          targetVendorIds: n.targetVendorIds ?? [],
        });
        setShowForm(true);
        setSaved(false);
        setError('');
      }
    } catch {
      setError('Failed to load notice.');
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await uploadNoticeImage(file);
      if (res?.success) {
        setForm((p) => ({ ...p, imageUrl: res.data.imageUrl }));
      }
    } catch {
      setError('Failed to upload image.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeImage = () => {
    setForm((p) => ({ ...p, imageUrl: null }));
  };

  const handleSave = async () => {
    if (!form.title.trim()) { setError('Title is required.'); return; }
    if (!form.imageUrl) { setError('A banner image is required.'); return; }

    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await updateVendorNotice(editingId, {
          title: form.title.trim(),
          imageUrl: form.imageUrl,
          isActive: form.isActive,
          isDismissable: form.isDismissable,
          target: form.target,
          targetVendorIds: form.targetVendorIds,
        });
      } else {
        await createVendorNotice({
          title: form.title.trim(),
          imageUrl: form.imageUrl,
          isDismissable: form.isDismissable,
          target: form.target,
          targetVendorIds: form.targetVendorIds,
        });
      }
      setSaved(true);
      await refreshNotices();
      setTimeout(() => { closeForm(); setSaved(false); }, 800);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save notice.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Permanently delete this notice? This cannot be undone.')) return;
    try {
      await hardDeleteVendorNotice(id);
      await refreshNotices();
    } catch {
      setError('Failed to delete notice.');
    }
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  // If vendor accidentally hits this page, redirect
  if (isVendorSide()) return null;

  return (
    <div className="vnm-page">
      <PageHeader
        title="Vendor Notices"
        subtitle="Create and manage popup notices that vendors see when they open the portal."
      />

      <div className="vnm-toolbar">
        <div />
        <Button variant="primary" onClick={openCreate}>
          <Plus size={15} /> New Notice
        </Button>
      </div>

      {error && <p className="vnm-error">{error}</p>}

      {loading ? (
        <p className="vnm-muted">Loading notices...</p>
      ) : notices.length === 0 ? (
        <div className="vnm-empty">
          <p>No notices created yet. Click "New Notice" to create one.</p>
        </div>
      ) : (
        <div className="vnm-table-wrap">
          <table className="vnm-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Banner</th>
                <th>Target</th>
                <th>Status</th>
                <th>Dismissable</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {notices.map((n) => (
                <tr key={n.id}>
                  <td style={{ fontWeight: 500, color: 'var(--color-text-default)' }}>
                    {n.title}
                  </td>
                  <td>
                    <img src={n.imageUrl} alt={n.title} className="vnm-thumb" />
                  </td>
                  <td>{n.target === 'all' ? 'All Vendors' : 'Specific'}</td>
                  <td>
                    <span className={`vnm-badge vnm-badge-${n.isActive ? 'active' : 'inactive'}`}>
                      {n.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{n.isDismissable ? <Eye size={14} /> : <EyeOff size={14} />}</td>
                  <td>{formatDate(n.createdAt)}</td>
                  <td>
                    <div className="vnm-actions">
                      <button className="vnm-icon-btn" onClick={() => openEdit(n.id)} title="Edit">
                        <Pencil size={14} />
                      </button>
                      <button className="vnm-icon-btn vnm-icon-btn-danger" onClick={() => handleDelete(n.id)} title="Delete permanently">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Create / Edit Form Modal ──────────────────────────────────────── */}
      {showForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal-content" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit Notice' : 'New Notice'}</h2>
              <button className="modal-close-btn" onClick={closeForm}>&times;</button>
            </div>

            {error && <p className="vnm-error" style={{ marginBottom: 'var(--space-4)' }}>{error}</p>}

            <div className="vnm-form-grid">
              <FormField
                label="Title"
                required
                value={form.title}
                onChange={(v) => setForm((p) => ({ ...p, title: v }))}
                placeholder="e.g. Scheduled Maintenance Notice"
              />
              <p className="vnm-muted" style={{ fontSize: 'var(--font-size-xs)', margin: '-8px 0 0' }}>
                Admin reference only - vendors see just the banner image, not this title.
              </p>

              {/* Image upload — the entire notice content vendors see. Cropped
                  server-side to 16:9, so any source image works. */}
              <div className="form-group">
                <label>Banner Image (16:9) <span style={{ color: 'var(--color-danger-default)' }}>*</span></label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageUpload}
                  style={{ display: 'none' }}
                />
                {form.imageUrl ? (
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <img src={form.imageUrl} alt="Preview" className="vnm-image-preview" />
                    <button className="vnm-image-remove" onClick={removeImage}>
                      <X size={12} /> Remove
                    </button>
                  </div>
                ) : (
                  <div
                    className="vnm-image-upload"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload size={20} style={{ opacity: 0.5 }} />
                    <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-caption)' }}>
                      {uploading ? 'Uploading...' : 'Click to upload JPG, PNG, or WebP'}
                    </p>
                  </div>
                )}
              </div>

              {/* Toggles */}
              <div className="form-group" style={{ display: 'flex', gap: 'var(--space-6)' }}>
                <label className="vnm-inline-toggle">
                  <span className="vnm-toggle">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                    />
                    <span className="vnm-toggle-slider" />
                  </span>
                  Active
                </label>
                <label className="vnm-inline-toggle">
                  <span className="vnm-toggle">
                    <input
                      type="checkbox"
                      checked={form.isDismissable}
                      onChange={(e) => setForm((p) => ({ ...p, isDismissable: e.target.checked }))}
                    />
                    <span className="vnm-toggle-slider" />
                  </span>
                  Dismissable
                </label>
              </div>

              <FormField
                label="Target Audience"
                type="select"
                value={form.target}
                onChange={(v) => setForm((p) => ({ ...p, target: v as TargetMode, targetVendorIds: v === 'all' ? [] : p.targetVendorIds }))}
                options={[
                  { value: 'all', label: 'All Vendors' },
                  { value: 'specific', label: 'Specific Vendors' },
                ]}
              />

              {form.target === 'specific' && (
                <div className="form-group">
                  <label>Select Vendors</label>
                  <p className="vnm-muted" style={{ fontSize: 'var(--font-size-xs)', margin: '0 0 var(--space-2)' }}>
                    Vendor IDs will be managed here. For now, enter vendor IDs separated by commas.
                  </p>
                  <FormField
                    label=""
                    value={form.targetVendorIds.join(', ')}
                    onChange={(v) => setForm((p) => ({
                      ...p,
                      targetVendorIds: v.split(',').map((s) => s.trim()).filter(Boolean),
                    }))}
                    placeholder="vendor-id-1, vendor-id-2"
                  />
                  {form.targetVendorIds.length > 0 && (
                    <div className="vnm-vendor-chips">
                      {form.targetVendorIds.map((vid) => (
                        <span key={vid} className="vnm-vendor-chip">
                          {vid.slice(0, 8)}...
                          <button onClick={() => setForm((p) => ({
                            ...p,
                            targetVendorIds: p.targetVendorIds.filter((id) => id !== vid),
                          }))}>
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              {saved && <span style={{ color: 'var(--color-success-default)', fontSize: 'var(--font-size-sm)' }}>Saved!</span>}
              <Button variant="secondary" onClick={closeForm}>Cancel</Button>
              <Button variant="primary" onClick={handleSave} disabled={saving || uploading}>
                {saving ? 'Saving...' : editingId ? 'Update Notice' : 'Create Notice'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorNoticeManager;
