import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Upload, X, User, Truck, Building2, FileText, CreditCard, Lock } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import { registerUser, getLocations, getManagedUser, updateUserProfile } from '../services/users.service';
import { getCurrentUser } from '../services/auth.service';
import { extractServerFieldErrors, isValidEmail, isValidPhone, normalizePhone } from '../utils/serverValidation';
import { useHubLock } from '../hooks/useHubLock';
import './RiderFormPage.css';

// API validation-error field → form field, for errors returned by the server.
// Fields not listed here share the same name on both sides.
const API_FIELD_MAP: Record<string, string> = {
  phone: 'contactNo',
  locationId: 'serviceBranch',
};

interface RiderFormInput {
  // Rider Info
  fullName: string;
  riderLocation: string;
  contactNo: string;
  citizenshipNo: string;
  // Vehicle & License
  licenceNo: string;
  vehicleNo: string;
  // Service & Compensation
  serviceBranch: string;
  salaryCommission: string;
  pan: string;
  // Documents
  citizenshipDoc: File | null;
  panVatDoc: File | null;
  licenceDoc: File | null;
  blueBookDoc: File | null;
  // Bank Details
  bankName: string;
  bankAccountNo: string;
  bankAccountHolder: string;
  // Account
  email: string;
  password: string;
  confirmPassword: string;
}

const emptyForm: RiderFormInput = {
  fullName: '',
  riderLocation: '',
  contactNo: '',
  citizenshipNo: '',
  licenceNo: '',
  vehicleNo: '',
  serviceBranch: '',
  salaryCommission: '',
  pan: '',
  citizenshipDoc: null,
  panVatDoc: null,
  licenceDoc: null,
  blueBookDoc: null,
  bankName: '',
  bankAccountNo: '',
  bankAccountHolder: '',
  email: '',
  password: '',
  confirmPassword: '',
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
      <label className="rfp-file-label">
        {label}{required && <span className="rfp-required"> *</span>}
      </label>
      {file ? (
        <div className="rfp-file-chip">
          <FileText size={14} />
          <span>{file.name}</span>
          <button type="button" onClick={() => onChange(null)} aria-label="Remove file">
            <X size={14} />
          </button>
        </div>
      ) : (
        <button type="button" className="rfp-file-btn" onClick={() => ref.current?.click()}>
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

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
}> = ({ icon, title, description }) => (
  <div className="rfp-section-header">
    <div className="rfp-section-icon">{icon}</div>
    <div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  </div>
);

const RiderFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const isEdit = !!editId;
  const [form, setForm] = useState<RiderFormInput>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [hubs, setHubs] = useState<Array<{ value: string; label: string }>>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // A plain admin's riders always land in that admin's own hub; only a
  // super_admin may pick another service branch (server enforces the same).
  const { hubLocked, isPlainAdmin } = useHubLock();
  const hubFieldDisabled = hubLocked || (isEdit && isPlainAdmin);

  useEffect(() => {
    const fetchHubs = async () => {
      try {
        const [res, me] = await Promise.all([getLocations(), getCurrentUser().catch(() => null)]);
        let hubList: Array<{ value: string; label: string }> = [];
        if (res && res.success && Array.isArray(res.data)) {
          // The service branch is the rider's hub, so only show hub locations.
          hubList = res.data
            .filter((loc: any) => loc.is_hub)
            .map((loc: any) => ({ value: loc.id, label: loc.name }));
          setHubs(hubList);
        }
        // Service branch defaults to whichever hub the current staff member
        // (super_admin or admin) is assigned to. Fall back to the sole hub
        // only if the actor has none.
        const adminHubId: string | null = me?.hubId ?? null;
        const defaultHub = (adminHubId && hubList.some(h => h.value === adminHubId) ? adminHubId : '')
          || (hubList.length === 1 ? hubList[0].value : '');
        if (defaultHub) {
          setForm(prev => (prev.serviceBranch ? prev : { ...prev, serviceBranch: defaultHub }));
        }
      } catch (err) {
        console.error('Failed to load hubs:', err);
      }
    };
    fetchHubs();
  }, []);

  // Edit mode: load the rider's saved data and prefill the form.
  useEffect(() => {
    if (!isEdit) return;
    getManagedUser('rider', editId!)
      .then((res) => {
        if (!res?.success || !res.data) return;
        const d = res.data;
        const s = (v: unknown) => (v == null ? '' : String(v));
        setForm((prev) => ({
          ...prev,
          fullName: s(d.fullName),
          email: s(d.email),
          contactNo: s(d.phone),
          serviceBranch: s(d.locationId),
          riderLocation: s(d.riderLocation),
          citizenshipNo: s(d.citizenshipNo),
          licenceNo: s(d.licenceNo),
          vehicleNo: s(d.vehicleNo),
          salaryCommission: s(d.salaryCommission),
          pan: s(d.pan),
          bankName: s(d.bankName),
          bankAccountNo: s(d.bankAccountNo),
          bankAccountHolder: s(d.bankAccountHolder),
        }));
      })
      .catch(() => setError('Failed to load rider details.'));
  }, [isEdit, editId]);

  const set = (field: keyof RiderFormInput) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const setFile = (field: keyof RiderFormInput) => (file: File | null) => {
    setForm((prev) => ({ ...prev, [field]: file }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!form.fullName.trim()) errors.fullName = 'Rider name is required';
    if (!form.riderLocation.trim()) errors.riderLocation = 'Rider location is required';
    if (!form.contactNo.trim()) errors.contactNo = 'Contact number is required';
    else if (!isValidPhone(form.contactNo)) errors.contactNo = 'Enter a 10–15 digit phone number';
    if (!form.serviceBranch.trim()) errors.serviceBranch = 'Service branch is required';
    if (!form.email.trim()) errors.email = 'Email is required';
    else if (!isValidEmail(form.email)) errors.email = 'Enter a valid email address';
    // Documents and password only required when creating a new rider.
    if (!isEdit) {
      if (!form.citizenshipDoc) errors.citizenshipDoc = 'Citizenship document is required';
      if (!form.licenceDoc) errors.licenceDoc = 'License document is required';
      if (!form.password.trim()) errors.password = 'Password is required';
      else if (form.password.length < 8) errors.password = 'Min. 8 characters';
      if (!form.confirmPassword.trim()) errors.confirmPassword = 'Please confirm the password';
      else if (form.confirmPassword !== form.password) errors.confirmPassword = 'Passwords do not match';
    }
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
      const firstError = document.querySelector('.rfp-field-error');
      firstError?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    try {
      if (isEdit) {
        await updateUserProfile(editId!, {
          type: 'rider',
          fullName: form.fullName,
          phone: normalizePhone(form.contactNo),
          email: form.email,
          locationId: form.serviceBranch,
          riderLocation: form.riderLocation,
          citizenshipNo: form.citizenshipNo,
          licenceNo: form.licenceNo,
          vehicleNo: form.vehicleNo,
          salaryCommission: form.salaryCommission,
          pan: form.pan,
          bankName: form.bankName,
          bankAccountNo: form.bankAccountNo,
          bankAccountHolder: form.bankAccountHolder,
        });
        navigate('/riders');
        return;
      }
      await registerUser({
        type: 'rider',
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: normalizePhone(form.contactNo),
        locationId: form.serviceBranch, // the rider's hub / service branch
        riderLocation: form.riderLocation,
        citizenshipNo: form.citizenshipNo,
        licenceNo: form.licenceNo,
        vehicleNo: form.vehicleNo,
        salaryCommission: form.salaryCommission,
        pan: form.pan,
        bankName: form.bankName,
        bankAccountNo: form.bankAccountNo,
        bankAccountHolder: form.bankAccountHolder,
        citizenshipDoc: form.citizenshipDoc,
        panVatDoc: form.panVatDoc,
        licenceDoc: form.licenceDoc,
        bluebookDoc: form.blueBookDoc,
      });
      setSubmitted(true);
    } catch (err: any) {
      // Zod rejections from the API name the exact offending fields — show
      // them inline instead of the generic "Validation failed".
      const serverErrors = extractServerFieldErrors(err, API_FIELD_MAP);
      if (serverErrors) {
        setFieldErrors(serverErrors.fieldErrors);
        setError(serverErrors.summary);
        setTimeout(() => {
          document.querySelector('.rfp-field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 0);
      } else {
        setError(err.response?.data?.message || 'Failed to create rider. Please try again.');
      }
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
          <div className="rfp-success-icon-wrap">
            <CheckCircle size={48} />
          </div>
          <h3>Rider Created Successfully!</h3>
          <p>Rider <strong>{form.fullName}</strong> has been created.</p>
          <p className="rfp-success-hint">Login credentials will be sent to <strong>{form.email}</strong></p>
          <div className="rfp-success-actions">
            <Button variant="secondary" onClick={() => { setSubmitted(false); setForm(emptyForm); }}>
              Create Another
            </Button>
            <Button variant="primary" onClick={() => navigate('/riders')}>
              Back to List
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
        <h1>{isEdit ? 'Edit Rider' : 'Add New Rider'}</h1>
        <p>Complete the registration form below to create a new rider account.</p>
      </div>

      <form className="rfp-form" onSubmit={handleSubmit} noValidate>
        <div className="rfp-body">
          {/* Left Column */}
          <div className="rfp-left">
            {/* Rider Info */}
            <section className="rfp-section">
              <SectionHeader
                icon={<User size={18} />}
                title="Rider Info"
                description="Basic rider information"
              />
              <div className="rfp-fields">
                <FormField
                  label="Name of Rider"
                  required
                  value={form.fullName}
                  onChange={set('fullName')}
                  placeholder="Full name as on ID"
                />
                {fieldErrors.fullName && <span className="rfp-field-error">{fieldErrors.fullName}</span>}
                <FormField
                  label="Rider Location"
                  required
                  value={form.riderLocation}
                  onChange={set('riderLocation')}
                  placeholder="Enter rider location / address"
                />
                {fieldErrors.riderLocation && <span className="rfp-field-error">{fieldErrors.riderLocation}</span>}
                <FormField
                  label="Contact No."
                  required
                  value={form.contactNo}
                  onChange={set('contactNo')}
                  placeholder="e.g. 9800000000"
                />
                {fieldErrors.contactNo && <span className="rfp-field-error">{fieldErrors.contactNo}</span>}
                <FormField
                  label="Citizenship No."
                  value={form.citizenshipNo}
                  onChange={set('citizenshipNo')}
                  placeholder="Citizenship number"
                />
              </div>
            </section>

            {/* Vehicle & License */}
            <section className="rfp-section">
              <SectionHeader
                icon={<Truck size={18} />}
                title="Vehicle & License"
                description="Vehicle and driving licence details"
              />
              <div className="rfp-fields">
                <FormField
                  label="License No."
                  value={form.licenceNo}
                  onChange={set('licenceNo')}
                  placeholder="Driving licence number"
                />
                <FormField
                  label="Vehicle No."
                  value={form.vehicleNo}
                  onChange={set('vehicleNo')}
                  placeholder="e.g. BA 12 PA 3456"
                />
              </div>
            </section>

            {/* Service & Compensation */}
            <section className="rfp-section">
              <SectionHeader
                icon={<Building2 size={18} />}
                title="Service & Compensation"
                description="Assigned branch and pay details"
              />
              <div className="rfp-fields">
                <FormField
                  label="Service Branch"
                  type="select"
                  required
                  value={form.serviceBranch}
                  onChange={set('serviceBranch')}
                  placeholder="Select hub"
                  options={hubs}
                  disabled={hubFieldDisabled}
                />
                {fieldErrors.serviceBranch && <span className="rfp-field-error">{fieldErrors.serviceBranch}</span>}
                <FormField
                  label="Salary / Commission"
                  value={form.salaryCommission}
                  onChange={set('salaryCommission')}
                  placeholder="e.g. 25000 or 10% commission"
                />
                <FormField
                  label="PAN"
                  value={form.pan}
                  onChange={set('pan')}
                  placeholder="PAN number"
                />
              </div>
            </section>
          </div>

          {/* Right Column */}
          <div className="rfp-right">
            {/* Documents — only when creating */}
            {!isEdit && (
            <section className="rfp-section">
              <SectionHeader
                icon={<FileText size={18} />}
                title="Documents"
                description="Upload required documents"
              />
              <div className="rfp-docs">
                <FileInput
                  label="Citizenship"
                  required
                  file={form.citizenshipDoc}
                  onChange={setFile('citizenshipDoc')}
                />
                {fieldErrors.citizenshipDoc && <span className="rfp-field-error">{fieldErrors.citizenshipDoc}</span>}
                <FileInput
                  label="PAN / VAT"
                  file={form.panVatDoc}
                  onChange={setFile('panVatDoc')}
                />
                <FileInput
                  label="License"
                  required
                  file={form.licenceDoc}
                  onChange={setFile('licenceDoc')}
                />
                {fieldErrors.licenceDoc && <span className="rfp-field-error">{fieldErrors.licenceDoc}</span>}
                <FileInput
                  label="Blue Book"
                  file={form.blueBookDoc}
                  onChange={setFile('blueBookDoc')}
                />
              </div>
            </section>
            )}

            {/* Bank Details */}
            <section className="rfp-section">
              <SectionHeader
                icon={<CreditCard size={18} />}
                title="Bank Details"
                description="Payment account information"
              />
              <div className="rfp-fields">
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

            {/* Account */}
            <section className="rfp-section">
              <SectionHeader
                icon={<Lock size={18} />}
                title="Account"
                description="Login credentials"
              />
              <div className="rfp-fields">
                <FormField
                  label="Email"
                  type="email"
                  required
                  value={form.email}
                  onChange={set('email')}
                  placeholder="rider@example.com"
                />
                {fieldErrors.email && <span className="rfp-field-error">{fieldErrors.email}</span>}
                {!isEdit && (
                  <>
                    <FormField
                      label="Password"
                      type="password"
                      required
                      value={form.password}
                      onChange={set('password')}
                      placeholder="Min. 8 characters"
                    />
                    {fieldErrors.password && <span className="rfp-field-error">{fieldErrors.password}</span>}
                    <FormField
                      label="Confirm Password"
                      type="password"
                      required
                      value={form.confirmPassword}
                      onChange={set('confirmPassword')}
                      placeholder="Re-enter password"
                    />
                    {fieldErrors.confirmPassword && <span className="rfp-field-error">{fieldErrors.confirmPassword}</span>}
                  </>
                )}
              </div>
              {!isEdit && <p className="rfp-hint">Minimum 8 characters. Rider can change password after logging in.</p>}
            </section>
          </div>
        </div>

        {error && (
          <div className="rfp-error" role="alert">
            {error}
          </div>
        )}

        <div className="rfp-actions">
          <Button type="button" variant="secondary" onClick={() => navigate('/riders')} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Rider'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default RiderFormPage;
