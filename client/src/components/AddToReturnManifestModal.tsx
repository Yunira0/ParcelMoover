import React, { useEffect, useMemo, useState } from 'react';
import './Modal.css';
import './AddToReturnManifestModal.css';
import Button from './Button';
import { apiErrorMessage } from '../utils/serverValidation';
import {
  addParcelsToReturnManifest,
  createReturnManifest,
  getOpenReturnManifest,
  MAX_MANIFEST_PARCELS,
  type RejectedManifestParcel,
  type ReturnManifest,
} from '../services/returnManifests.service';
import type { Order } from '../services/orders.service';

interface AddToReturnManifestModalProps {
  isOpen: boolean;
  /** The operator's current selection, already narrowed to ready-to-return rows. */
  orders: Order[];
  onClose: () => void;
  /** Fired after parcels land on a manifest, so the page can reload. */
  onAdded: (message: string) => void;
}

/**
 * Puts a selection of ready-to-return parcels onto their vendor's manifest.
 *
 * A manifest holds exactly one vendor's parcels, so the first thing this does is
 * check the selection against that rule and say plainly which vendors are in
 * play — refusing on submit after the operator has ticked forty rows would be
 * the worse half of the same conversation. Once there is a single vendor, it
 * looks up their open manifest (there can only be one) and either adds to it or
 * offers to open the first.
 */
const AddToReturnManifestModal: React.FC<AddToReturnManifestModalProps> = ({
  isOpen,
  orders,
  onClose,
  onAdded,
}) => {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openManifest, setOpenManifest] = useState<ReturnManifest | null>(null);
  const [rejected, setRejected] = useState<RejectedManifestParcel[]>([]);

  // Vendorless parcels can never be manifested — there is nobody to return them
  // to — so they are their own group rather than being lumped in as "unknown".
  const { vendorGroups, vendorlessCount } = useMemo(() => {
    const groups = new Map<string, { vendorId: string; vendorName: string; orders: Order[] }>();
    let vendorless = 0;
    for (const order of orders) {
      if (!order.vendorId) {
        vendorless += 1;
        continue;
      }
      const group = groups.get(order.vendorId);
      if (group) group.orders.push(order);
      else groups.set(order.vendorId, {
        vendorId: order.vendorId,
        vendorName: order.vendorName || order.senderName || 'Unnamed vendor',
        orders: [order],
      });
    }
    return { vendorGroups: Array.from(groups.values()), vendorlessCount: vendorless };
  }, [orders]);

  const singleVendor = vendorGroups.length === 1 ? vendorGroups[0] : null;

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setRejected([]);
    setOpenManifest(null);
    if (!singleVendor) return;

    setLoading(true);
    getOpenReturnManifest(singleVendor.vendorId)
      .then((res) => {
        if (res?.success) setOpenManifest(res.data);
      })
      .catch((err) => setError(apiErrorMessage(err, 'Could not check this vendor for an open manifest.')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, singleVendor?.vendorId]);

  if (!isOpen) return null;

  const parcelIds = singleVendor ? singleVendor.orders.map((o) => o.id) : [];
  const wouldHold = (openManifest?.parcelCount ?? 0) + parcelIds.length;
  const overCapacity = wouldHold > MAX_MANIFEST_PARCELS;

  const addToManifest = async (manifestId: string) => {
    setBusy(true);
    setError('');
    setRejected([]);
    try {
      const res = await addParcelsToReturnManifest(manifestId, parcelIds);
      if (res.data.rejected.length > 0) {
        // Some landed, some didn't — keep the modal open so the operator can
        // read which, but the page still needs to reflect the ones that did.
        setRejected(res.data.rejected);
        setOpenManifest(res.data.manifest);
        onAdded(res.message);
      } else {
        onAdded(`${res.data.added} parcel${res.data.added === 1 ? '' : 's'} added to ${res.data.manifest.manifestNo}.`);
        onClose();
      }
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to add the parcels to the manifest.'));
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    if (!singleVendor) return;
    setBusy(true);
    setError('');
    try {
      const created = await createReturnManifest(singleVendor.vendorId);
      await addToManifest(created.data.id);
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to open a manifest for this vendor.'));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add to return manifest</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose} type="button">
            &times;
          </Button>
        </div>

        {vendorGroups.length === 0 && (
          <p className="modal-desc">
            {vendorlessCount > 0
              ? `None of the ${vendorlessCount} selected order${vendorlessCount === 1 ? '' : 's'} has a vendor, so there is nobody to return ${vendorlessCount === 1 ? 'it' : 'them'} to.`
              : 'Select one or more ready-to-return orders first.'}
          </p>
        )}

        {vendorGroups.length > 1 && (
          <>
            <p className="modal-desc">
              A manifest holds one vendor's parcels. Your selection spans {vendorGroups.length} vendors —
              select one vendor's orders at a time.
            </p>
            <ul className="manifest-vendor-breakdown">
              {vendorGroups.map((group) => (
                <li key={group.vendorId}>
                  <span>{group.vendorName}</span>
                  <span>{group.orders.length} parcel{group.orders.length === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {singleVendor && (
          <>
            <p className="modal-desc">
              {parcelIds.length} parcel{parcelIds.length === 1 ? '' : 's'} for <strong>{singleVendor.vendorName}</strong>.
            </p>

            {loading && <p className="modal-desc">Checking for an open manifest…</p>}

            {!loading && openManifest && (
              <div className="manifest-summary">
                <div className="manifest-summary-row">
                  <span>Open manifest</span>
                  <strong>{openManifest.manifestNo}</strong>
                </div>
                <div className="manifest-summary-row">
                  <span>Already holds</span>
                  <strong>{openManifest.parcelCount} parcel{openManifest.parcelCount === 1 ? '' : 's'}</strong>
                </div>
                <div className="manifest-summary-row">
                  <span>After adding</span>
                  <strong>{wouldHold} of {MAX_MANIFEST_PARCELS}</strong>
                </div>
              </div>
            )}

            {!loading && !openManifest && (
              <p className="modal-desc">
                This vendor has no open manifest. Opening one starts a batch you can keep adding to until
                a rider takes it back to them.
              </p>
            )}

            {overCapacity && (
              <p className="error-text">
                A manifest holds at most {MAX_MANIFEST_PARCELS} parcels. Send {openManifest?.manifestNo} first,
                then start a new one.
              </p>
            )}
          </>
        )}

        {vendorlessCount > 0 && vendorGroups.length > 0 && (
          <p className="modal-desc manifest-note">
            {vendorlessCount} selected order{vendorlessCount === 1 ? ' has' : 's have'} no vendor and will be skipped.
          </p>
        )}

        {rejected.length > 0 && (
          <ul className="manifest-rejected">
            {rejected.map((row) => (
              <li key={row.parcelId}>
                <strong>{row.trackingId || row.parcelId}</strong> — {row.reason}
              </li>
            ))}
          </ul>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="modal-footer">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            {rejected.length > 0 ? 'Done' : 'Cancel'}
          </Button>
          {singleVendor && openManifest && (
            <Button
              type="button"
              variant="primary"
              onClick={() => addToManifest(openManifest.id)}
              disabled={busy || loading || overCapacity}
            >
              {busy ? 'Adding…' : `Add to ${openManifest.manifestNo}`}
            </Button>
          )}
          {singleVendor && !openManifest && !loading && (
            <Button type="button" variant="primary" onClick={createAndAdd} disabled={busy || overCapacity}>
              {busy ? 'Opening…' : 'Open manifest & add'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddToReturnManifestModal;
