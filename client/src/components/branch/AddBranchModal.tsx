import React, { useEffect, useRef, useState } from 'react';
import '../Modal.css';
import FormField from '../FormField';
import Button from '../Button';
import SearchableSelect from '../SearchableSelect';
import MultiSearchableSelect from '../MultiSearchableSelect';
import { listManagedLocations, type ManagedLocation } from '../../services/locations.service';
import { createBranch, listBranches, type Branch } from '../../services/branchTracking.service';
import { apiErrorMessage } from '../../utils/serverValidation';

interface AddBranchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

// Nothing gets created here. A branch is an existing destination flagged
// isHub — this just picks one and marks it, then lists other existing
// branches as virtually covered by it, without touching their own hub
// status: each keeps its own routing, pricing and settlements untouched.
// (Plain-destination coverage - re-parenting a non-hub area under a branch -
// is handled on the Destinations settings page, not here.) Super_admin only
// (gated by caller).
const AddBranchModal: React.FC<AddBranchModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [locations, setLocations] = useState<ManagedLocation[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState('');
  // Other existing branches to virtually cover from this one - a side
  // relationship, not a re-parenting: each keeps its own routing/pricing.
  const [virtualBranchIds, setVirtualBranchIds] = useState<string[]>([]);
  const [commissionPerParcel, setCommissionPerParcel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- visibility owns this remote resource
    setLoadingLocations(true);
    listManagedLocations()
      .then((res) => {
        if (!res?.success) return;
        // Flatten: a destination and its areas are both fair picks for the
        // Branch field itself.
        const flat = res.data.flatMap((d) => [d, ...d.areas]);
        setLocations(flat);
      })
      .catch(() => setError('Failed to load destinations.'))
      .finally(() => setLoadingLocations(false));
    listBranches().then(setBranches).catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) onClose();
      if (event.key === 'Tab') {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLButtonElement>('.modal-close-btn')?.focus());
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [isOpen, onClose]);

  useEffect(() => { savingRef.current = saving; }, [saving]);

  if (!isOpen) return null;

  const reset = () => {
    setBranchId('');
    setVirtualBranchIds([]);
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
      await createBranch({
        locationId: branchId,
        virtualBranchIds,
        commissionPerParcel: Number(commissionPerParcel || 0),
      });

      reset();
      await onSuccess();
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to set branch'));
    } finally {
      setSaving(false);
    }
  };

  const branchOptions = locations.map((l) => ({ id: l.id, label: l.name, description: l.district ?? undefined }));
  const virtualBranchOptions = branches
    .filter((b) => b.id !== branchId)
    .map((b) => ({ id: b.id, label: b.name, description: b.district ?? undefined }));

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div ref={dialogRef} className="modal-content" role="dialog" aria-modal="true" aria-labelledby="add-branch-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="add-branch-title">New Branch</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose} type="button" aria-label="Close new branch dialog">
            &times;
          </Button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Branch</label>
            <SearchableSelect
              options={branchOptions}
              value={branchId}
              onChange={setBranchId}
              placeholder={loadingLocations ? 'Loading destinations…' : 'Select an existing destination'}
              searchPlaceholder="Search destinations…"
              emptyMessage="No destinations found."
              disabled={loadingLocations}
              ariaLabel="Branch destination"
            />
            <small className="form-hint">
              No destination is created here — pick one that already exists to set it as a branch.
            </small>
          </div>

          <div className="form-group">
            <label>Virtual Branches</label>
            <MultiSearchableSelect
              options={virtualBranchOptions}
              value={virtualBranchIds}
              onChange={setVirtualBranchIds}
              placeholder="Select existing branches"
              searchPlaceholder="Search branches…"
              emptyMessage="No other branches yet."
              disabled={!branchId}
              ariaLabel="Virtual branches"
            />
            <small className="form-hint">
              Other existing branches to also treat as covered by this one, for manifest routing
              and settlements. Each keeps running as its own independent branch — this doesn't
              change its destination, its routing, or anything on the client/vendor side.
            </small>
          </div>

          <FormField
            label="Commission per Parcel"
            type="decimal"
            value={commissionPerParcel}
            onChange={setCommissionPerParcel}
            placeholder="e.g. 50"
            hint="Rs. per parcel this branch keeps when a settlement is recorded."
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
