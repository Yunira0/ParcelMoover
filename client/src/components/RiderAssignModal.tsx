import React, { useEffect, useState } from 'react';
import './Modal.css';
import Button from './Button';
import SearchableSelect from './SearchableSelect';
import { getRiders } from '../services/users.service';

interface RiderRecord {
  id: string;
  name: string;
  phone: string;
  location: string;
  status: string;
}

interface RiderAssignModalProps {
  isOpen: boolean;
  /** Heading shown at the top of the modal. */
  title?: string;
  /** Optional context line under the heading. */
  description?: string;
  /** Label for the confirm button. */
  confirmLabel?: string;
  /** Disables actions while the parent applies the change. */
  busy?: boolean;
  /** Error to surface inside the modal. */
  error?: string;
  onClose: () => void;
  onConfirm: (riderId: string) => void;
}

// Shared rider-assignment popup used wherever a leg needs a rider (pickup,
// delivery, return-to-vendor). Reuses SearchableSelect + Button + Modal.css so
// the look matches the rest of the operations flows.
const RiderAssignModal: React.FC<RiderAssignModalProps> = ({
  isOpen,
  title = 'Assign Rider',
  description,
  confirmLabel = 'Assign',
  busy = false,
  error,
  onClose,
  onConfirm,
}) => {
  const [riders, setRiders] = useState<RiderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [riderId, setRiderId] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setRiderId('');
    if (riders.length > 0) return;
    setLoading(true);
    getRiders()
      .then((res) => {
        if (res?.success && Array.isArray(res.data)) {
          setRiders(res.data.filter((r: RiderRecord) => r.status === 'active'));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const options = riders.map((r) => ({
    id: r.id,
    label: r.name,
    description: [r.phone, r.location].filter(Boolean).join(' • '),
  }));

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose} type="button">
            &times;
          </Button>
        </div>
        {description && <p className="modal-desc">{description}</p>}
        <SearchableSelect
          options={options}
          value={riderId}
          onChange={setRiderId}
          placeholder={loading ? 'Loading riders…' : 'Select rider'}
          searchPlaceholder="Search rider by name..."
          emptyMessage="No active riders found."
          disabled={loading || busy}
        />
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={() => onConfirm(riderId)} disabled={busy || !riderId}>
            {busy ? 'Assigning…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RiderAssignModal;
