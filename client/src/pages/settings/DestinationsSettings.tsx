import React, { useEffect, useState } from 'react';
import { Plus, MapPin, Trash2, X } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import StatusChip from '../../components/StatusChip';
import {
  listManagedLocations,
  createLocation,
  updateLocation,
  deleteLocation,
  type Destination,
} from '../../services/locations.service';
import './DestinationsSettings.css';

const emptyDest = { name: '', code: '', province: '', district: '', municipality: '' };

const DestinationsSettings: React.FC = () => {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showDestForm, setShowDestForm] = useState(false);
  const [destForm, setDestForm] = useState(emptyDest);
  const [savingDest, setSavingDest] = useState(false);

  const [areaInputs, setAreaInputs] = useState<Record<string, string>>({});
  const [savingArea, setSavingArea] = useState<string | null>(null);

  // Inline delete confirmation: id of item pending confirm
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await listManagedLocations();
      if (res?.success) setDestinations(res.data);
    } catch {
      setError('Failed to load destinations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const addDestination = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!destForm.name.trim()) { setError('Destination name is required.'); return; }
    setSavingDest(true);
    try {
      await createLocation({
        name: destForm.name,
        code: destForm.code || undefined,
        province: destForm.province || undefined,
        district: destForm.district || undefined,
        // Municipality lives in the locations.city column server-side.
        city: destForm.municipality || undefined,
        isHub: true,
      });
      setDestForm(emptyDest);
      setShowDestForm(false);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to add destination.');
    } finally {
      setSavingDest(false);
    }
  };

  const addArea = async (destId: string) => {
    const name = (areaInputs[destId] || '').trim();
    if (!name) return;
    setSavingArea(destId);
    setError('');
    try {
      await createLocation({ name, parentId: destId });
      setAreaInputs((prev) => ({ ...prev, [destId]: '' }));
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to add area.');
    } finally {
      setSavingArea(null);
    }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    setError('');
    try {
      await updateLocation(id, { isActive: !isActive });
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update.');
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    setError('');
    try {
      await deleteLocation(id);
      setConfirmDelete(null);
      await load();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to delete.');
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="dest-settings">
      <div className="dest-settings-head">
        <div>
          <h2>Destinations &amp; Covered Areas</h2>
          <p>Add a destination (hub/branch), then list the areas it covers. Both become selectable when creating orders.</p>
        </div>
        <Button variant="primary" onClick={() => setShowDestForm((v) => !v)}>
          <Plus size={16} /> Add Destination
        </Button>
      </div>

      {showDestForm && (
        <form className="dest-form" onSubmit={addDestination}>
          <div className="dest-form-row">
            <FormField label="Destination Name" required value={destForm.name}
              onChange={(v) => setDestForm((p) => ({ ...p, name: v }))} placeholder="e.g. Pokhara Branch" />
            <FormField label="Code" value={destForm.code}
              onChange={(v) => setDestForm((p) => ({ ...p, code: v }))} placeholder="e.g. PKR-01" />
          </div>
          <div className="dest-form-row">
            <FormField label="Province" value={destForm.province}
              onChange={(v) => setDestForm((p) => ({ ...p, province: v }))} placeholder="e.g. Gandaki" />
            <FormField label="District" value={destForm.district}
              onChange={(v) => setDestForm((p) => ({ ...p, district: v }))} placeholder="e.g. Kaski" />
          </div>
          <div className="dest-form-row">
            <FormField label="Municipality" value={destForm.municipality}
              onChange={(v) => setDestForm((p) => ({ ...p, municipality: v }))} placeholder="e.g. Pokhara" />
          </div>
          <div className="dest-form-actions">
            <Button type="submit" variant="primary" disabled={savingDest}>
              {savingDest ? 'Saving…' : 'Save Destination'}
            </Button>
          </div>
        </form>
      )}

      {error && <p className="dest-error">{error}</p>}

      {loading ? (
        <p className="dest-muted">Loading destinations…</p>
      ) : destinations.length === 0 ? (
        <p className="dest-muted">No destinations yet. Add one to get started.</p>
      ) : (
        <div className="dest-list">
          {destinations.map((dest) => (
            <div key={dest.id} className={`dest-card ${dest.isActive ? '' : 'dest-card--inactive'}`}>
              <div className="dest-card-head">
                <div className="dest-card-title">
                  <MapPin size={16} />
                  <span>{dest.name}</span>
                  {dest.code && <span className="dest-code">{dest.code}</span>}
                </div>
                <div className="dest-card-actions">
                  <button type="button" className="dest-toggle" onClick={() => toggleActive(dest.id, dest.isActive)}>
                    <StatusChip tone={dest.isActive ? 'success' : 'danger'}>
                      {dest.isActive ? 'Active' : 'Inactive'}
                    </StatusChip>
                  </button>
                  {confirmDelete === dest.id ? (
                    <div className="dest-confirm-delete">
                      <span>Delete destination and all its areas?</span>
                      <button
                        type="button"
                        className="dest-confirm-btn dest-confirm-btn--danger"
                        disabled={deleting}
                        onClick={() => handleDelete(dest.id)}
                      >
                        {deleting ? 'Deleting…' : 'Yes, delete'}
                      </button>
                      <button
                        type="button"
                        className="dest-confirm-btn"
                        onClick={() => setConfirmDelete(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="dest-delete-btn"
                      title="Remove destination"
                      onClick={() => setConfirmDelete(dest.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>

              <div className="dest-areas">
                {dest.areas.length === 0 ? (
                  <span className="dest-muted">No covered areas yet.</span>
                ) : (
                  dest.areas.map((area) => (
                    <span
                      key={area.id}
                      className={`dest-area-chip ${area.isActive ? '' : 'dest-area-chip--inactive'}`}
                    >
                      {confirmDelete === area.id ? (
                        <>
                          <span className="dest-area-confirm-text">Remove "{area.name}"?</span>
                          <button
                            type="button"
                            className="dest-area-confirm-yes"
                            disabled={deleting}
                            onClick={() => handleDelete(area.id)}
                          >
                            {deleting ? '…' : 'Yes'}
                          </button>
                          <button
                            type="button"
                            className="dest-area-confirm-no"
                            onClick={() => setConfirmDelete(null)}
                          >
                            No
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="dest-area-name-btn"
                            title={area.isActive ? 'Click to deactivate' : 'Click to activate'}
                            onClick={() => toggleActive(area.id, area.isActive)}
                          >
                            {area.name}
                          </button>
                          <button
                            type="button"
                            className="dest-area-remove"
                            title="Remove area"
                            onClick={() => setConfirmDelete(area.id)}
                          >
                            <X size={11} />
                          </button>
                        </>
                      )}
                    </span>
                  ))
                )}
              </div>

              <div className="dest-add-area">
                <input
                  type="text"
                  value={areaInputs[dest.id] || ''}
                  onChange={(e) => setAreaInputs((prev) => ({ ...prev, [dest.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addArea(dest.id); } }}
                  placeholder="Add covered area (e.g. Lakeside)"
                />
                <Button variant="outline" size="sm" disabled={savingArea === dest.id} onClick={() => addArea(dest.id)}>
                  {savingArea === dest.id ? 'Adding…' : 'Add Area'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DestinationsSettings;
