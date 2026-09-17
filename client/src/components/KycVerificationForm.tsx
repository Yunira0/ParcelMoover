import React, { useState } from 'react';
import { Files, Landmark, Receipt, Store, User } from 'lucide-react';
import FormField from './FormField';
import FileField from './FileField';
import Banner from './Banner';
import Button from './Button';
import './KycVerificationForm.css';

export type KycVerificationValues = Record<
  'onlineBusinessName' | 'pickupLocation' | 'pickupLandmark' | 'businessContact' |
  'ownerName' | 'ownerEmail' | 'ownerContact' | 'billingBusinessName' |
  'registeredAddress' | 'registrationNo' | 'panVatNo' |
  'bankName' | 'bankAccountNo' | 'bankAccountHolder',
  string
>;

export interface KycVerificationFiles {
  citizenship: File | null;
  panVat: File | null;
  businessCert: File | null;
}

interface KycVerificationFormProps {
  /** Account prefill — the starting point staff or the vendor edits by hand. */
  initial: KycVerificationValues;
  docsOnFile: { citizenship: boolean; panVat: boolean; businessCert: boolean };
  /** Vendors can't re-assert their own identity email; staff correcting a profile can. */
  emailLocked: boolean;
  submitting: boolean;
  error: string;
  submitLabel: string;
  onSubmit: (values: KycVerificationValues, files: KycVerificationFiles) => void;
  onCancel: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One manually filled verification form for both sides: the vendor's own
// modal and the staff start page share every field, section, and validation
// message, so the two paths can't drift apart.
const KycVerificationForm: React.FC<KycVerificationFormProps> = ({
  initial, docsOnFile, emailLocked, submitting, error, submitLabel, onSubmit, onCancel,
}) => {
  const [values, setValues] = useState<KycVerificationValues>(initial);
  const [files, setFiles] = useState<KycVerificationFiles>({ citizenship: null, panVat: null, businessCert: null });
  const [formError, setFormError] = useState('');

  const set = (key: keyof KycVerificationValues) => (value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
    if (formError) setFormError('');
  };
  const setFile = (key: keyof KycVerificationFiles) => (file: File | null) =>
    setFiles(prev => ({ ...prev, [key]: file }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.onlineBusinessName.trim()) return setFormError('Business name is required.');
    if (!values.pickupLocation.trim()) return setFormError('Pickup location is required.');
    if (!values.businessContact.trim()) return setFormError('Business contact is required.');
    if (!values.ownerName.trim()) return setFormError('Owner name is required.');
    if (!values.ownerEmail.trim()) return setFormError('Email is required.');
    if (!EMAIL_RE.test(values.ownerEmail.trim())) return setFormError('Enter a valid email address.');
    if (!values.ownerContact.trim()) return setFormError('Owner contact is required.');
    if (!docsOnFile.citizenship && !files.citizenship) return setFormError('Citizenship document is required.');
    setFormError('');
    onSubmit(values, files);
  };

  // Recognition over recall: the reviewer sees document readiness without
  // opening each upload slot — on-file copies count alongside new picks.
  const docsReady = [
    docsOnFile.citizenship || files.citizenship,
    docsOnFile.panVat || files.panVat,
    docsOnFile.businessCert || files.businessCert,
  ].filter(Boolean).length;

  return (
    <form className="kyc-verify-form" onSubmit={handleSubmit}>
      <Banner tone="info">Blanks keep the on-file values — only the fields you change are updated.</Banner>

      <section className="kyc-section" aria-labelledby="kyc-business">
        <div className="kyc-section-head">
          <h2 id="kyc-business"><Store size={16} aria-hidden="true" /> Business details</h2>
          <p>Storefront identity and where riders pick up.</p>
        </div>
        <div className="kyc-grid">
          <FormField label="Online business name" required value={values.onlineBusinessName} onChange={set('onlineBusinessName')} />
          <FormField label="Business contact" required value={values.businessContact} onChange={set('businessContact')} placeholder="98XXXXXXXX" />
          <FormField label="Pickup location" required value={values.pickupLocation} onChange={set('pickupLocation')} gridColumn="1 / -1" />
          <FormField label="Pickup landmark" value={values.pickupLandmark} onChange={set('pickupLandmark')} />
        </div>
      </section>

      <section className="kyc-section" aria-labelledby="kyc-owner">
        <div className="kyc-section-head">
          <h2 id="kyc-owner"><User size={16} aria-hidden="true" /> Owner &amp; contact</h2>
          <p>Who is accountable for this vendor.</p>
        </div>
        <div className="kyc-grid">
          <FormField label="Owner name" required value={values.ownerName} onChange={set('ownerName')} />
          <FormField label="Owner contact" required value={values.ownerContact} onChange={set('ownerContact')} placeholder="98XXXXXXXX" />
          <FormField
            label="Owner email"
            required
            type="email"
            value={values.ownerEmail}
            onChange={set('ownerEmail')}
            disabled={emailLocked}
            hint={emailLocked ? 'Locked to your account' : undefined}
            gridColumn="1 / -1"
          />
        </div>
      </section>

      <section className="kyc-section" aria-labelledby="kyc-billing">
        <div className="kyc-section-head">
          <h2 id="kyc-billing"><Receipt size={16} aria-hidden="true" /> Billing details</h2>
          <p>Legal entity used on settlements — optional until payout.</p>
        </div>
        <div className="kyc-grid">
          <FormField label="Billing business name" value={values.billingBusinessName} onChange={set('billingBusinessName')} />
          <FormField label="Registration no." value={values.registrationNo} onChange={set('registrationNo')} />
          <FormField label="PAN / VAT no." value={values.panVatNo} onChange={set('panVatNo')} />
          <FormField label="Registered address" value={values.registeredAddress} onChange={set('registeredAddress')} gridColumn="1 / -1" />
        </div>
      </section>

      <section className="kyc-section" aria-labelledby="kyc-bank">
        <div className="kyc-section-head">
          <h2 id="kyc-bank"><Landmark size={16} aria-hidden="true" /> Bank details</h2>
          <p>Where COD settlements are paid — optional until payout.</p>
        </div>
        <div className="kyc-grid">
          <FormField label="Bank name" value={values.bankName} onChange={set('bankName')} />
          <FormField label="Account holder" value={values.bankAccountHolder} onChange={set('bankAccountHolder')} />
          <FormField label="Account no." value={values.bankAccountNo} onChange={set('bankAccountNo')} gridColumn="1 / -1" />
        </div>
      </section>

      <section className="kyc-section" aria-labelledby="kyc-documents">
        <div className="kyc-section-head kyc-section-head-split">
          <div>
            <h2 id="kyc-documents"><Files size={16} aria-hidden="true" /> Documents</h2>
            <p>Citizenship is required unless already on file. The rest are optional.</p>
          </div>
          <span className="kyc-doc-count" aria-live="polite">{docsReady} of 3 ready</span>
        </div>
        <div className="kyc-grid">
          <FileField
            label={docsOnFile.citizenship ? 'Citizenship (on file — replace)' : 'Citizenship *'}
            hint="JPG, PNG, WebP or PDF · max 5 MB"
            file={files.citizenship}
            onChange={setFile('citizenship')}
          />
          <FileField
            label={docsOnFile.panVat ? 'PAN / VAT (on file — replace)' : 'PAN / VAT (optional)'}
            hint="JPG, PNG, WebP or PDF · max 5 MB"
            file={files.panVat}
            onChange={setFile('panVat')}
          />
          <FileField
            label={docsOnFile.businessCert ? 'Business certificate (on file — replace)' : 'Business certificate (optional)'}
            hint="JPG, PNG, WebP or PDF · max 5 MB"
            file={files.businessCert}
            onChange={setFile('businessCert')}
          />
        </div>
      </section>

      {(formError || error) && (
        <div className="kyc-form-error">
          <Banner tone="danger">{formError || error}</Banner>
        </div>
      )}
      <div className="kyc-form-footer">
        <p className="kyc-form-footer-hint">Submitting sends this to the KYC Applications queue for review.</p>
        <div className="kyc-form-footer-actions">
          <Button variant="secondary" type="button" onClick={onCancel} disabled={submitting}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? 'Submitting…' : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
};

export default KycVerificationForm;
