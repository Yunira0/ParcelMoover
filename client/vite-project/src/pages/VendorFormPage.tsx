import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Upload, X, Building2, User, FileText, CreditCard, Lock, Tag, ExternalLink } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import { registerUser, getLocations, getAdmins, getVendors, getManagedUser, updateUserProfile } from '../services/users.service';
import { getCurrentUser } from '../services/auth.service';
import { getCurrentUser as getCachedUser, getCurrentUserRoles } from '../utils/auth';
import { getPricingSettings } from '../services/pricing.service';
import './VendorFormPage.css';

interface VendorFormInput {
  onlineBusinessName: string;
  pickupLocation: string;
  pickupLandmark: string;
  businessContact: string;
  ownerName: string;
  ownerEmail: string;
  ownerContact: string;
  sales: string;
  rateType: string;
  flatInsideValley: string;
  flatOutsideValley: string;
  zoneMajorCities: string;
  zoneUrbanAreas: string;
  zoneRemoteAreas: string;
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
  email: string;
  password: string;
  confirmPassword: string;
}

const emptyForm: VendorFormInput = {
  onlineBusinessName: '',
  pickupLocation: '',
  pickupLandmark: '',
  businessContact: '',
  ownerName: '',
  ownerEmail: '',
  ownerContact: '',
  sales: '',
  rateType: 'flat',
  flatInsideValley: '',
  flatOutsideValley: '',
  zoneMajorCities: '',
  zoneUrbanAreas: '',
  zoneRemoteAreas: '',
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
  const { id: editId } = useParams();
  const isEdit = !!editId;
  // When a sales user creates a client, the client is auto-assigned to them, so
  // the Sales field is prefilled with their own name and locked.
  const roles = getCurrentUserRoles();
  const isSalesUser = roles.includes('sales') && !roles.includes('admin') && !roles.includes('super_admin');
  // Only super admins can open the rate-config screen, so the shortcut is theirs.
  const isSuperAdmin = roles.includes('super_admin');
  const salesName = getCachedUser()?.fullName ?? '';
  const [form, setForm] = useState<VendorFormInput>(
    isSalesUser && salesName ? { ...emptyForm, sales: salesName } : emptyForm,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [locations, setLocations] = useState<Array<{ value: string; label: string }>>([]);
  const [salesOptions, setSalesOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchHubs = async () => {
      try {
        const [res, me, adminsRes, vendorsRes] = await Promise.all([
          getLocations(),
          getCurrentUser().catch(() => null),
          getAdmins().catch(() => null),
          getVendors().catch(() => null),
        ]);
        let hubs: Array<{ value: string; label: string }> = [];
        if (res && res.success && Array.isArray(res.data)) {
          // Vendors are assigned to a hub/branch, so only show hub locations.
          hubs = res.data
            .filter((loc: any) => loc.is_hub)
            .map((loc: any) => ({ value: loc.id, label: loc.name }));
          setLocations(hubs);
        }
        // Existing sales = admins in the "Sales" department + any sales names
        // already recorded on vendors. De-duplicated, case-insensitively.
        const names = new Set<string>();
        if (adminsRes?.success && Array.isArray(adminsRes.data)) {
          adminsRes.data
            .filter((a: any) => (a.department || '').toLowerCase() === 'sales')
            .forEach((a: any) => a.name && names.add(a.name));
        }
        if (vendorsRes?.success && Array.isArray(vendorsRes.data)) {
          vendorsRes.data.forEach((v: any) => v.sales && names.add(v.sales));
        }
        setSalesOptions(Array.from(names).map((n) => ({ value: n, label: n })));
        // Default the hub to the creating admin's own hub. Falls back to the sole
        // hub when the admin has none (e.g. single-hub setup).
        const adminHubId: string | null = me?.hubId ?? null;
        const defaultHub = adminHubId && hubs.some(h => h.value === adminHubId)
          ? adminHubId
          : hubs.length === 1 ? hubs[0].value : '';
        if (defaultHub) {
          setForm(prev => (prev.pickupLocation ? prev : { ...prev, pickupLocation: defaultHub }));
        }
      } catch (err) {
        console.error('Failed to load hubs:', err);
      }
    };
    fetchHubs();
  }, []);

  // Prefill the per-vendor rate fields with the global defaults from Settings;
  // the creator can then edit them so this vendor gets its own rates.
  useEffect(() => {
    getPricingSettings()
      .then((res) => {
        if (!res?.success || !res.data) return;
        const d = res.data;
        const str = (n: number | null) => (n != null ? String(n) : '');
        setForm((prev) => ({
          ...prev,
          flatInsideValley: prev.flatInsideValley || str(d.flatInsideValley),
          flatOutsideValley: prev.flatOutsideValley || str(d.flatOutsideValley),
          zoneMajorCities: prev.zoneMajorCities || str(d.zoneMajorCities),
          zoneUrbanAreas: prev.zoneUrbanAreas || str(d.zoneUrbanAreas),
          zoneRemoteAreas: prev.zoneRemoteAreas || str(d.zoneRemoteAreas),
        }));
      })
      .catch(() => {});
  }, []);

  // Edit mode: load the vendor's saved data and prefill the form.
  useEffect(() => {
    if (!isEdit) return;
    getManagedUser('vendor', editId!)
      .then((res) => {
        if (!res?.success || !res.data) return;
        const d = res.data;
        const s = (v: unknown) => (v == null ? '' : String(v));
        setForm((prev) => ({
          ...prev,
          onlineBusinessName: s(d.businessName),
          ownerName: s(d.clientName),
          ownerEmail: s(d.email),
          email: s(d.email),
          ownerContact: s(d.phone),
          businessContact: s(d.phone),
          pickupLocation: s(d.locationId),
          registeredAddress: s(d.address),
          sales: s(d.sales),
          rateType: s(d.rateType) || 'flat',
          flatInsideValley: s(d.flatInsideValley),
          flatOutsideValley: s(d.flatOutsideValley),
          zoneMajorCities: s(d.zoneMajorCities),
          zoneUrbanAreas: s(d.zoneUrbanAreas),
          zoneRemoteAreas: s(d.zoneRemoteAreas),
          pickupLandmark: s(d.pickupLandmark),
          billingBusinessName: s(d.billingBusinessName),
          registrationNo: s(d.registrationNo),
          panVatNo: s(d.panVatNo),
          bankName: s(d.bankName),
          bankAccountNo: s(d.bankAccountNo),
          bankAccountHolder: s(d.bankAccountHolder),
        }));
      })
      .catch(() => setError('Failed to load vendor details.'));
  }, [isEdit, editId]);

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
    if (!form.pickupLocation.trim()) errors.pickupLocation = 'Hub is required';
    if (!form.businessContact.trim()) errors.businessContact = 'Contact number is required';
    if (!form.sales.trim()) errors.sales = 'Sales is required';
    if (!form.ownerName.trim()) errors.ownerName = 'Owner name is required';
    if (!form.ownerEmail.trim()) errors.ownerEmail = 'Email is required';
    if (!form.ownerContact.trim()) errors.ownerContact = 'Contact number is required';
    if (!form.billingBusinessName.trim()) errors.billingBusinessName = 'Business name is required';
    if (!form.registeredAddress.trim()) errors.registeredAddress = 'Address is required';
    // Documents and password are only required when creating a new vendor.
    if (!isEdit) {
      if (!form.citizenshipDoc) errors.citizenshipDoc = 'Citizenship document is required';
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
      const firstError = document.querySelector('.vfp-field-error');
      firstError?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    try {
      if (isEdit) {
        await updateUserProfile(editId!, {
          type: 'vendor',
          fullName: form.ownerName,
          phone: form.ownerContact,
          email: form.ownerEmail,
          clientName: form.ownerName,
          businessName: form.onlineBusinessName,
          locationId: form.pickupLocation,
          address: form.registeredAddress,
          sales: form.sales,
          rateType: form.rateType,
          flatInsideValley: form.flatInsideValley,
          flatOutsideValley: form.flatOutsideValley,
          zoneMajorCities: form.zoneMajorCities,
          zoneUrbanAreas: form.zoneUrbanAreas,
          zoneRemoteAreas: form.zoneRemoteAreas,
          pickupLandmark: form.pickupLandmark,
          billingBusinessName: form.billingBusinessName,
          registrationNo: form.registrationNo,
          panVatNo: form.panVatNo,
          bankName: form.bankName,
          bankAccountNo: form.bankAccountNo,
          bankAccountHolder: form.bankAccountHolder,
        });
        navigate('/vendors');
        return;
      }
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
        sales: form.sales,
        rateType: form.rateType,
        // Only send the override fields relevant to the chosen model.
        ...(form.rateType === 'flat'
          ? { flatInsideValley: form.flatInsideValley, flatOutsideValley: form.flatOutsideValley }
          : {}),
        ...(form.rateType === 'zone'
          ? {
              zoneMajorCities: form.zoneMajorCities,
              zoneUrbanAreas: form.zoneUrbanAreas,
              zoneRemoteAreas: form.zoneRemoteAreas,
            }
          : {}),
        pickupLandmark: form.pickupLandmark,
        billingBusinessName: form.billingBusinessName,
        registrationNo: form.registrationNo,
        panVatNo: form.panVatNo,
        bankName: form.bankName,
        bankAccountNo: form.bankAccountNo,
        bankAccountHolder: form.bankAccountHolder,
        citizenshipDoc: form.citizenshipDoc,
        panVatDoc: form.panVatDoc,
        businessCertDoc: form.businessCertDoc,
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
        <h1>{isEdit ? 'Edit Vendor' : 'Add New Vendor'}</h1>
        <p>{isEdit ? 'Update this vendor’s details below.' : 'Complete the registration form below to create a new vendor account.'}</p>
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
                  label="Hub"
                  type="select"
                  required
                  value={form.pickupLocation}
                  onChange={set('pickupLocation')}
                  placeholder="Select hub"
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
                <FormField
                  label="Sales"
                  type="combobox"
                  required
                  value={form.sales}
                  onChange={set('sales')}
                  placeholder="Select existing sales or type a name"
                  options={salesOptions}
                  disabled={isSalesUser}
                />
                {fieldErrors.sales && (
                  <span className="vfp-field-error">{fieldErrors.sales}</span>
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
                  label="Email"
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
            {/* Documents — only when creating; existing docs aren't re-uploaded on edit */}
            {!isEdit && (
            <section className="vfp-section">
              <SectionHeader
                icon={<FileText size={18} />}
                title="Documents"
                description="Upload required documents"
              />
              <div className="vfp-docs">
                <div>
                  <FileInput
                    label="Citizenship"
                    required
                    file={form.citizenshipDoc}
                    onChange={setFile('citizenshipDoc')}
                  />
                  {fieldErrors.citizenshipDoc && (
                    <span className="vfp-field-error">{fieldErrors.citizenshipDoc}</span>
                  )}
                </div>
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
            )}

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

            {/* Delivery Rate */}
            <section className="vfp-section">
              <SectionHeader
                icon={<Tag size={18} />}
                title="Delivery Rate"
                description="Choose how this vendor is charged for deliveries"
              />
              <div className="vfp-rate-options">
                {[
                  { value: 'per_destination', title: 'Per-destination', desc: "Each destination's own configured rate." },
                  { value: 'zone', title: 'Zone-based', desc: 'Priced by zone: major cities, urban, remote.' },
                  { value: 'flat', title: 'Flat rate', desc: 'One rate inside valley, one outside valley.' },
                ].map((opt) => (
                  <button
                    type="button"
                    key={opt.value}
                    className={`vfp-rate-option ${form.rateType === opt.value ? 'selected' : ''}`}
                    onClick={() => set('rateType')(opt.value)}
                  >
                    <span className="vfp-rate-radio" aria-hidden />
                    <span className="vfp-rate-text">
                      <strong>{opt.title}</strong>
                      <small>{opt.desc}</small>
                    </span>
                  </button>
                ))}
              </div>

              {/* Editable per-vendor rates, prefilled from the Settings defaults. */}
              {form.rateType === 'flat' && (
                <div className="vfp-rate-fields">
                  <p className="vfp-rate-note">Rates default to Settings; edit to give this vendor its own.</p>
                  <div className="vfp-fields">
                    <FormField label="Inside valley (Rs.)" type="number" min={0}
                      value={form.flatInsideValley} onChange={set('flatInsideValley')} placeholder="e.g. 120" />
                    <FormField label="Outside valley (Rs.)" type="number" min={0}
                      value={form.flatOutsideValley} onChange={set('flatOutsideValley')} placeholder="e.g. 250" />
                  </div>
                </div>
              )}
              {form.rateType === 'zone' && (
                <div className="vfp-rate-fields">
                  <p className="vfp-rate-note">Rates default to Settings; edit to give this vendor its own.</p>
                  <div className="vfp-fields">
                    <FormField label="Major cities (Rs.)" type="number" min={0}
                      value={form.zoneMajorCities} onChange={set('zoneMajorCities')} placeholder="e.g. 300" />
                    <FormField label="Urban areas (Rs.)" type="number" min={0}
                      value={form.zoneUrbanAreas} onChange={set('zoneUrbanAreas')} placeholder="e.g. 350" />
                    <FormField label="Remote areas (Rs.)" type="number" min={0}
                      value={form.zoneRemoteAreas} onChange={set('zoneRemoteAreas')} placeholder="e.g. 500" />
                  </div>
                </div>
              )}
              {form.rateType === 'per_destination' && (
                <p className="vfp-rate-note">
                  Charged by each destination’s own rate, configured in Settings → Rate Setup.
                </p>
              )}
              {isSuperAdmin && (form.rateType === 'zone' || form.rateType === 'flat') && (
                <button
                  type="button"
                  className="vfp-rate-config-link"
                  onClick={() => window.open('/settings?tab=rates', '_blank', 'noopener')}
                >
                  <ExternalLink size={14} />
                  Edit default {form.rateType === 'zone' ? 'zone' : 'flat'} rates in Settings
                </button>
              )}
            </section>

            {/* Login Credentials — not editable here (password change is separate) */}
            {!isEdit && (
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
                <FormField
                  label="Confirm Password"
                  type="password"
                  required
                  value={form.confirmPassword}
                  onChange={set('confirmPassword')}
                  placeholder="Re-enter password"
                />
                {fieldErrors.confirmPassword && (
                  <span className="vfp-field-error">{fieldErrors.confirmPassword}</span>
                )}
              </div>
              <p className="vfp-hint">Minimum 8 characters. Vendor can change password after logging in.</p>
            </section>
            )}
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
            {loading ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Vendor'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default VendorFormPage;
