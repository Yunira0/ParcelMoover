import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, ChevronRight, ChevronLeft } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import { submitKycApplication, type KycApplicationInput } from '../services/kyc.service';
import './KycApplicationPage.css';

const STEPS = ['Business Info', 'Owner & ID', 'Review'];

const BUSINESS_TYPES = [
  { value: 'ecommerce', label: 'E-Commerce' },
  { value: 'retail', label: 'Retail' },
  { value: 'wholesale', label: 'Wholesale' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'services', label: 'Services' },
  { value: 'other', label: 'Other' },
];

const SHIPMENT_ESTIMATES = [
  { value: '1-50', label: '1 – 50 parcels/month' },
  { value: '51-200', label: '51 – 200 parcels/month' },
  { value: '201-500', label: '201 – 500 parcels/month' },
  { value: '501-1000', label: '501 – 1,000 parcels/month' },
  { value: '1000+', label: '1,000+ parcels/month' },
];

const ID_TYPES = [
  { value: 'citizenship', label: 'Citizenship Card' },
  { value: 'passport', label: 'Passport' },
  { value: 'driving_license', label: 'Driving License' },
];

const emptyForm = (): KycApplicationInput => ({
  businessName: '',
  ownerName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  businessType: '',
  panVatNo: '',
  idType: 'citizenship',
  idNumber: '',
  website: '',
  monthlyShipmentEstimate: '',
  description: '',
});

const KycApplicationPage: React.FC = () => {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<KycApplicationInput>(emptyForm());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const set = (field: keyof KycApplicationInput) => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const validateStep = (): string => {
    if (step === 0) {
      if (!form.businessName.trim()) return 'Business name is required';
      if (!form.address.trim()) return 'Business address is required';
      if (!form.city.trim()) return 'City / District is required';
    }
    if (step === 1) {
      if (!form.ownerName.trim()) return 'Owner name is required';
      if (!form.email.trim()) return 'Email is required';
      if (!form.phone.trim()) return 'Phone number is required';
      if (!form.idNumber.trim()) return 'ID number is required';
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
            <strong>{form.businessName}</strong> has been received.
          </p>
          <p>Our team will review it and send the login credentials to <strong>{form.email}</strong> once approved.</p>
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
                  label="Business Name"
                  required
                  value={form.businessName}
                  onChange={set('businessName')}
                  placeholder="e.g. Nepal Traders Pvt. Ltd."
                />
                <FormField
                  label="Business Type"
                  type="select"
                  value={form.businessType}
                  onChange={set('businessType')}
                  options={BUSINESS_TYPES}
                  placeholder="Select type"
                />
                <FormField
                  label="PAN / VAT Number"
                  value={form.panVatNo}
                  onChange={set('panVatNo')}
                  placeholder="e.g. 123456789"
                />
                <FormField
                  label="Monthly Shipment Volume"
                  type="select"
                  value={form.monthlyShipmentEstimate}
                  onChange={set('monthlyShipmentEstimate')}
                  options={SHIPMENT_ESTIMATES}
                  placeholder="Select estimate"
                />
                <FormField
                  label="Business Address"
                  required
                  value={form.address}
                  onChange={set('address')}
                  placeholder="Street / Tole / Ward"
                />
                <FormField
                  label="City / District"
                  required
                  value={form.city}
                  onChange={set('city')}
                  placeholder="e.g. Kathmandu"
                />
                <FormField
                  label="Website (optional)"
                  value={form.website}
                  onChange={set('website')}
                  placeholder="https://example.com"
                  gridColumn="span 2"
                />
                <FormField
                  label="About Your Business"
                  type="textarea"
                  value={form.description}
                  onChange={set('description')}
                  placeholder="Brief description of your business and what you'll be shipping..."
                  rows={3}
                  gridColumn="span 2"
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="kyc-section">
              <h3>Owner & Identity Information</h3>
              <div className="kyc-grid">
                <FormField
                  label="Owner Full Name"
                  required
                  value={form.ownerName}
                  onChange={set('ownerName')}
                  placeholder="As on government ID"
                />
                <FormField
                  label="Email Address"
                  type="email"
                  required
                  value={form.email}
                  onChange={set('email')}
                  placeholder="Your login email"
                />
                <FormField
                  label="Phone Number"
                  required
                  value={form.phone}
                  onChange={set('phone')}
                  placeholder="e.g. 9800000000"
                />
                <FormField
                  label="ID Type"
                  type="select"
                  required
                  value={form.idType}
                  onChange={set('idType')}
                  options={ID_TYPES}
                />
                <FormField
                  label="ID Number"
                  required
                  value={form.idNumber}
                  onChange={set('idNumber')}
                  placeholder="ID document number"
                  gridColumn="span 2"
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="kyc-section">
              <h3>Review Your Application</h3>
              <div className="kyc-review">
                <div className="kyc-review-group">
                  <h4>Business Information</h4>
                  <ReviewRow label="Business Name" value={form.businessName} />
                  <ReviewRow label="Business Type" value={BUSINESS_TYPES.find(b => b.value === form.businessType)?.label || '—'} />
                  <ReviewRow label="PAN / VAT No." value={form.panVatNo || '—'} />
                  <ReviewRow label="Address" value={`${form.address}, ${form.city}`} />
                  <ReviewRow label="Monthly Volume" value={SHIPMENT_ESTIMATES.find(s => s.value === form.monthlyShipmentEstimate)?.label || '—'} />
                  {form.website && <ReviewRow label="Website" value={form.website} />}
                  {form.description && <ReviewRow label="Description" value={form.description} />}
                </div>
                <div className="kyc-review-group">
                  <h4>Owner Information</h4>
                  <ReviewRow label="Owner Name" value={form.ownerName} />
                  <ReviewRow label="Email" value={form.email} />
                  <ReviewRow label="Phone" value={form.phone} />
                  <ReviewRow label="ID Type" value={ID_TYPES.find(t => t.value === form.idType)?.label || form.idType} />
                  <ReviewRow label="ID Number" value={form.idNumber} />
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
              <Button type="button" variant="primary" onClick={handleNext}>
                Next <ChevronRight size={16} />
              </Button>
            ) : (
              <Button type="submit" variant="primary" disabled={loading}>
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
