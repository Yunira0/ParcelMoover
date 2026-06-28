import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Upload, X } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import { registerUser, getLocations } from '../services/users.service';
import './RiderFormPage.css';

interface RiderFormInput {
  fullName: string;
  email: string;
  password: string;
  phone: string;
  address: string;
  citizenship: string;
  locationId: string;
  licenceNo: string;
  citizenshipDoc: File | null;
}

const emptyForm: RiderFormInput = {
  fullName: '',
  email: '',
  password: '',
  phone: '',
  address: '',
  citizenship: '',
  locationId: '',
  licenceNo: '',
  citizenshipDoc: null,
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
    <div className="rfp-file-field">
      <label>{label}{required && <span className="rfp-required"> *</span>}</label>
      {file ? (
        <div className="rfp-file-chip">
          <span>{file.name}</span>
          <button type="button" onClick={() => onChange(null)}><X size={14} /></button>
        </div>
      ) : (
        <button
          type="button"
          className="rfp-file-btn"
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
      <span className="rfp-file-hint">JPG, PNG or PDF · max 5 MB</span>
    </div>
  );
};

const RiderFormPage: React.FC = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState<RiderFormInput>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [locations, setLocations] = useState<Array<{ value: string; label: string }>>([]);

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

  const set = (field: keyof RiderFormInput) => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const setFile = (field: keyof RiderFormInput) => (file: File | null) =>
    setForm((prev) => ({ ...prev, [field]: file }));

  const validate = (): string => {
    if (!form.fullName.trim()) return 'Rider name is required';
    if (!form.email.trim()) return 'Email is required';
    if (!form.password.trim()) return 'Password is required';
    if (form.password.length < 8) return 'Password must be at least 8 characters';
    if (!form.phone.trim()) return 'Phone number is required';
    if (!form.locationId.trim()) return 'Location is required';
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const err = validate();
    if (err) { setError(err); setLoading(false); return; }

    try {
      await registerUser({
        type: 'rider',
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: form.phone,
        locationId: form.locationId,
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create rider. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="rfp-page">
        <button type="button" className="rfp-back" onClick={() => navigate('/riders')}>
          <ArrowLeft size={15} />
          Rider List
        </button>
        <div className="rfp-success-card">
          <CheckCircle size={52} className="rfp-success-icon" />
          <h3>Rider Created Successfully!</h3>
          <p>Rider <strong>{form.fullName}</strong> has been created.</p>
          <p>Login credentials will be sent to <strong>{form.email}</strong>.</p>
          <div className="rfp-success-actions">
            <Button variant="secondary" onClick={() => { setSubmitted(false); setForm(emptyForm); }}>
              Create Another Rider
            </Button>
            <Button variant="primary" onClick={() => navigate('/riders')}>
              Back to Rider List
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rfp-page">
      <button type="button" className="rfp-back" onClick={() => navigate('/riders')}>
        <ArrowLeft size={15} />
        Rider List
      </button>

      <div className="rfp-header">
        <h1>Add New Rider</h1>
        <p>Fill in the details below to create a new rider account.</p>
      </div>

      <form className="rfp-form" onSubmit={handleSubmit} noValidate>
        <div className="rfp-form-card">
          <div className="rfp-section">
            <h3>Personal Information</h3>
            <div className="rfp-grid">
              <FormField
                label="Rider Name"
                required
                value={form.fullName}
                onChange={set('fullName')}
                placeholder="Full name"
                gridColumn="span 2"
              />
              <FormField
                label="Phone Number"
                type="number"
                required
                value={form.phone}
                onChange={set('phone')}
                placeholder="e.g. 9800000000"
              />
              <FormField
                label="Email"
                type="email"
                required
                value={form.email}
                onChange={set('email')}
                placeholder="rider@example.com"
              />
              <FormField
                label="Address"
                value={form.address}
                onChange={set('address')}
                placeholder="Street / City"
                gridColumn="span 2"
              />
            </div>
          </div>

          <div className="rfp-section">
            <h3>Identity & Location</h3>
            <div className="rfp-grid">
              <FormField
                label="Citizenship"
                value={form.citizenship}
                onChange={set('citizenship')}
                placeholder="Citizenship number"
              />
              <FormField
                label="Licence No."
                value={form.licenceNo}
                onChange={set('licenceNo')}
                placeholder="Driving licence number"
              />
              <FormField
                label="Location"
                type="select"
                required
                placeholder="Select location"
                options={locations}
                value={form.locationId}
                onChange={set('locationId')}
              />
            </div>

            <div className="rfp-divider">
              <span>Documents</span>
            </div>
            <div className="rfp-docs">
              <FileInput
                label="Citizenship Document"
                file={form.citizenshipDoc}
                onChange={setFile('citizenshipDoc')}
              />
            </div>
          </div>

          <div className="rfp-section">
            <h3>Login Credentials</h3>
            <div className="rfp-grid">
              <FormField
                label="Password"
                type="password"
                required
                value={form.password}
                onChange={set('password')}
                placeholder="Min. 8 characters"
                gridColumn="span 2"
              />
            </div>
            <p className="rfp-hint">Minimum 8 characters. Rider can change password after logging in.</p>
          </div>
        </div>

        {error && <p className="rfp-error">{error}</p>}

        <div className="rfp-actions">
          <Button type="button" variant="secondary" onClick={() => navigate('/riders')}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Creating...' : 'Create Rider'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default RiderFormPage;
