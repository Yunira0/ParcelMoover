import React, { useEffect, useState } from 'react';
import './Modal.css';
import Button from './Button';
import FormField from './FormField';
import { getLocations } from '../services/users.service';

// Preset reasons cover the common cases; "Other" keeps the free-text escape
// hatch so ops is never forced into a wrong label.
const REASON_OPTIONS = [
  'Customer moved to a new address',
  'Customer travelling / temporarily elsewhere',
  'Wrong destination selected at booking',
  'Customer requested a different branch',
  'Other',
];
const OTHER_REASON = 'Other';

interface RedirectOrderModalProps {
  isOpen: boolean;
  /** Shown in the heading so the operator can confirm they picked the right parcel. */
  trackingId: string;
  currentBranch: string;
  currentAddress: string;
  currentDeliveryCharge: number;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (data: {
    destinationLocationId: string;
    address: string;
    reason: string;
    redirectCharge: number;
  }) => void;
}

interface LocationOption {
  id: string;
  name: string;
  parentId: string | null;
}

/**
 * Admin-only redirect flow: the customer moved, so the parcel needs a new
 * destination branch + address. Kept out of the Edit Order form on purpose —
 * a redirect always costs money and always needs a reason, so it must be a
 * deliberate action rather than an incidental field change.
 */
const RedirectOrderModal: React.FC<RedirectOrderModalProps> = ({
  isOpen,
  trackingId,
  currentBranch,
  currentAddress,
  currentDeliveryCharge,
  busy = false,
  error,
  onClose,
  onConfirm,
}) => {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [destinationId, setDestinationId] = useState('');
  const [address, setAddress] = useState('');
  const [reason, setReason] = useState(REASON_OPTIONS[0]);
  const [reasonOther, setReasonOther] = useState('');
  const [charge, setCharge] = useState('0');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setDestinationId('');
    setAddress(currentAddress);
    setReason(REASON_OPTIONS[0]);
    setReasonOther('');
    setCharge('0');
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
      setFormError('Select the new destination branch.');
      return;
    }
    if (!address.trim()) {
      setFormError('Enter the new delivery address.');
      return;
    }
    if (!effectiveReason) {
      setFormError('Enter the reason for this redirect.');
      return;
    }
    if (chargeNumber < 0) {
      setFormError('Redirect charge cannot be negative.');
      return;
    }
    setFormError('');
    onConfirm({
      destinationLocationId: destinationId,
      address: address.trim(),
      reason: effectiveReason,
      redirectCharge: chargeNumber,
    });
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Redirect Order</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose} type="button">
            &times;
          </Button>
        </div>
        <p className="modal-desc">
          {trackingId} — currently routed to <strong>{currentBranch || '—'}</strong>. The original
          delivery charge stays; the redirect charge is added on top.
        </p>

        <FormField
          label="New Destination Branch"
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
          label="New Delivery Address"
          required
          type="textarea"
          rows={2}
          value={address}
          onChange={setAddress}
          placeholder="Enter the customer's new address"
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
            placeholder="Why is this order being redirected?"
            disabled={busy}
          />
        )}

        <FormField
          label="Redirect Charge"
          type="number"
          min={0}
          value={charge}
          onChange={setCharge}
          placeholder="0"
          hint={`New delivery charge: Rs. ${Math.round(currentDeliveryCharge + chargeNumber).toLocaleString()} (Rs. ${Math.round(currentDeliveryCharge).toLocaleString()} + Rs. ${Math.round(chargeNumber).toLocaleString()})`}
          disabled={busy}
        />

        {(formError || error) && <p className="error-text">{formError || error}</p>}

        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleConfirm} disabled={busy}>
            {busy ? 'Redirecting…' : 'Redirect Order'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RedirectOrderModal;
