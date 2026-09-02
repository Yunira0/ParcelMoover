import React, { useEffect, useState } from 'react';
import '../Modal.css';
import FormField from '../FormField';
import Button from '../Button';
import SearchableSelect from '../SearchableSelect';
import MultiSearchableSelect from '../MultiSearchableSelect';
import { listManagedLocations, updateLocation, type ManagedLocation } from '../../services/locations.service';
import { apiErrorMessage } from '../../utils/serverValidation';

interface AddBranchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// Nothing gets created here. A branch is an existing destination flagged
// isHub — this just picks one and marks it, then re-parents other existing
// destinations under it as covered areas. Super_admin only (gated by caller).
const AddBranchModal: React.FC<AddBranchModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [locations, setLocations] = useState<ManagedLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [coveredAreaIds, setCoveredAreaIds] = useState<string[]>([]);
  const [commissionPerParcel, setCommissionPerParcel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setLoadingLocations(true);
    listManagedLocations()
      .then((res) => {
        if (!res?.success) return;
        // Flatten: a destination and its areas are both fair picks — either
        // can be selected as the branch, or covered by one.
        const flat = res.data.flatMap((d) => [d, ...d.areas]);
        setLocations(flat);
      })
      .catch(() => setError('Failed to load destinations.'))
      .finally(() => setLoadingLocations(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const reset = () => {
    setBranchId('');
    setCoveredAreaIds([]);
    setCommissionPerParcel('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId) {
      setError('Pick the destination to set as a branch.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateLocation(branchId, { isHub: true });

      // Re-parent the picked destinations under it — a link, not a create.
      let failedAreas: string[] = [];
      if (coveredAreaIds.length > 0) {
        const results = await Promise.allSettled(
          coveredAreaIds.map((id) => updateLocation(id, { parentId: branchId })),
        );
        failedAreas = coveredAreaIds
          .map((id) => locations.find((l) => l.id === id)?.name ?? id)
          .filter((_, i) => results[i].status === 'rejected');
      }

      reset();
      onSuccess();
      if (failedAreas.length > 0) {
        setError(`Branch set, but couldn't cover: ${failedAreas.join(', ')}`);
      } else {
        onClose();
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to set branch'));
    } finally {
      setSaving(false);
    }
  };

  const branchOptions = locations.map((l) => ({ id: l.id, label: l.name, description: l.district ?? undefined }));
  const areaOptions = branchOptions.filter((o) => o.id !== branchId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New Branch</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose} type="button">
            &times;
          </Button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Branch</label>
            <SearchableSelect
              options={branchOptions}
              value={branchId}
              onChange={(id) => {
                setBranchId(id);
                setCoveredAreaIds((prev) => prev.filter((a) => a !== id));
              }}
              placeholder={loadingLocations ? 'Loading destinations…' : 'Select an existing destination'}
              searchPlaceholder="Search destinations…"
              emptyMessage="No destinations found."
              disabled={loadingLocations}
            />
            <small className="form-hint">
              No destination is created here — pick one that already exists to set it as a branch.
            </small>
          </div>

          <div className="form-group">
            <label>Covered Areas</label>
            <MultiSearchableSelect
              options={areaOptions}
              value={coveredAreaIds}
              onChange={setCoveredAreaIds}
              placeholder="Select existing destinations"
              searchPlaceholder="Search destinations…"
              emptyMessage="No other destinations yet."
              disabled={!branchId}
            />
            <small className="form-hint">
              Also existing destinations only — re-linked under the branch above (e.g. Chitwan
              Branch covering Gaidakot), nothing new is created.
            </small>
          </div>

          <FormField
            label="Commission per Parcel"
            type="decimal"
            value={commissionPerParcel}
            onChange={setCommissionPerParcel}
            placeholder="e.g. 50"
            hint="Rs. per parcel this branch keeps. Not saved yet — no backend field for it."
          />
          {error && <p className="error-text">{error}</p>}
          <div className="modal-footer">
            <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={saving || !branchId}>
              {saving ? 'Saving…' : 'Set as Branch'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddBranchModal;
