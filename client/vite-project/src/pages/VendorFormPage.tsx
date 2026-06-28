import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Upload, X, Building2, User, FileText, CreditCard, Lock } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import { registerUser, getLocations } from '../services/users.service';
import './VendorFormPage.css';

interface VendorFormInput {
  onlineBusinessName: string;
  pickupLocation: string;
  pickupLandmark: string;
  businessContact: string;
  ownerName: string;
  ownerEmail: string;
  ownerContact: string;
  billingBusinessName: string;
  registeredAddress: string;
  registrationNo: string;
  panVatNo: string;
  citizenshipDoc: File | null;
  panVatDoc: File | null;
  businessCertDoc: File | null;
  bankName: string;
  bankAccountNo: string;
  bankAccountHolder: string;
  password: string;
}

const emptyForm: VendorFormInput = {
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
  password: '',
};

const FileInput: React.FC<{
  label: string;
  required?: boolean;
  file: File | null | undefined;
  onChange: (file: File | null) => void;
  accept?: string;
}> = ({ label, required, file, onChange, accept = 'image/*,.pdf' }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="vfp-file-field">
      <label className="vfp-file-label">
        {label}{required && <span className="vfp-required"> *</span>}
      </label>
      {file ? (
        <div className="vfp-file-chip">
          <FileText size={14} />
          <span>{file.name}</span>
          <button type="button" onClick={() => onChange(null)} aria-label="Remove file">
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="vfp-file-btn"
          onClick={() => ref.current?.click()}
        >
          <Upload size={15} /> Choose file
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      <span className="vfp-file-hint">JPG, PNG or PDF · max 5 MB</span>
    </div>
  );
};

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
}> = ({ icon, title, description }) => (
  <div className="vfp-section-header">
    <div className="vfp-section-icon">{icon}</div>
    <div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  </div>
);

const VendorFormPage: React.FC = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState<VendorFormInput>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [locations, setLocations] = useState<Array<{ value: string; label: string }>>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const res = await getLocations();
        if (res && res.success && Array.isArray(res.data)) {
          setLocations(res.data.map((loc: any) => ({ value: loc.id, label: loc.name })));
        }
      } catch (err) {
        console.error('Failed to load locations:', err);
      }
    };
    fetchLocations();
  }, []);

  const set = (field: keyof VendorFormInput) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const setFile = (field: keyof VendorFormInput) => (file: File | null) =>
    setForm((prev) => ({ ...prev, [field]: file }));

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!form.onlineBusinessName.trim()) errors.onlineBusinessName = 'Business name is required';
    if (!form.pickupLocation.trim()) errors.pickupLocation = 'Location is required';
    if (!form.businessContact.trim()) errors.businessContact = 'Contact number is required';
    if (!form.ownerName.trim()) errors.ownerName = 'Owner name is required';
    if (!form.ownerEmail.trim()) errors.ownerEmail = 'Email is required';
    if (!form.ownerContact.trim()) errors.ownerContact = 'Contact number is required';
    if (!form.billingBusinessName.trim()) errors.billingBusinessName = 'Business name is required';
    if (!form.registeredAddress.trim()) errors.registeredAddress = 'Address is required';
    if (!form.password.trim()) errors.password = 'Password is required';
    else if (form.password.length < 8) errors.password = 'Min. 8 characters';
    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLoading(false);
      const firstError = document.querySelector('.vfp-field-error');
      firstError?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    try {
      await registerUser({
        type: 'vendor',
        fullName: form.ownerName,
        email: form.ownerEmail,
        password: form.password,
        phone: form.ownerContact,
        clientName: form.ownerName,
        businessName: form.onlineBusinessName,
        locationId: form.pickupLocation,
        address: form.registeredAddress,
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create vendor. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="vfp-page">
        <button type="button" className="vfp-back" onClick={() => navigate('/vendors')}>
          <ArrowLeft size={15} />
          Vendor List
        </button>
        <div className="vfp-success-card">
          <div className="vfp-success-icon-wrap">
            <CheckCircle size={48} />
          </div>
          <h3>Vendor Created Successfully!</h3>
          <p>Vendor <strong>{form.ownerName}</strong> has been created.</p>
          <p className="vfp-success-hint">Login credentials will be sent to <strong>{form.ownerEmail}</strong></p>
          <div className="vfp-success-actions">
            <Button variant="secondary" onClick={() => { setSubmitted(false); setForm(emptyForm); }}>
              Create Another
            </Button>
            <Button variant="primary" onClick={() => navigate('/vendors')}>
              Back to List
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="vfp-page">
      <button type="button" className="vfp-back" onClick={() => navigate('/vendors')}>
        <ArrowLeft size={15} />
        Vendor List
      </button>

      <div className="vfp-header">
        <h1>Add New Vendor</h1>
        <p>Complete the registration form below to create a new vendor account.</p>
      </div>

      <form className="vfp-form" onSubmit={handleSubmit} noValidate>
        <div className="vfp-body">
          {/* Left Column - Main Fields */}
          <div className="vfp-left">
            {/* Business Details */}
            <section className="vfp-section">
              <SectionHeader
                icon={<Building2 size={18} />}
                title="Business Details"
                description="Basic business information"
              />
              <div className="vfp-fields">
                <FormField
                  label="Online Business Name"
                  required
                  value={form.onlineBusinessName}
                  onChange={set('onlineBusinessName')}
                  placeholder="e.g. Nepal Traders"
                />
                {fieldErrors.onlineBusinessName && (
                  <span className="vfp-field-error">{fieldErrors.onlineBusinessName}</span>
                )}
                <FormField
                  label="Pick Up Location"
                  type="select"
                  required
                  value={form.pickupLocation}
                  onChange={set('pickupLocation')}
                  placeholder="Select location"
                  options={locations}
                />
                {fieldErrors.pickupLocation && (
                  <span className="vfp-field-error">{fieldErrors.pickupLocation}</span>
                )}
                <FormField
                  label="Landmark"
                  value={form.pickupLandmark}
                  onChange={set('pickupLandmark')}
                  placeholder="Nearby landmark"
                />
                <FormField
                  label="Contact No."
                  required
                  value={form.businessContact}
                  onChange={set('businessContact')}
                  placeholder="e.g. 9800000000"
                />
                {fieldErrors.businessContact && (
                  <span className="vfp-field-error">{fieldErrors.businessContact}</span>
                )}
              </div>
            </section>

            {/* Owner Details */}
            <section className="vfp-section">
              <SectionHeader
                icon={<User size={18} />}
                title="Owner Details"
                description="Contact person information"
              />
              <div className="vfp-fields">
                <FormField
                  label="Name of Owner"
                  required
                  value={form.ownerName}
                  onChange={set('ownerName')}
                  placeholder="Full name as on ID"
                />
                {fieldErrors.ownerName && (
                  <span className="vfp-field-error">{fieldErrors.ownerName}</span>
                )}
                <FormField
                  label="Gmail Id"
                  type="email"
                  required
                  value={form.ownerEmail}
                  onChange={set('ownerEmail')}
                  placeholder="owner@gmail.com"
                />
                {fieldErrors.ownerEmail && (
                  <span className="vfp-field-error">{fieldErrors.ownerEmail}</span>
                )}
                <FormField
                  label="Contact No."
                  required
                  value={form.ownerContact}
                  onChange={set('ownerContact')}
                  placeholder="e.g. 9800000000"
                />
                {fieldErrors.ownerContact && (
                  <span className="vfp-field-error">{fieldErrors.ownerContact}</span>
                )}
              </div>
            </section>

            {/* Billing Details */}
            <section className="vfp-section">
              <SectionHeader
                icon={<FileText size={18} />}
                title="Billing Details"
                description="Business registration information"
              />
              <div className="vfp-fields">
                <FormField
                  label="Name of Business"
                  required
                  value={form.billingBusinessName}
                  onChange={set('billingBusinessName')}
                  placeholder="Registered business name"
                />
                {fieldErrors.billingBusinessName && (
                  <span className="vfp-field-error">{fieldErrors.billingBusinessName}</span>
                )}
                <FormField
                  label="Registered Address"
                  required
                  value={form.registeredAddress}
                  onChange={set('registeredAddress')}
                  placeholder="Official registered address"
                />
                {fieldErrors.registeredAddress && (
                  <span className="vfp-field-error">{fieldErrors.registeredAddress}</span>
                )}
                <FormField
                  label="Registration No."
                  value={form.registrationNo}
                  onChange={set('registrationNo')}
                  placeholder="Business registration number"
                />
                <FormField
                  label="PAN / VAT No."
                  value={form.panVatNo}
                  onChange={set('panVatNo')}
                  placeholder="PAN or VAT number"
                />
              </div>
            </section>
          </div>

          {/* Right Column - Documents & Bank */}
          <div className="vfp-right">
            {/* Documents */}
            <section className="vfp-section">
              <SectionHeader
                icon={<FileText size={18} />}
                title="Documents"
                description="Upload required documents"
              />
              <div className="vfp-docs">
                <FileInput
                  label="Citizenship of Owner"
                  file={form.citizenshipDoc}
                  onChange={setFile('citizenshipDoc')}
                />
                <FileInput
                  label="PAN / VAT Document"
                  file={form.panVatDoc}
                  onChange={setFile('panVatDoc')}
                />
                <FileInput
                  label="Business Certificate"
                  file={form.businessCertDoc}
                  onChange={setFile('businessCertDoc')}
                />
              </div>
            </section>

            {/* Bank Details */}
            <section className="vfp-section">
              <SectionHeader
                icon={<CreditCard size={18} />}
                title="Bank Details"
                description="Payment account information"
              />
              <div className="vfp-fields">
                <FormField
                  label="Name of Bank"
                  value={form.bankName}
                  onChange={set('bankName')}
                  placeholder="e.g. Nabil Bank"
                />
                <FormField
                  label="Account No."
                  value={form.bankAccountNo}
                  onChange={set('bankAccountNo')}
                  placeholder="Bank account number"
                />
                <FormField
                  label="Name of Account Holder"
                  value={form.bankAccountHolder}
                  onChange={set('bankAccountHolder')}
                  placeholder="Name as on bank account"
                />
              </div>
            </section>

            {/* Login Credentials */}
            <section className="vfp-section">
              <SectionHeader
                icon={<Lock size={18} />}
                title="Login Credentials"
                description="Account password"
              />
              <div className="vfp-fields">
                <FormField
                  label="Password"
                  type="password"
                  required
                  value={form.password}
                  onChange={set('password')}
                  placeholder="Min. 8 characters"
                />
                {fieldErrors.password && (
                  <span className="vfp-field-error">{fieldErrors.password}</span>
                )}
              </div>
              <p className="vfp-hint">Minimum 8 characters. Vendor can change password after logging in.</p>
            </section>
          </div>
        </div>

        {error && (
          <div className="vfp-error" role="alert">
            {error}
          </div>
        )}

        <div className="vfp-actions">
          <Button type="button" variant="secondary" onClick={() => navigate('/vendors')} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Creating...' : 'Create Vendor'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default VendorFormPage;
