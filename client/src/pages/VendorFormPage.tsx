import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Upload, X, Building2, User, FileText, CreditCard, Lock, Tag, ExternalLink } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import { registerUser, getLocations, getAdmins, getManagedUser, updateUserProfile } from '../services/users.service';
import { getCurrentUser } from '../services/auth.service';
import { getCurrentUser as getCachedUser, getCurrentUserRoles } from '../utils/auth';
import { getPricingSettings } from '../services/pricing.service';
import { extractServerFieldErrors, isValidEmail, isValidPhone, normalizePhone } from '../utils/serverValidation';
import './VendorFormPage.css';

// API validation-error field → form field, for errors returned by the server.
// Fields not listed here share the same name on both sides.
const API_FIELD_MAP: Record<string, string> = {
  fullName: 'ownerName',
  clientName: 'ownerName',
  email: 'ownerEmail',
  phone: 'ownerContact',
  businessName: 'onlineBusinessName',
  locationId: 'pickupLocation',
  address: 'registeredAddress',
};

interface VendorFormInput {
  onlineBusinessName: string;
  pickupLocation: string;
  pickupLandmark: string;
  businessContact: string;
  ownerName: string;
  ownerEmail: string;
  ownerContact: string;
  joinedAt: string;
  sales: string;
  salesUserId: string;
  rateType: string;
  flatInsideValley: string;
  flatOutsideValley: string;
  zoneMajorCities: string;
  zoneUrbanAreas: string;
  zoneRemoteAreas: string;
  zoneInsideValley: string;
  insideValleyFlatRate: string;
  insideValleyEnabled: boolean;
  extraWeightPercent: string;
  returnInsideValleyPercent: string;
  returnOutsideValleyPercent: string;
  branchFlatInsideValley: string;
  branchFlatOutsideValley: string;
  branchZoneMajorCities: string;
  branchZoneUrbanAreas: string;
  branchZoneRemoteAreas: string;
  branchZoneInsideValley: string;
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
  joinedAt: '',
  sales: '',
  salesUserId: '',
  rateType: 'flat',
  flatInsideValley: '',
  flatOutsideValley: '',
  zoneMajorCities: '',
  zoneUrbanAreas: '',
  zoneRemoteAreas: '',
  zoneInsideValley: '',
  insideValleyFlatRate: '',
  insideValleyEnabled: false,
  extraWeightPercent: '',
  returnInsideValleyPercent: '',
  returnOutsideValleyPercent: '',
  branchFlatInsideValley: '',
  branchFlatOutsideValley: '',
  branchZoneMajorCities: '',
  branchZoneUrbanAreas: '',
  branchZoneRemoteAreas: '',
  branchZoneInsideValley: '',
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
  const ownSalesUserId = getCachedUser()?.id ?? '';
  const [form, setForm] = useState<VendorFormInput>(
    isSalesUser && salesName
      ? { ...emptyForm, sales: salesName, salesUserId: ownSalesUserId }
      : emptyForm,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [locations, setLocations] = useState<Array<{ value: string; label: string }>>([]);
  // Sales-department admins, kept unfiltered so the dropdown can be re-filtered
  // by hub whenever the selected pickup location changes.
  const [salesAdmins, setSalesAdmins] = useState<Array<{ userId: string; name: string; locationId: string | null }>>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Set if the global default rates couldn't be fetched to pre-fill the rate
  // fields. Non-blocking: blank rate fields mean "use the Settings default"
  // server-side, so the vendor is still created correctly - we just tell the
  // creator the fields weren't pre-filled.
  const [pricingDefaultsFailed, setPricingDefaultsFailed] = useState(false);

  useEffect(() => {
    const fetchHubs = async () => {
      try {
        const [res, me, adminsRes] = await Promise.all([
          getLocations(),
          getCurrentUser().catch(() => null),
          getAdmins().catch(() => null),
        ]);
        let hubs: Array<{ value: string; label: string }> = [];
        let imadolId = '';
        if (res && res.success && Array.isArray(res.data)) {
          // Vendors are assigned to a hub/branch, so only show hub locations.
          hubs = res.data
            .filter((loc: any) => loc.is_hub)
            .map((loc: any) => ({ value: loc.id, label: loc.name }));
          setLocations(hubs);
          const imadol = res.data.find(
            (loc: any) => (loc.code || '').toUpperCase() === 'IMADOL' || (loc.name || '').trim().toLowerCase() === 'imadol',
          );
          imadolId = imadol?.id || '';
        }
        // Sales staff = admins in the "Sales" department, each carrying their
        // own hub so the dropdown can be scoped to the vendor's hub below.
        if (adminsRes?.success && Array.isArray(adminsRes.data)) {
          setSalesAdmins(
            adminsRes.data
              .filter((a: any) => (a.department || '').toLowerCase() === 'sales')
              .map((a: any) => ({ userId: a.userId, name: a.name, locationId: a.locationId ?? null })),
          );
        }
        // Hub is fixed to the Imadol admin hub for every vendor. Fall back to the
        // admin's own hub / sole hub only if Imadol isn't found in the location list.
        const adminHubId: string | null = me?.hubId ?? null;
        const defaultHub = imadolId
          || (adminHubId && hubs.some(h => h.value === adminHubId) ? adminHubId : '')
          || (hubs.length === 1 ? hubs[0].value : '');
        if (defaultHub) {
          setForm(prev => (prev.pickupLocation ? prev : { ...prev, pickupLocation: defaultHub }));
        }
      } catch (err) {
        console.error('Failed to load hubs:', err);
      }
    };
    fetchHubs();
  }, []);

  // Re-scope the Sales dropdown to whichever hub is currently selected. No
  // sales staff for that hub is a valid state - the field stays optional so
  // the vendor can be saved unassigned rather than blocked.
  const salesOptions = React.useMemo(() => {
    // A sales user viewing/creating their own client is locked to themselves,
    // and won't necessarily show up in the (admin/super_admin-only) admins
    // list they may not even have permission to fetch - show their own name
    // regardless so the locked, disabled field doesn't render blank.
    if (isSalesUser) return salesName ? [{ value: ownSalesUserId, label: salesName }] : [];
    return salesAdmins
      .filter((a) => a.locationId && a.locationId === form.pickupLocation)
      .map((a) => ({ value: a.userId, label: a.name }));
  }, [salesAdmins, form.pickupLocation, isSalesUser, salesName, ownSalesUserId]);

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
          zoneInsideValley: prev.zoneInsideValley || str(d.zoneInsideValley),
          extraWeightPercent: prev.extraWeightPercent || str(d.extraWeightPercent),
        }));
      })
      .catch((err) => {
        console.error('Failed to load default delivery rates:', err);
        setPricingDefaultsFailed(true);
      });
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
          joinedAt: s(d.joinedAt),
          pickupLocation: s(d.locationId),
          registeredAddress: s(d.address),
          sales: s(d.sales),
          salesUserId: s(d.salesUserId),
          rateType: s(d.rateType) || 'flat',
          flatInsideValley: s(d.flatInsideValley),
          flatOutsideValley: s(d.flatOutsideValley),
          zoneMajorCities: s(d.zoneMajorCities),
          zoneUrbanAreas: s(d.zoneUrbanAreas),
          zoneRemoteAreas: s(d.zoneRemoteAreas),
          zoneInsideValley: s(d.zoneInsideValley),
          insideValleyFlatRate: s(d.insideValleyFlatRate),
          insideValleyEnabled: d.insideValleyFlatRate != null,
          extraWeightPercent: s(d.extraWeightPercent),
          returnInsideValleyPercent: s(d.returnInsideValleyPercent),
          returnOutsideValleyPercent: s(d.returnOutsideValleyPercent),
          branchFlatInsideValley: s(d.branchFlatInsideValley),
          branchFlatOutsideValley: s(d.branchFlatOutsideValley),
          branchZoneMajorCities: s(d.branchZoneMajorCities),
          branchZoneUrbanAreas: s(d.branchZoneUrbanAreas),
          branchZoneRemoteAreas: s(d.branchZoneRemoteAreas),
          branchZoneInsideValley: s(d.branchZoneInsideValley),
          pickupLandmark: s(d.pickupLandmark),
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
    if (!form.pickupLandmark.trim()) errors.pickupLandmark = 'Location is required';
    if (!form.businessContact.trim()) errors.businessContact = 'Contact number is required';
    else if (!isValidPhone(form.businessContact)) errors.businessContact = 'Enter a valid Nepali mobile number (e.g. 98XXXXXXXX)';
    if (!form.ownerName.trim()) errors.ownerName = 'Owner name is required';
    if (!form.ownerEmail.trim()) errors.ownerEmail = 'Email is required';
    else if (!isValidEmail(form.ownerEmail)) errors.ownerEmail = 'Enter a valid email address';
    if (!form.ownerContact.trim()) errors.ownerContact = 'Contact number is required';
    else if (!isValidPhone(form.ownerContact)) errors.ownerContact = 'Enter a valid Nepali mobile number (e.g. 98XXXXXXXX)';
    if (!form.joinedAt.trim()) errors.joinedAt = 'Joined date is required';
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
          phone: normalizePhone(form.ownerContact),
          email: form.ownerEmail,
          clientName: form.ownerName,
          businessName: form.onlineBusinessName,
          joinedAt: form.joinedAt || undefined,
          locationId: form.pickupLocation,
          address: form.registeredAddress,
          sales: form.sales,
          salesUserId: form.salesUserId,
          rateType: form.rateType,
          flatInsideValley: form.flatInsideValley,
          flatOutsideValley: form.flatOutsideValley,
          zoneMajorCities: form.zoneMajorCities,
          zoneUrbanAreas: form.zoneUrbanAreas,
          zoneRemoteAreas: form.zoneRemoteAreas,
          zoneInsideValley: form.zoneInsideValley,
          insideValleyFlatRate: form.insideValleyEnabled ? form.insideValleyFlatRate : '',
          returnInsideValleyPercent: form.returnInsideValleyPercent,
          returnOutsideValleyPercent: form.returnOutsideValleyPercent,
          branchFlatInsideValley: form.branchFlatInsideValley,
          branchFlatOutsideValley: form.branchFlatOutsideValley,
          branchZoneMajorCities: form.branchZoneMajorCities,
          branchZoneUrbanAreas: form.branchZoneUrbanAreas,
          branchZoneRemoteAreas: form.branchZoneRemoteAreas,
          branchZoneInsideValley: form.branchZoneInsideValley,
          pickupLandmark: form.pickupLandmark,
          billingBusinessName: form.onlineBusinessName,
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
        phone: normalizePhone(form.ownerContact),
        clientName: form.ownerName,
        businessName: form.onlineBusinessName,
        joinedAt: form.joinedAt || undefined,
        locationId: form.pickupLocation,
        address: form.registeredAddress,
        sales: form.sales,
        salesUserId: form.salesUserId,
        rateType: form.rateType,
        // Only send the override fields relevant to the chosen model.
        ...(form.rateType === 'flat'
          ? { flatInsideValley: form.flatInsideValley, flatOutsideValley: form.flatOutsideValley, extraWeightPercent: form.extraWeightPercent }
          : {}),
        ...(form.rateType === 'zone'
          ? {
              zoneMajorCities: form.zoneMajorCities,
              zoneUrbanAreas: form.zoneUrbanAreas,
              zoneRemoteAreas: form.zoneRemoteAreas,
              zoneInsideValley: form.zoneInsideValley,
              extraWeightPercent: form.extraWeightPercent,
            }
          : {}),
        ...(form.rateType === 'per_destination'
          ? { extraWeightPercent: form.extraWeightPercent }
          : {}),
        ...(form.insideValleyEnabled ? { insideValleyFlatRate: form.insideValleyFlatRate } : {}),
        // Return percents apply regardless of the primary rate model.
        returnInsideValleyPercent: form.returnInsideValleyPercent,
        returnOutsideValleyPercent: form.returnOutsideValleyPercent,
        // Branch overrides mirror the chosen model.
        ...(form.rateType === 'flat'
          ? { branchFlatInsideValley: form.branchFlatInsideValley, branchFlatOutsideValley: form.branchFlatOutsideValley }
          : {}),
        ...(form.rateType === 'zone'
          ? {
              branchZoneMajorCities: form.branchZoneMajorCities,
              branchZoneUrbanAreas: form.branchZoneUrbanAreas,
              branchZoneRemoteAreas: form.branchZoneRemoteAreas,
              branchZoneInsideValley: form.branchZoneInsideValley,
            }
          : {}),
        pickupLandmark: form.pickupLandmark,
        billingBusinessName: form.onlineBusinessName,
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
      // Zod rejections from the API name the exact offending fields — show
      // them inline instead of the generic "Validation failed".
      const serverErrors = extractServerFieldErrors(err, API_FIELD_MAP);
      if (serverErrors) {
        setFieldErrors(serverErrors.fieldErrors);
        setError(serverErrors.summary);
        setTimeout(() => {
          document.querySelector('.vfp-field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 0);
      } else {
        setError(err.response?.data?.message || 'Failed to create vendor. Please try again.');
      }
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
                  disabled
                  value={form.pickupLocation}
                  onChange={set('pickupLocation')}
                  placeholder="Select hub"
                  options={locations}
                />
                {fieldErrors.pickupLocation && (
                  <span className="vfp-field-error">{fieldErrors.pickupLocation}</span>
                )}
                <FormField
                  label="Location"
                  required
                  value={form.pickupLandmark}
                  onChange={set('pickupLandmark')}
                  placeholder="Enter location on Google Maps"
                />
                {fieldErrors.pickupLandmark && (
                  <span className="vfp-field-error">{fieldErrors.pickupLandmark}</span>
                )}
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
                  type="select"
                  value={form.salesUserId}
                  onChange={(value) => {
                    const picked = salesOptions.find((o) => o.value === value);
                    setForm((prev) => ({ ...prev, salesUserId: value, sales: picked?.label ?? '' }));
                  }}
                  placeholder={salesOptions.length === 0 ? 'No sales staff for this hub' : 'Unassigned'}
                  options={salesOptions}
                  disabled={isSalesUser}
                  hint={salesOptions.length === 0 ? 'No sales staff assigned to this hub yet — you can leave this unassigned.' : undefined}
                />
                {fieldErrors.sales && (
                  <span className="vfp-field-error">{fieldErrors.sales}</span>
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
                <FormField
                  label="Joined Date"
                  required
                  type="date"
                  value={form.joinedAt}
                  onChange={set('joinedAt')}
                />
                {fieldErrors.joinedAt && (
                  <span className="vfp-field-error">{fieldErrors.joinedAt}</span>
                )}
              </div>
            </section>

            {/* Login Credentials — create-only; placed in the left column so the
                two columns stay balanced when creating (it isn't shown on edit). */}
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

          {/* Right Column - Documents, Bank & Delivery Rate */}
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
              {pricingDefaultsFailed && (
                <p className="vfp-rate-notice">
                  Couldn't load the default rates, so these fields aren't pre-filled. Any left blank
                  will use the current Settings default.
                </p>
              )}
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
                    <FormField label="Extra weight surcharge (%)" type="number" min={0} max={100}
                      value={form.extraWeightPercent} onChange={set('extraWeightPercent')} placeholder="e.g. 10" />
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
                    <FormField label="Inside valley (Rs.)" type="number" min={0}
                      value={form.zoneInsideValley} onChange={set('zoneInsideValley')} placeholder="e.g. 200" />
                    <FormField label="Extra weight surcharge (%)" type="number" min={0} max={100}
                      value={form.extraWeightPercent} onChange={set('extraWeightPercent')} placeholder="e.g. 10" />
                  </div>
                </div>
              )}
              {form.rateType === 'per_destination' && (
                <div className="vfp-rate-fields">
                  <p className="vfp-rate-note">
                    Charged by each destination's own rate, configured in Settings → Rate Setup.
                  </p>
                  <div className="vfp-fields">
                    <FormField label="Extra weight surcharge (%)" type="number" min={0} max={100}
                      value={form.extraWeightPercent} onChange={set('extraWeightPercent')} placeholder="e.g. 10" />
                  </div>
                </div>
              )}
              {/* Optional second rate: a flat inside-valley rate that overrides the
                  primary model for inside-valley destinations. */}
              {(form.rateType === 'zone' || form.rateType === 'per_destination') && (
                <div className={`vfp-rate-fields vfp-inside-valley-block${form.insideValleyEnabled ? ' is-on' : ''}`}>
                  <label className="vfp-inside-valley-toggle">
                    <input
                      type="checkbox"
                      checked={form.insideValleyEnabled}
                      onChange={(e) => setForm((prev) => ({ ...prev, insideValleyEnabled: e.target.checked }))}
                    />
                    <span className="vfp-rate-text">
                      <strong>Also charge a flat rate for inside-valley deliveries</strong>
                      <small>
                        Overrides the {form.rateType === 'zone' ? 'zone' : 'per-destination'} rate above for
                        destinations classified inside valley.
                      </small>
                    </span>
                  </label>
                  {form.insideValleyEnabled && (
                    <div className="vfp-fields">
                      <FormField label="Inside valley flat rate (Rs.)" type="number" min={0}
                        value={form.insideValleyFlatRate} onChange={set('insideValleyFlatRate')} placeholder="e.g. 120" />
                    </div>
                  )}
                </div>
              )}
              {/* Branch delivery overrides — mirror the primary model; blank
                  falls back to the Settings branch defaults. */}
              {form.rateType === 'flat' && (
                <div className="vfp-rate-fields">
                  <p className="vfp-rate-note">Branch delivery rates (parcel dropped at a branch). Blank uses Settings.</p>
                  <div className="vfp-fields">
                    <FormField label="Branch — inside valley (Rs.)" type="number" min={0}
                      value={form.branchFlatInsideValley} onChange={set('branchFlatInsideValley')} placeholder="e.g. 80" />
                    <FormField label="Branch — outside valley (Rs.)" type="number" min={0}
                      value={form.branchFlatOutsideValley} onChange={set('branchFlatOutsideValley')} placeholder="e.g. 180" />
                  </div>
                </div>
              )}
              {form.rateType === 'zone' && (
                <div className="vfp-rate-fields">
                  <p className="vfp-rate-note">Branch delivery rates (parcel dropped at a branch). Blank uses Settings.</p>
                  <div className="vfp-fields">
                    <FormField label="Branch — major cities (Rs.)" type="number" min={0}
                      value={form.branchZoneMajorCities} onChange={set('branchZoneMajorCities')} placeholder="e.g. 200" />
                    <FormField label="Branch — urban areas (Rs.)" type="number" min={0}
                      value={form.branchZoneUrbanAreas} onChange={set('branchZoneUrbanAreas')} placeholder="e.g. 250" />
                    <FormField label="Branch — remote areas (Rs.)" type="number" min={0}
                      value={form.branchZoneRemoteAreas} onChange={set('branchZoneRemoteAreas')} placeholder="e.g. 400" />
                    <FormField label="Branch — inside valley (Rs.)" type="number" min={0}
                      value={form.branchZoneInsideValley} onChange={set('branchZoneInsideValley')} placeholder="e.g. 150" />
                  </div>
                </div>
              )}

              {/* Return rate: a return parcel has no COD but is billed this
                  percent of the normal delivery rate, by valley side. */}
              <div className="vfp-rate-fields">
                <p className="vfp-rate-note">
                  Return parcels carry no COD but are charged this percent of the normal delivery
                  rate. Leave blank to use the Settings default (e.g. 0% inside, 50% outside).
                </p>
                <div className="vfp-fields">
                  <FormField label="Return — inside valley (% of delivery)" type="number" min={0} max={100}
                    value={form.returnInsideValleyPercent} onChange={set('returnInsideValleyPercent')} placeholder="e.g. 0" />
                  <FormField label="Return — outside valley (% of delivery)" type="number" min={0} max={100}
                    value={form.returnOutsideValleyPercent} onChange={set('returnOutsideValleyPercent')} placeholder="e.g. 50" />
                </div>
              </div>

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
