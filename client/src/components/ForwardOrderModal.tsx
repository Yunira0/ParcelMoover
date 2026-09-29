import React, { useEffect, useState } from 'react';
import './Modal.css';
import Button from './Button';
import FormField from './FormField';
import { getLocations } from '../services/users.service';

// Same shape as RedirectOrderModal: preset reasons plus a free-text "Other".
const REASON_OPTIONS = [
  'Forwarded by carrier to another destination',
  'Customer asked for a different destination',
  'Wrong destination at delivery',
  'Other',
];
const OTHER_REASON = 'Other';

interface ForwardOrderModalProps {
  isOpen: boolean;
  /** Shown in the heading so the operator can confirm they picked the right parcel. */
  trackingId: string;
  currentBranch: string;
  currentDeliveryCharge: number;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (data: {
    destinationLocationId: string;
    forwardingCharge: number;
    reason?: string;
  }) => void;
}

interface LocationOption {
  id: string;
  name: string;
  parentId: string | null;
}

/**
 * Admin-only forwarding flow for a delivered parcel (e.g. NCM forwarded it on
 * to another destination). The twin of RedirectOrderModal, but the status
 * stays delivered and the address is untouched: only the destination changes
 * and the manually entered forwarding charge is added to the delivery charge.
 */
const ForwardOrderModal: React.FC<ForwardOrderModalProps> = ({
  isOpen,
  trackingId,
  currentBranch,
  currentDeliveryCharge,
  busy = false,
  error,
  onClose,
  onConfirm,
}) => {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [destinationId, setDestinationId] = useState('');
  const [charge, setCharge] = useState('');
  const [reason, setReason] = useState(REASON_OPTIONS[0]!);
  const [reasonOther, setReasonOther] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setDestinationId('');
    setCharge('');
    setReason(REASON_OPTIONS[0]!);
    setReasonOther('');
    setFormError('');
    if (locations.length > 0) return;
    setLoading(true);
    getLocations()
      .then((res) => {
        if (res?.success && Array.isArray(res.data)) {
          setLocations(
            res.data.map((l: any) => ({ id: l.id, name: l.name, parentId: l.parent_id })),
          );
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  // Destinations are top-level locations; children are covered areas within a
  // branch, not places a parcel can be routed to.
  const destinationOptions = locations
    .filter((l) => !l.parentId)
    .map((l) => ({ id: l.id, label: l.name }));

  const chargeNumber = Number(charge) || 0;
  const effectiveReason = reason === OTHER_REASON ? reasonOther.trim() : reason;

  const handleConfirm = () => {
    if (!destinationId) {
      setFormError('Select the destination this parcel was forwarded to.');
      return;
    }
    if (chargeNumber <= 0) {
      setFormError('Enter the forwarding charge (more than 0).');
      return;
    }
    if (!effectiveReason) {
      setFormError('Enter the reason for this forward.');
      return;
    }
    setFormError('');
    onConfirm({
      destinationLocationId: destinationId,
      forwardingCharge: chargeNumber,
      reason: effectiveReason,
    });
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Forward Order</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose} type="button">
            &times;
          </Button>
        </div>
        <p className="modal-desc">
          {trackingId} — currently <strong>{currentBranch || '—'}</strong>. The order stays
          Delivered; only the destination changes and the forwarding charge is added.
        </p>

        <FormField
          label="Forwarded To (Destination)"
          required
          type="searchable-select"
          searchableOptions={destinationOptions}
          value={destinationId}
          onChange={setDestinationId}
          placeholder={loading ? 'Loading branches…' : 'Select destination'}
          searchPlaceholder="Search branch..."
          emptyMessage="No branches found."
          disabled={loading || busy}
        />

        <FormField
          label="Forwarding Charge"
          required
          type="number"
          min={0}
          value={charge}
          onChange={setCharge}
          placeholder="e.g. 50"
          hint={`New delivery charge: Rs. ${Math.round(currentDeliveryCharge + chargeNumber).toLocaleString()} (Rs. ${Math.round(currentDeliveryCharge).toLocaleString()} + Rs. ${Math.round(chargeNumber).toLocaleString()})`}
          disabled={busy}
        />

        <FormField
          label="Reason"
          required
          type="select"
          options={REASON_OPTIONS.map((r) => ({ value: r, label: r }))}
          value={reason}
          onChange={setReason}
          disabled={busy}
        />
        {reason === OTHER_REASON && (
          <FormField
            label="Specify Reason"
            required
            value={reasonOther}
            onChange={setReasonOther}
            placeholder="Why is this order being forwarded?"
            disabled={busy}
          />
        )}

        {(formError || error) && <p className="error-text">{formError || error}</p>}

        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleConfirm} disabled={busy}>
            {busy ? 'Forwarding…' : 'Forward Order'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ForwardOrderModal;
