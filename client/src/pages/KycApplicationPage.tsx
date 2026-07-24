import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, ChevronRight, ChevronLeft, Upload, X } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import { submitKycApplication, type KycApplicationInput } from '../services/kyc.service';
import { hasLetter, isValidEmail, isValidName, isValidPhone } from '../utils/serverValidation';
import './KycApplicationPage.css';

const STEPS = ['Business', 'Owner & Bank', 'Documents'];

const emptyForm = (): KycApplicationInput => ({
  onlineBusinessName: '',
  pickupLocation: '',
  pickupLandmark: '',
  businessContact: '',
  ownerName: '',
  ownerEmail: '',
  ownerContact: '',
  billingBusinessName: '',
  registeredAddress: '',
  registrationNo: '',
  panVatNo: '',
  citizenshipDoc: null,
  panVatDoc: null,
  businessCertDoc: null,
  bankName: '',
  bankAccountNo: '',
  bankAccountHolder: '',
});

// Minimal file picker (FormField has no file type); optional documents.
const FileField: React.FC<{
  label: string;
  file: File | null | undefined;
  onChange: (f: File | null) => void;
  required?: boolean;
}> = ({ label, file, onChange, required }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="kyc-file-field">
      <span className="kyc-file-label">
        {label}
        {required && <span className="required"> *</span>}
      </span>
      {file ? (
        <div className="kyc-file-chip">
          <span>{file.name}</span>
          <button type="button" onClick={() => onChange(null)} aria-label="Remove">
            <X size={14} />
          </button>
        </div>
      ) : (
        <button type="button" className="kyc-file-btn" onClick={() => ref.current?.click()}>
          <Upload size={15} /> Upload
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*,.pdf"
        style={{ display: 'none' }}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </div>
  );
};

const KycApplicationPage: React.FC = () => {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<KycApplicationInput>(emptyForm());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const set = (field: keyof KycApplicationInput) => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));
  const setFile = (field: keyof KycApplicationInput) => (file: File | null) =>
    setForm((prev) => ({ ...prev, [field]: file }));

  const validateStep = (): string => {
    if (step === 0) {
      if (!form.onlineBusinessName.trim()) return 'Business name is required';
      if (!hasLetter(form.onlineBusinessName)) return 'Business name must contain letters';
      if (!form.pickupLocation.trim()) return 'Pickup location is required';
      if (!form.businessContact.trim()) return 'Business contact is required';
      if (!isValidPhone(form.businessContact)) return 'Enter a valid Nepali mobile number (e.g. 98XXXXXXXX)';
    }
    if (step === 1) {
      if (!form.ownerName.trim()) return 'Owner name is required';
      if (!isValidName(form.ownerName)) return "Enter a valid name (letters, spaces, . ' - only)";
      if (!form.ownerEmail.trim()) return 'Email is required';
      if (!isValidEmail(form.ownerEmail)) return 'Enter a valid email address';
      if (!form.ownerContact.trim()) return 'Contact number is required';
      if (!isValidPhone(form.ownerContact)) return 'Enter a valid Nepali mobile number (e.g. 98XXXXXXXX)';
    }
    if (step === 2) {
      if (!form.citizenshipDoc) return 'Citizenship document is required';
    }
    return '';
  };

  const handleNext = () => {
    const err = validateStep();
    if (err) { setError(err); return; }
    setError('');
    setStep((s) => s + 1);
  };

  const handleBack = () => {
    setError('');
    setStep((s) => s - 1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Pressing Enter in a field fires the browser's implicit form submission
    // even though earlier steps render no submit button — advance the wizard
    // (with validation) instead of submitting the application early.
    if (step < STEPS.length - 1) {
      handleNext();
      return;
    }
    const err = validateStep();
    if (err) { setError(err); return; }
    setLoading(true);
    setError('');
    try {
      await submitKycApplication(form);
      setSubmitted(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to submit application. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="kyc-page">
        <div className="kyc-success">
          <CheckCircle size={56} className="kyc-success-icon" />
          <h2>Application Submitted!</h2>
          <p>
            Thank you, <strong>{form.ownerName}</strong>. Your KYC application for{' '}
            <strong>{form.onlineBusinessName}</strong> has been received.
          </p>
          <p>Our team will review it and send the login credentials to <strong>{form.ownerEmail}</strong> once approved.</p>
          <Link to="/">
            <Button variant="primary">Back to Home</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="kyc-page">
      <div className="kyc-container">
        <div className="kyc-header">
          <Link to="/" className="kyc-logo">ParcelMoover</Link>
          <h1>Vendor KYC Application</h1>
          <p>Fill in your details to apply as a delivery vendor partner.</p>
        </div>

        {/* Step indicator */}
        <div className="kyc-steps">
          {STEPS.map((label, i) => (
            <React.Fragment key={label}>
              <div className={`kyc-step ${i < step ? 'done' : i === step ? 'active' : ''}`}>
                <div className="kyc-step-circle">
                  {i < step ? <CheckCircle size={16} /> : <span>{i + 1}</span>}
                </div>
                <span className="kyc-step-label">{label}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`kyc-step-line ${i < step ? 'done' : ''}`} />}
            </React.Fragment>
          ))}
        </div>

        <form className="kyc-form" onSubmit={handleSubmit}>
          {step === 0 && (
            <div className="kyc-section">
              <h3>Business Information</h3>
              <div className="kyc-grid">
                <FormField
                  label="Online Business Name"
                  required
                  value={form.onlineBusinessName}
                  onChange={set('onlineBusinessName')}
                  placeholder="e.g. Nepal Traders"
                />
                <FormField
                  label="Business Contact"
                  required
                  value={form.businessContact}
                  onChange={set('businessContact')}
                  placeholder="e.g. 9800000000"
                />
                <FormField
                  label="Pickup Location"
                  required
                  value={form.pickupLocation}
                  onChange={set('pickupLocation')}
                  placeholder="City / area parcels are picked up from"
                />
                <FormField
                  label="Pickup Landmark"
                  value={form.pickupLandmark ?? ''}
                  onChange={set('pickupLandmark')}
                  placeholder="Nearby landmark"
                />
                <FormField
                  label="Billing Business Name"
                  value={form.billingBusinessName ?? ''}
                  onChange={set('billingBusinessName')}
                  placeholder="Registered/legal business name"
                />
                <FormField
                  label="Registration No."
                  value={form.registrationNo ?? ''}
                  onChange={set('registrationNo')}
                  placeholder="Company registration number"
                />
                <FormField
                  label="PAN / VAT Number"
                  value={form.panVatNo ?? ''}
                  onChange={set('panVatNo')}
                  placeholder="e.g. 123456789"
                />
                <FormField
                  label="Registered Address"
                  value={form.registeredAddress ?? ''}
                  onChange={set('registeredAddress')}
                  placeholder="Street / Tole / Ward, City"
                  gridColumn="span 2"
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="kyc-section">
              <h3>Owner &amp; Bank Details</h3>
              <div className="kyc-grid">
                <FormField
                  label="Owner Full Name"
                  required
                  value={form.ownerName}
                  onChange={set('ownerName')}
                  placeholder="As on government ID"
                />
                <FormField
                  label="Owner Email"
                  type="email"
                  required
                  value={form.ownerEmail}
                  onChange={set('ownerEmail')}
                  placeholder="Your login email"
                />
                <FormField
                  label="Owner Contact"
                  required
                  value={form.ownerContact}
                  onChange={set('ownerContact')}
                  placeholder="e.g. 9800000000"
                />
                <FormField
                  label="Bank Name"
                  value={form.bankName ?? ''}
                  onChange={set('bankName')}
                  placeholder="e.g. Nabil Bank"
                />
                <FormField
                  label="Bank Account No."
                  value={form.bankAccountNo ?? ''}
                  onChange={set('bankAccountNo')}
                  placeholder="Account number"
                />
                <FormField
                  label="Account Holder Name"
                  value={form.bankAccountHolder ?? ''}
                  onChange={set('bankAccountHolder')}
                  placeholder="Name as on bank account"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="kyc-section">
              <h3>Documents &amp; Review</h3>
              <div className="kyc-grid">
                <FileField label="Citizenship" required file={form.citizenshipDoc} onChange={setFile('citizenshipDoc')} />
                <FileField label="PAN / VAT Document" file={form.panVatDoc} onChange={setFile('panVatDoc')} />
                <FileField label="Business Certificate" file={form.businessCertDoc} onChange={setFile('businessCertDoc')} />
              </div>
              <div className="kyc-review">
                <div className="kyc-review-group">
                  <h4>Business</h4>
                  <ReviewRow label="Business Name" value={form.onlineBusinessName} />
                  <ReviewRow label="Contact" value={form.businessContact} />
                  <ReviewRow label="Pickup Location" value={form.pickupLocation} />
                  <ReviewRow label="PAN / VAT No." value={form.panVatNo || '—'} />
                </div>
                <div className="kyc-review-group">
                  <h4>Owner</h4>
                  <ReviewRow label="Owner Name" value={form.ownerName} />
                  <ReviewRow label="Email" value={form.ownerEmail} />
                  <ReviewRow label="Contact" value={form.ownerContact} />
                </div>
              </div>
              <p className="kyc-declaration">
                By submitting this application, I confirm that all information provided is accurate and complete.
                I understand that providing false information may result in the rejection of my application.
              </p>
            </div>
          )}

          {error && <p className="kyc-error">{error}</p>}

          <div className="kyc-actions">
            {step > 0 && (
              <Button type="button" variant="secondary" onClick={handleBack}>
                <ChevronLeft size={16} /> Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              // Distinct keys keep React from reusing one DOM <button> for
              // both actions: without them, clicking "Next" on the last
              // pre-review step re-renders the same element as type="submit"
              // while the click is still in flight, and the browser's default
              // click action then submits the form before the vendor ever
              // sees the documents step.
              <Button key="next" type="button" variant="primary" onClick={handleNext}>
                Next <ChevronRight size={16} />
              </Button>
            ) : (
              <Button key="submit" type="submit" variant="primary" disabled={loading}>
                {loading ? 'Submitting...' : 'Submit Application'}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

const ReviewRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="review-row">
    <span className="review-label">{label}</span>
    <span className="review-value">{value}</span>
  </div>
);

export default KycApplicationPage;
