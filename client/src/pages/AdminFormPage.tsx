import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Upload, X, User, Building2, FileText, CreditCard, Lock } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import { registerUser, getManagedUser, updateUserProfile, getLocations } from '../services/users.service';
import { extractServerFieldErrors, isValidEmail, isValidName, isValidPhone, normalizePhone } from '../utils/serverValidation';
import './AdminFormPage.css';

// API validation-error field → form field, for errors returned by the server.
// Fields not listed here share the same name on both sides.
const API_FIELD_MAP: Record<string, string> = {
  position: 'designation',
  idDocumentType: 'documentType',
  idDocumentNumber: 'documentNumber',
};

interface AdminFormInput {
  // Employee Info
  fullName: string;
  address: string;
  phone: string;
  citizenshipNo: string;
  pan: string;
  fatherName: string;
  motherName: string;
  grandFatherName: string;
  permanentAddress: string;
  currentAddress: string;
  experience: string;
  joinedAt: string;
  // Service Info
  locationId: string;
  department: string;
  designation: string;
  // Documents
  documentType: string;
  documentNumber: string;
  idDocument: File | null;
  // Bank Details
  bankName: string;
  bankAccountNo: string;
  bankAccountHolder: string;
  // Account
  email: string;
  password: string;
  confirmPassword: string;
}

const DEPARTMENT_OPTIONS = [
  { value: 'Operation', label: 'Operation' },
  { value: 'Accountant', label: 'Accountant' },
  { value: 'Customer Experience', label: 'Customer Experience' },
  { value: 'Sales', label: 'Sales' },
];

const DOCUMENT_TYPE_OPTIONS = [
  { value: 'Citizenship', label: 'Citizenship' },
  { value: 'National ID', label: 'National ID' },
  { value: 'PAN', label: 'PAN' },
];

const emptyForm: AdminFormInput = {
  fullName: '',
  address: '',
  phone: '',
  citizenshipNo: '',
  pan: '',
  fatherName: '',
  motherName: '',
  grandFatherName: '',
  permanentAddress: '',
  currentAddress: '',
  experience: '',
  joinedAt: '',
  locationId: '',
  department: '',
  designation: '',
  documentType: '',
  documentNumber: '',
  idDocument: null,
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
    <div className="afp-file-field">
      <label className="afp-file-label">
        {label}{required && <span className="afp-required"> *</span>}
      </label>
      {file ? (
        <div className="afp-file-chip">
          <FileText size={14} />
          <span>{file.name}</span>
          <button type="button" onClick={() => onChange(null)} aria-label="Remove file">
            <X size={14} />
          </button>
        </div>
      ) : (
        <button type="button" className="afp-file-btn" onClick={() => ref.current?.click()}>
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
      <span className="afp-file-hint">JPG, PNG or PDF · max 5 MB</span>
    </div>
  );
};

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
}> = ({ icon, title, description }) => (
  <div className="afp-section-header">
    <div className="afp-section-icon">{icon}</div>
    <div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  </div>
);

const AdminFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const isEdit = !!editId;
  const [form, setForm] = useState<AdminFormInput>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [hubs, setHubs] = useState<Array<{ value: string; label: string }>>([]);

  // Hubs/branches an admin can be assigned to (Sales-department staff need one
  // so vendors can be matched to a sales rep in their own hub).
  useEffect(() => {
    getLocations()
      .then((res) => {
        if (res?.success && Array.isArray(res.data)) {
          setHubs(
            res.data
              .filter((loc: any) => loc.is_hub)
              .map((loc: any) => ({ value: loc.id, label: loc.name })),
          );
          // Hub is fixed to the Imadol admin hub for every admin.
          const imadol = res.data.find(
            (loc: any) => (loc.code || '').toUpperCase() === 'IMADOL' || (loc.name || '').trim().toLowerCase() === 'imadol',
          );
          if (imadol?.id) {
            setForm((prev) => (prev.locationId ? prev : { ...prev, locationId: imadol.id }));
          }
        }
      })
      .catch((err) => console.error('Failed to load hubs:', err));
  }, []);

  // Edit mode: load the admin's saved data and prefill the form.
  useEffect(() => {
    if (!isEdit) return;
    getManagedUser('admin', editId!)
      .then((res) => {
        if (!res?.success || !res.data) return;
        const d = res.data;
        const s = (v: unknown) => (v == null ? '' : String(v));
        setForm((prev) => ({
          ...prev,
          fullName: s(d.fullName),
          email: s(d.email),
          phone: s(d.phone),
          address: s(d.address),
          citizenshipNo: s(d.citizenshipNo),
          pan: s(d.pan),
          fatherName: s(d.fatherName),
          motherName: s(d.motherName),
          grandFatherName: s(d.grandfatherName),
          permanentAddress: s(d.permanentAddress),
          currentAddress: s(d.currentAddress),
          experience: s(d.experience),
          joinedAt: s(d.joinedAt),
          locationId: s(d.locationId),
          department: s(d.department),
          designation: s(d.position),
          documentType: s(d.idDocumentType),
          documentNumber: s(d.idDocumentNumber),
          bankName: s(d.bankName),
          bankAccountNo: s(d.bankAccountNo),
          bankAccountHolder: s(d.bankAccountHolder),
        }));
      })
      .catch(() => setError('Failed to load admin details.'));
  }, [isEdit, editId]);

  const set = (field: keyof AdminFormInput) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const setFile = (field: keyof AdminFormInput) => (file: File | null) => {
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
    if (!form.fullName.trim()) errors.fullName = 'Name is required';
    else if (!isValidName(form.fullName)) errors.fullName = "Enter a valid name (letters, spaces, . ' - only)";
    if (!form.address.trim()) errors.address = 'Address is required';
    if (!form.phone.trim()) errors.phone = 'Phone number is required';
    else if (!isValidPhone(form.phone)) errors.phone = 'Enter a valid Nepali mobile number (e.g. 98XXXXXXXX)';
    if (!form.locationId.trim()) errors.locationId = 'Hub is required';
    if (!form.department.trim()) errors.department = 'Department is required';
    if (!form.designation.trim()) errors.designation = 'Designation is required';
    if (!form.joinedAt.trim()) errors.joinedAt = 'Joined date is required';
    if (!form.email.trim()) errors.email = 'Email is required';
    else if (!isValidEmail(form.email)) errors.email = 'Enter a valid email address';
    // Document and password only required when creating a new admin.
    if (!isEdit) {
      if (!form.documentType.trim()) errors.documentType = 'Document type is required';
      if (!form.documentNumber.trim()) errors.documentNumber = 'Document number is required';
      if (!form.idDocument) errors.idDocument = 'Document is required';
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
      const firstError = document.querySelector('.afp-field-error');
      firstError?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    try {
      if (isEdit) {
        await updateUserProfile(editId!, {
          type: 'admin',
          fullName: form.fullName,
          phone: normalizePhone(form.phone),
          email: form.email,
          joinedAt: form.joinedAt || undefined,
          position: form.designation,
          locationId: form.locationId,
          department: form.department,
          address: form.address,
          citizenshipNo: form.citizenshipNo,
          pan: form.pan,
          fatherName: form.fatherName,
          motherName: form.motherName,
          grandfatherName: form.grandFatherName,
          permanentAddress: form.permanentAddress,
          currentAddress: form.currentAddress,
          experience: form.experience,
          bankName: form.bankName,
          bankAccountNo: form.bankAccountNo,
          bankAccountHolder: form.bankAccountHolder,
          idDocumentType: form.documentType,
          idDocumentNumber: form.documentNumber,
        });
        navigate('/admin');
        return;
      }
      await registerUser({
        type: 'admin',
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: normalizePhone(form.phone),
        joinedAt: form.joinedAt || undefined,
        position: form.designation,
        locationId: form.locationId,
        department: form.department,
        address: form.address,
        citizenshipNo: form.citizenshipNo,
        pan: form.pan,
        fatherName: form.fatherName,
        motherName: form.motherName,
        grandfatherName: form.grandFatherName,
        permanentAddress: form.permanentAddress,
        currentAddress: form.currentAddress,
        experience: form.experience,
        bankName: form.bankName,
        bankAccountNo: form.bankAccountNo,
        bankAccountHolder: form.bankAccountHolder,
        idDocumentType: form.documentType,
        idDocumentNumber: form.documentNumber,
        idDocument: form.idDocument,
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
          document.querySelector('.afp-field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 0);
      } else {
        setError(err.response?.data?.message || 'Failed to create admin. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="afp-page">
        <button type="button" className="afp-back" onClick={() => navigate('/admin')}>
          <ArrowLeft size={15} />
          Admin List
        </button>
        <div className="afp-success-card">
          <div className="afp-success-icon-wrap">
            <CheckCircle size={48} />
          </div>
          <h3>Admin Created Successfully!</h3>
          <p>Admin <strong>{form.fullName}</strong> has been created.</p>
          <p className="afp-success-hint">Login credentials will be sent to <strong>{form.email}</strong></p>
          <div className="afp-success-actions">
            <Button variant="secondary" onClick={() => { setSubmitted(false); setForm(emptyForm); }}>
              Create Another
            </Button>
            <Button variant="primary" onClick={() => navigate('/admin')}>
              Back to List
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="afp-page">
      <button type="button" className="afp-back" onClick={() => navigate('/admin')}>
        <ArrowLeft size={15} />
        Admin List
      </button>

      <div className="afp-header">
        <h1>{isEdit ? 'Edit Admin' : 'Add New Admin'}</h1>
        <p>Complete the registration form below to create a new admin account.</p>
      </div>

      <form className="afp-form" onSubmit={handleSubmit} noValidate>
        <div className="afp-body">
          {/* Left Column */}
          <div className="afp-left">
            {/* Employee Info */}
            <section className="afp-section">
              <SectionHeader
                icon={<User size={18} />}
                title="Employee Info"
                description="Personal and identity details"
              />
              <div className="afp-fields">
                <FormField
                  label="Name"
                  required
                  value={form.fullName}
                  onChange={set('fullName')}
                  placeholder="Full name as on ID"
                />
                {fieldErrors.fullName && <span className="afp-field-error">{fieldErrors.fullName}</span>}
                <FormField
                  label="Address"
                  required
                  value={form.address}
                  onChange={set('address')}
                  placeholder="Address"
                />
                {fieldErrors.address && <span className="afp-field-error">{fieldErrors.address}</span>}
                <FormField
                  label="Phone Number"
                  required
                  value={form.phone}
                  onChange={set('phone')}
                  placeholder="e.g. 9800000000"
                />
                {fieldErrors.phone && <span className="afp-field-error">{fieldErrors.phone}</span>}
                <FormField
                  label="Citizenship No."
                  value={form.citizenshipNo}
                  onChange={set('citizenshipNo')}
                  placeholder="Citizenship number"
                />
                <FormField
                  label="PAN"
                  value={form.pan}
                  onChange={set('pan')}
                  placeholder="PAN number"
                />
                <FormField
                  label="Father Name"
                  value={form.fatherName}
                  onChange={set('fatherName')}
                  placeholder="Father's full name"
                />
                <FormField
                  label="Mother Name"
                  value={form.motherName}
                  onChange={set('motherName')}
                  placeholder="Mother's full name"
                />
                <FormField
                  label="Grand Father Name"
                  value={form.grandFatherName}
                  onChange={set('grandFatherName')}
                  placeholder="Grandfather's full name"
                />
                <FormField
                  label="Permanent Address"
                  value={form.permanentAddress}
                  onChange={set('permanentAddress')}
                  placeholder="Permanent address"
                />
                <FormField
                  label="Current Address"
                  value={form.currentAddress}
                  onChange={set('currentAddress')}
                  placeholder="Current address"
                />
                <FormField
                  label="Experience"
                  value={form.experience}
                  onChange={set('experience')}
                  placeholder="e.g. 3 years in logistics"
                />
                <FormField
                  label="Joined Date"
                  required
                  type="date"
                  value={form.joinedAt}
                  onChange={set('joinedAt')}
                />
                {fieldErrors.joinedAt && <span className="afp-field-error">{fieldErrors.joinedAt}</span>}
              </div>
            </section>

            {/* Service Info */}
            <section className="afp-section">
              <SectionHeader
                icon={<Building2 size={18} />}
                title="Service Info"
                description="Department and role"
              />
              <div className="afp-fields">
                <FormField
                  label="Hub"
                  type="select"
                  required
                  disabled
                  value={form.locationId}
                  onChange={set('locationId')}
                  placeholder="Select hub"
                  options={hubs}
                />
                {fieldErrors.locationId && <span className="afp-field-error">{fieldErrors.locationId}</span>}
                <FormField
                  label="Department"
                  type="select"
                  required
                  value={form.department}
                  onChange={set('department')}
                  placeholder="Select department"
                  options={DEPARTMENT_OPTIONS}
                />
                {fieldErrors.department && <span className="afp-field-error">{fieldErrors.department}</span>}
                <FormField
                  label="Designation"
                  required
                  value={form.designation}
                  onChange={set('designation')}
                  placeholder="e.g. Operations Manager"
                />
                {fieldErrors.designation && <span className="afp-field-error">{fieldErrors.designation}</span>}
              </div>
            </section>
          </div>

          {/* Right Column */}
          <div className="afp-right">
            {/* Documents */}
            <section className="afp-section">
              <SectionHeader
                icon={<FileText size={18} />}
                title="Documents"
                description="Upload required documents"
              />
              <div className="afp-fields">
                <FormField
                  label="Document"
                  type="select"
                  required
                  value={form.documentType}
                  onChange={set('documentType')}
                  placeholder="Select document type"
                  options={DOCUMENT_TYPE_OPTIONS}
                />
                {fieldErrors.documentType && <span className="afp-field-error">{fieldErrors.documentType}</span>}
                <FormField
                  label="Document Number"
                  required
                  value={form.documentNumber}
                  onChange={set('documentNumber')}
                  placeholder="Number of the selected document"
                />
                {fieldErrors.documentNumber && <span className="afp-field-error">{fieldErrors.documentNumber}</span>}
                {!isEdit && (
                  <>
                    <FileInput
                      label="Upload Document"
                      required
                      file={form.idDocument}
                      onChange={setFile('idDocument')}
                    />
                    {fieldErrors.idDocument && <span className="afp-field-error">{fieldErrors.idDocument}</span>}
                  </>
                )}
              </div>
            </section>

            {/* Bank Details */}
            <section className="afp-section">
              <SectionHeader
                icon={<CreditCard size={18} />}
                title="Bank Details"
                description="Payment account information"
              />
              <div className="afp-fields">
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
            <section className="afp-section">
              <SectionHeader
                icon={<Lock size={18} />}
                title="Account"
                description="Login credentials"
              />
              <div className="afp-fields">
                <FormField
                  label="Email"
                  type="email"
                  required
                  value={form.email}
                  onChange={set('email')}
                  placeholder="admin@example.com"
                />
                {fieldErrors.email && <span className="afp-field-error">{fieldErrors.email}</span>}
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
                    {fieldErrors.password && <span className="afp-field-error">{fieldErrors.password}</span>}
                    <FormField
                      label="Confirm Password"
                      type="password"
                      required
                      value={form.confirmPassword}
                      onChange={set('confirmPassword')}
                      placeholder="Re-enter password"
                    />
                    {fieldErrors.confirmPassword && <span className="afp-field-error">{fieldErrors.confirmPassword}</span>}
                  </>
                )}
              </div>
              {!isEdit && <p className="afp-hint">Minimum 8 characters. Admin can change password after logging in.</p>}
            </section>
          </div>
        </div>

        {error && (
          <div className="afp-error" role="alert">
            {error}
          </div>
        )}

        <div className="afp-actions">
          <Button type="button" variant="secondary" onClick={() => navigate('/admin')} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Admin'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default AdminFormPage;
