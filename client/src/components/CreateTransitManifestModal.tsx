import React, { useEffect, useState } from 'react';
import './Modal.css';
import FormField from './FormField';
import Button from './Button';
import SearchableSelect from './SearchableSelect';
import { listBranches, type Branch } from '../services/branchTracking.service';
import { createTransitManifest, type TransitManifest } from '../services/transitManifests.service';
import { apiErrorMessage } from '../utils/serverValidation';

interface CreateTransitManifestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (manifest: TransitManifest) => void;
}

// Opens a transit manifest: pick the origin hub and the destination hub, add an
// optional note.
const CreateTransitManifestModal: React.FC<CreateTransitManifestModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [fromHub, setFromHub] = useState('');
  const [toHub, setToHub] = useState('');
  const [remarks, setRemarks] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    listBranches()
      .then(setBranches)
      .catch(() => setError('Failed to load branches.'));
  }, [isOpen]);

  if (!isOpen) return null;

  const options = branches.map((b) => ({ id: b.name, label: b.name, description: b.district ?? undefined }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromHub || !toHub) {
      setError('Pick both an origin and a destination branch.');
      return;
    }
    if (fromHub === toHub) {
      setError('Origin and destination must be different.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await createTransitManifest({ fromHub, toHub, remarks: remarks.trim() || undefined });
      setFromHub('');
      setToHub('');
      setRemarks('');
      onCreated(res.data);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to open the manifest.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New Transit Manifest</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose} type="button">
            &times;
          </Button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-group">
              <label>From Branch</label>
              <SearchableSelect
                options={options}
                value={fromHub}
                onChange={setFromHub}
                placeholder="Origin hub"
                searchPlaceholder="Search branches…"
              />
            </div>
            <div className="form-group">
              <label>To Branch</label>
              <SearchableSelect
                options={options.filter((o) => o.id !== fromHub)}
                value={toHub}
                onChange={setToHub}
                placeholder="Destination hub"
                searchPlaceholder="Search branches…"
              />
            </div>
          </div>
          <FormField
            label="Remarks"
            type="textarea"
            value={remarks}
            onChange={setRemarks}
            placeholder="Optional note"
          />
          {error && <p className="error-text">{error}</p>}
          <div className="modal-footer">
            <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? 'Opening…' : 'Open manifest'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateTransitManifestModal;
