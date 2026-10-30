import React, { useEffect, useState } from 'react';
import Button from './Button';
import { getManagedUser } from '../services/users.service';
import { toBsDate } from '../utils/nepaliDate';
import { SkeletonList } from './Skeleton';
import './Modal.css';
import './VendorDetailsModal.css';

// Read-only view of a vendor for accounts that can't edit one (accountants):
// who they are, how they're billed, and where their COD is paid out.

interface VendorDetailsModalProps {
  isOpen: boolean;
  target: { id: string; name: string } | null;
  onClose: () => void;
}

type VendorDetail = Record<string, string | number | null | undefined>;

const RATE_FIELDS: [key: string, label: string][] = [
  ['flatInsideValley', 'Inside valley'],
  ['flatOutsideValley', 'Outside valley'],
  ['flatOutsideRingRoad', 'Outside ring road'],
  ['zoneInsideValley', 'Zone: inside valley'],
  ['zoneMajorCities', 'Zone: major cities'],
  ['zoneUrbanAreas', 'Zone: urban areas'],
  ['zoneRemoteAreas', 'Zone: remote areas'],
  ['extraWeightPercent', 'Extra weight (%)'],
  ['returnInsideValleyPercent', 'Return inside valley (%)'],
  ['returnOutsideValleyPercent', 'Return outside valley (%)'],
];

const text = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

const VendorDetailsModal: React.FC<VendorDetailsModalProps> = ({ isOpen, target, onClose }) => {
  const [detail, setDetail] = useState<VendorDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const targetId = target?.id ?? null;

  useEffect(() => {
    if (!isOpen || !targetId) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setDetail(null);
    getManagedUser('vendor', targetId)
      .then((res) => {
        if (cancelled) return;
        if (res?.success && res.data) setDetail(res.data);
        else setError(res?.message || 'Failed to load vendor details.');
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.response?.data?.message || 'Failed to load vendor details.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, targetId]);

  if (!isOpen || !target) return null;

  const section = (title: string, rows: [string, unknown][]) => (
    <section className="vendor-details-section">
      <h3>{title}</h3>
      <dl>
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt>{label}</dt>
            <dd>{text(value)}</dd>
          </React.Fragment>
        ))}
      </dl>
    </section>
  );

  // A vendor keeps both rate sets on file; only the active type's applies.
  const inactivePrefix = detail?.rateType === 'zone' ? 'flat' : 'zone';
  const rates = detail
    ? RATE_FIELDS.filter(([key]) => !key.startsWith(inactivePrefix) && detail[key] !== null && detail[key] !== undefined)
    : [];

  return (
    <div className="modal-overlay">
      <div className="modal-content vendor-details-modal">
        <div className="modal-header">
          <h2>{target.name}</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose} type="button">
            &times;
          </Button>
        </div>

        {loading ? (
          <SkeletonList rows={6} />
        ) : error ? (
          <p className="error-text">{error}</p>
        ) : detail ? (
          <>
            {section('Vendor', [
              ['Business name', detail.businessName],
              ['Owner', detail.clientName],
              ['Phone', detail.phone],
              ['Email', detail.email],
              ['Address', detail.address],
              ['Pickup landmark', detail.pickupLandmark],
              ['Sales rep', detail.sales],
              ['Joined', toBsDate(String(detail.joinedAt ?? '')) || null],
            ])}
            {section('Billing', [
              ['Billing name', detail.billingBusinessName],
              ['PAN / VAT no.', detail.panVatNo],
              ['Registration no.', detail.registrationNo],
            ])}
            {section('COD payout bank', [
              ['Bank', detail.bankName],
              ['Account no.', detail.bankAccountNo],
              ['Account holder', detail.bankAccountHolder],
            ])}
            {section(`Delivery rates (${text(detail.rateType)})`, rates.length
              ? rates.map(([key, label]) => [label, detail[key]])
              : [['Rates', null]])}
          </>
        ) : null}

        <div className="modal-footer">
          <Button variant="outline" onClick={onClose} type="button">Close</Button>
        </div>
      </div>
    </div>
  );
};

export default VendorDetailsModal;
