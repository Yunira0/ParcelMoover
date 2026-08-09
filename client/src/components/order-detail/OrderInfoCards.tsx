import React, { useState } from 'react';
import { ArrowRight, Banknote, Truck, Package, Pencil, Check, X, Lock } from 'lucide-react';
import SearchableSelect, { type SearchableSelectOption } from '../SearchableSelect';
import Button from '../Button';
import { getLocations } from '../../services/users.service';
import type { UpdateOrderInput } from '../../services/orders.service';
import '../Modal.css';

interface OrderInfoCardsProps {
  senderName: string;
  senderPhone: string;
  senderAddress?: string;
  receiverName: string;
  receiverPhone: string;
  receiverAlternatePhone?: string;
  receiverAddress?: string;
  origin: string;
  destination: string;
  destinationLocationId?: string | null;
  codAmount: number;
  itemValue: number;
  deliveryCharge: number;
  pieces: number;
  weightKg?: number;
  /** True when the viewer may edit this parcel's details right now. Sender,
   * origin, and delivery charge are never editable here regardless — sender
   * identity and charge come from elsewhere (vendor profile / redirect flow). */
  editable?: boolean;
  /** Set (with editable false) when editing is only temporarily locked, e.g.
   * a vendor's parcel has already been picked up — shown as a small inline
   * notice instead of silently offering nothing. */
  lockedReason?: string;
  /** Applies one field's change. Throws on failure so the confirm dialog can
   * show the error and let the viewer retry. */
  onSave?: (patch: UpdateOrderInput) => Promise<void>;
}

interface PendingChange {
  label: string;
  oldDisplay: string;
  newDisplay: string;
  patch: UpdateOrderInput;
}

// Every edit — text, number, or destination pick — funnels through this
// confirmation step before it's sent. Money and receiver identity are
// exactly the fields "Trust through precision" cares about, so a stray
// keystroke or accidental click can never silently change what's on record.
const useConfirmedEdit = (onSave?: (patch: UpdateOrderInput) => Promise<void>) => {
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const request = (change: PendingChange) => {
    setError('');
    setPending(change);
  };

  const confirm = async () => {
    if (!pending || !onSave) return;
    setSaving(true);
    setError('');
    try {
      await onSave(pending.patch);
      setPending(null);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to save this change.');
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    if (saving) return;
    setPending(null);
    setError('');
  };

  return { pending, saving, error, request, confirm, cancel };
};

const money = (n: number) => `NPR ${n.toLocaleString()}`;

interface EditableValueProps {
  editable: boolean;
  value: string;
  type?: 'text' | 'tel' | 'number';
  step?: string;
  min?: number;
  ariaLabel: string;
  className?: string;
  /** Validate + describe the change. Return an error string to keep editing
   * open, or null to accept — accepting hands off to the confirm dialog. */
  onCommit: (draft: string) => string | null;
  children: React.ReactNode;
}

const EditableValue: React.FC<EditableValueProps> = ({
  editable,
  value,
  type = 'text',
  step,
  min,
  ariaLabel,
  className,
  onCommit,
  children,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [fieldError, setFieldError] = useState('');

  if (!editable) {
    return <>{children}</>;
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={`od-editable ${className || ''}`}
        onClick={() => {
          setDraft(value);
          setFieldError('');
          setEditing(true);
        }}
        aria-label={`Edit ${ariaLabel}`}
      >
        {children}
        <Pencil size={11} className="od-editable-icon" />
      </button>
    );
  }

  const commit = () => {
    const err = onCommit(draft.trim());
    if (err) {
      setFieldError(err);
      return;
    }
    setEditing(false);
  };

  return (
    <span className="od-editable-active">
      <input
        autoFocus
        type={type}
        step={step}
        min={min}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        className="od-inline-input"
        aria-label={ariaLabel}
      />
      <button type="button" className="od-inline-btn od-inline-btn-confirm" onMouseDown={commit} aria-label="Confirm change">
        <Check size={12} />
      </button>
      <button type="button" className="od-inline-btn od-inline-btn-cancel" onMouseDown={() => setEditing(false)} aria-label="Cancel edit">
        <X size={12} />
      </button>
      {fieldError && <span className="od-inline-error">{fieldError}</span>}
    </span>
  );
};

const OrderInfoCards: React.FC<OrderInfoCardsProps> = ({
  senderName,
  senderPhone,
  senderAddress,
  receiverName,
  receiverPhone,
  receiverAlternatePhone,
  receiverAddress,
  origin,
  destination,
  destinationLocationId,
  codAmount,
  itemValue,
  deliveryCharge,
  pieces,
  weightKg,
  editable = false,
  lockedReason,
  onSave,
}) => {
  const { pending, saving, error, request, confirm, cancel } = useConfirmedEdit(onSave);

  const [destinationEditing, setDestinationEditing] = useState(false);
  const [destinationOptions, setDestinationOptions] = useState<SearchableSelectOption[]>([]);
  const [destinationLoading, setDestinationLoading] = useState(false);

  const openDestinationEditor = () => {
    setDestinationEditing(true);
    if (destinationOptions.length > 0) return;
    setDestinationLoading(true);
    getLocations()
      .then((res) => {
        if (res?.success && Array.isArray(res.data)) {
          setDestinationOptions(
            res.data
              .filter((l: any) => !l.parent_id)
              .map((l: any) => ({ id: l.id, label: l.name })),
          );
        }
      })
      .catch(() => {})
      .finally(() => setDestinationLoading(false));
  };

  const receiverPatch = (next: { name?: string; phone?: string; address?: string }): UpdateOrderInput => ({
    receiver: {
      name: next.name ?? receiverName,
      phone: next.phone ?? receiverPhone,
      alternatePhone: receiverAlternatePhone || undefined,
      address: next.address ?? receiverAddress ?? '',
    },
  });

  return (
    <div className="od-details">
      {lockedReason && (
        <div className="od-locked-hint">
          <Lock size={12} />
          {lockedReason}
        </div>
      )}

      {/* Sender + Receiver side by side */}
      <div className="od-details-row">
        <div className="od-details-half">
          <div className="od-details-label">
            <span className="od-details-dot od-details-dot-sender" />
            Sender
          </div>
          <p className="od-details-name">{senderName}</p>
          <p className="od-details-phone">{senderPhone}</p>
          {senderAddress && <p className="od-details-address">{senderAddress}</p>}
        </div>
        <div className="od-details-divider-v" />
        <div className="od-details-half">
          <div className="od-details-label">
            <span className="od-details-dot od-details-dot-receiver" />
            Receiver
          </div>
          <EditableValue
            editable={editable}
            value={receiverName}
            ariaLabel="receiver name"
            className="od-details-name"
            onCommit={(draft) => {
              if (!draft) return 'Name is required.';
              if (draft === receiverName) return null;
              request({
                label: 'Receiver name',
                oldDisplay: receiverName,
                newDisplay: draft,
                patch: receiverPatch({ name: draft }),
              });
              return null;
            }}
          >
            <p className="od-details-name">{receiverName}</p>
          </EditableValue>
          <EditableValue
            editable={editable}
            value={receiverPhone}
            type="tel"
            ariaLabel="receiver phone"
            className="od-details-phone"
            onCommit={(draft) => {
              if (draft.replace(/\D/g, '').length < 7) return 'Enter a valid phone number.';
              if (draft === receiverPhone) return null;
              request({
                label: 'Receiver phone',
                oldDisplay: receiverPhone,
                newDisplay: draft,
                patch: receiverPatch({ phone: draft }),
              });
              return null;
            }}
          >
            <p className="od-details-phone">{receiverPhone}</p>
          </EditableValue>
          <EditableValue
            editable={editable}
            value={receiverAddress || ''}
            ariaLabel="receiver address"
            className="od-details-address"
            onCommit={(draft) => {
              if (!draft) return 'Address is required.';
              if (draft === (receiverAddress || '')) return null;
              request({
                label: 'Receiver address',
                oldDisplay: receiverAddress || '—',
                newDisplay: draft,
                patch: receiverPatch({ address: draft }),
              });
              return null;
            }}
          >
            <p className="od-details-address">{receiverAddress || '—'}</p>
          </EditableValue>
        </div>
      </div>

      {/* Route */}
      <div className="od-details-divider-h" />
      <div className="od-details-route">
        <div className="od-route-end">
          <span className="od-route-dot-sm od-route-dot-origin" />
          <div>
            <span className="od-route-sub">From</span>
            <span className="od-route-city">{origin}</span>
          </div>
        </div>
        <div className="od-route-arrow">
          <span className="od-route-arrow-line" />
          <ArrowRight size={14} className="od-route-arrow-icon" />
          <span className="od-route-arrow-line" />
        </div>
        <div className="od-route-end">
          <span className="od-route-dot-sm od-route-dot-dest" />
          <div>
            <span className="od-route-sub">To</span>
            {editable && destinationEditing ? (
              <span className="od-editable-active od-editable-destination">
                <SearchableSelect
                  options={destinationOptions}
                  value={destinationLocationId || ''}
                  onChange={(id) => {
                    setDestinationEditing(false);
                    const picked = destinationOptions.find((o) => o.id === id);
                    if (!picked || id === destinationLocationId) return;
                    request({
                      label: 'Destination',
                      oldDisplay: destination,
                      newDisplay: picked.label,
                      patch: { destinationLocationId: id },
                    });
                  }}
                  placeholder={destinationLoading ? 'Loading branches…' : 'Select destination'}
                  searchPlaceholder="Search branch..."
                  emptyMessage="No branches found."
                  disabled={destinationLoading}
                />
                <button
                  type="button"
                  className="od-inline-btn od-inline-btn-cancel"
                  onMouseDown={() => setDestinationEditing(false)}
                  aria-label="Cancel destination change"
                >
                  <X size={12} />
                </button>
              </span>
            ) : editable ? (
              <button
                type="button"
                className="od-editable"
                onClick={openDestinationEditor}
                aria-label="Edit destination"
              >
                <span className="od-route-city">{destination}</span>
                <Pencil size={11} className="od-editable-icon" />
              </button>
            ) : (
              <span className="od-route-city">{destination}</span>
            )}
          </div>
        </div>
      </div>

      {/* Finance row */}
      <div className="od-details-divider-h" />
      <div className="od-details-finance">
        <div className="od-finance-item">
          <Banknote size={14} />
          <span className="od-finance-label">COD</span>
          <EditableValue
            editable={editable}
            value={String(codAmount)}
            type="number"
            min={0}
            ariaLabel="COD amount"
            onCommit={(draft) => {
              const n = Number(draft);
              if (!Number.isFinite(n) || n < 0) return 'Enter a valid amount.';
              if (n === codAmount) return null;
              request({
                label: 'COD amount',
                oldDisplay: money(codAmount),
                newDisplay: money(n),
                patch: { codAmount: n },
              });
              return null;
            }}
          >
            <span className="od-finance-value">{money(codAmount)}</span>
          </EditableValue>
        </div>
        <div className="od-finance-item">
          <Banknote size={14} />
          <span className="od-finance-label">Item Value</span>
          <EditableValue
            editable={editable}
            value={String(itemValue)}
            type="number"
            min={0}
            ariaLabel="item value"
            onCommit={(draft) => {
              const n = Number(draft);
              if (!Number.isFinite(n) || n < 0) return 'Enter a valid amount.';
              if (n === itemValue) return null;
              request({
                label: 'Item value',
                oldDisplay: money(itemValue),
                newDisplay: money(n),
                patch: { itemValue: n },
              });
              return null;
            }}
          >
            <span className="od-finance-value">{money(itemValue)}</span>
          </EditableValue>
        </div>
        <div className="od-finance-item">
          <Truck size={14} />
          <span className="od-finance-label">Delivery</span>
          <span className="od-finance-value">{money(deliveryCharge)}</span>
        </div>
        <div className="od-finance-item">
          <Package size={14} />
          <span className="od-finance-label">Pieces</span>
          <EditableValue
            editable={editable}
            value={String(pieces)}
            type="number"
            min={1}
            step="1"
            ariaLabel="pieces"
            onCommit={(draft) => {
              const n = Number(draft);
              if (!Number.isInteger(n) || n < 1) return 'Enter a whole number ≥ 1.';
              if (n === pieces) return null;
              request({
                label: 'Pieces',
                oldDisplay: String(pieces),
                newDisplay: String(n),
                patch: { pieces: n },
              });
              return null;
            }}
          >
            <span className="od-finance-value">{pieces}</span>
          </EditableValue>
        </div>
        {(weightKg != null || editable) && (
          <div className="od-finance-item">
            <Package size={14} />
            <span className="od-finance-label">Weight</span>
            <EditableValue
              editable={editable}
              value={String(weightKg ?? '')}
              type="number"
              min={0.01}
              step="0.01"
              ariaLabel="weight in kg"
              onCommit={(draft) => {
                const n = Number(draft);
                if (!Number.isFinite(n) || n <= 0) return 'Enter a positive weight.';
                if (n === weightKg) return null;
                request({
                  label: 'Weight',
                  oldDisplay: weightKg != null ? `${weightKg} kg` : '—',
                  newDisplay: `${n} kg`,
                  patch: { weightKg: n },
                });
                return null;
              }}
            >
              <span className="od-finance-value">{weightKg != null ? `${weightKg} kg` : '—'}</span>
            </EditableValue>
          </div>
        )}
      </div>

      {pending && (
        <div className="modal-overlay" onClick={cancel}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Confirm change</h2>
            </div>
            <p className="modal-desc">
              {pending.label}: <strong>{pending.oldDisplay}</strong> → <strong>{pending.newDisplay}</strong>
            </p>
            {error && <p className="error-text">{error}</p>}
            <div className="modal-footer">
              <Button type="button" variant="secondary" onClick={cancel} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={confirm} disabled={saving}>
                {saving ? 'Saving…' : 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderInfoCards;
