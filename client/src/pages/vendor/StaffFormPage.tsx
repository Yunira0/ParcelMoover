import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
  LayoutDashboard,
  MessageSquare,
  Package,
  Ticket,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import {
  createStaff,
  updateStaff,
  STAFF_PERMISSIONS,
  type Staff,
  type StaffInput,
  type StaffPermission,
} from '../../services/staff.service';
import { getCurrentUser as fetchMe } from '../../services/auth.service';
import { isValidEmail, isValidName, isValidPhone } from '../../utils/serverValidation';
import './StaffFormPage.css';

const PERMISSION_ICONS: Record<StaffPermission, LucideIcon> = {
  DASHBOARD_ACCESS: LayoutDashboard,
  ORDER_ACCESS: Package,
  FINANCE_ACCESS: Wallet,
  USER_ACCESS: Users,
  TICKETS_ACCESS: Ticket,
  REMARKS_ACCESS: MessageSquare,
  DELIVERY_CHARGES_ACCESS: Truck,
};

const PERMISSION_DESCRIPTIONS: Record<StaffPermission, string> = {
  DASHBOARD_ACCESS: 'View analytics & summary',
  ORDER_ACCESS: 'Manage and track orders',
  FINANCE_ACCESS: 'Access financial reports',
  USER_ACCESS: 'Manage staff accounts',
  TICKETS_ACCESS: 'Handle support tickets',
  REMARKS_ACCESS: 'View and add remarks',
  DELIVERY_CHARGES_ACCESS: 'Configure delivery pricing',
};

const MIN_PASSWORD = 8;

const emptyForm: StaffInput = {
  name: '',
  email: '',
  phone: '',
  permissions: ['DASHBOARD_ACCESS'],
  enabled: true,
  password: '',
};

// ── Password input with show/hide toggle ──────────────────────────────────────
interface PasswordInputProps {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}

const PasswordInput: React.FC<PasswordInputProps> = ({
  label,
  required,
  value,
  onChange,
  placeholder,
  autoComplete = 'new-password',
}) => {
  const [visible, setVisible] = useState(false);
  const id = React.useId();
  return (
    <div className="form-group sfp-password-field">
      <label htmlFor={id}>
        {label}
        {required && <span className="required">*</span>}
      </label>
      <div className="sfp-password-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
        />
        <button
          type="button"
          className="sfp-password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          tabIndex={-1}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────────
const StaffFormPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Edit routes pass the staff record via location.state. Without it (direct URL
  // navigation or page refresh) we can't load the record, so redirect to the list.
  const isEditRoute = location.pathname !== '/user-management/staff/new';
  const editingStaff: Staff | null = (location.state as { staff?: Staff } | null)?.staff ?? null;
  const isEdit = !!editingStaff;

  React.useEffect(() => {
    if (isEditRoute && !editingStaff) navigate('/user-management', { replace: true });
  }, [isEditRoute, editingStaff, navigate]);

  const [form, setForm] = useState<StaffInput>(
    editingStaff
      ? {
          name: editingStaff.name,
          email: editingStaff.email,
          phone: editingStaff.phone ?? '',
          permissions: [...editingStaff.permissions],
          enabled: editingStaff.enabled,
          password: '',
        }
      : emptyForm,
  );
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Staff inherit the vendor's hub - show it read-only so the creator sees where
  // this staff account will operate. Sourced from the logged-in vendor's profile.
  const [vendorHub, setVendorHub] = useState('');

  React.useEffect(() => {
    fetchMe()
      .then((me) => setVendorHub(me.hubName ?? ''))
      .catch(() => {});
  }, []);

  const togglePermission = (permission: StaffPermission) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter((p) => p !== permission)
        : [...prev.permissions, permission],
    }));
  };

  const validateClientSide = (): string | null => {
    if (!form.name.trim()) return 'Full name is required.';
    if (!isValidName(form.name)) return "Enter a valid name (letters, spaces, . ' - only).";
    if (!form.email.trim()) return 'Email address is required.';
    if (!isValidEmail(form.email)) return 'Enter a valid email address.';
    if (!form.phone.trim()) return 'Phone number is required.';
    if (!isValidPhone(form.phone)) return 'Enter a valid Nepali mobile number (e.g. 98XXXXXXXX).';
    if (form.permissions.length === 0) return 'Select at least one permission.';

    const password = form.password ?? '';
    if (!isEdit) {
      if (password.length < MIN_PASSWORD)
        return `Password must be at least ${MIN_PASSWORD} characters.`;
      if (password !== confirmPassword) return 'Passwords do not match.';
    } else if (password !== '') {
      if (password.length < MIN_PASSWORD)
        return `New password must be at least ${MIN_PASSWORD} characters.`;
      if (password !== confirmPassword) return 'Passwords do not match.';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const clientError = validateClientSide();
    if (clientError) { setError(clientError); return; }

    const payload: StaffInput = {
      ...form,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      // Send undefined on edit when blank so the backend skips the hash update.
      password: form.password?.trim() || undefined,
    };

    setSubmitting(true);
    try {
      if (isEdit && editingStaff) {
        await updateStaff(editingStaff.id, payload);
      } else {
        await createStaff(payload);
      }
      navigate('/user-management');
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to save staff member.');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCount = form.permissions.length;
  const totalCount = STAFF_PERMISSIONS.length;

  return (
    <div className="sfp-page">
      <button type="button" className="sfp-back" onClick={() => navigate('/user-management')}>
        <ArrowLeft size={15} />
        Staff List
      </button>

      <div className="sfp-header">
        <h1>{isEdit ? 'Edit Staff Member' : 'Add New Staff Member'}</h1>
        <p>
          {isEdit
            ? `Update account details and permissions for ${editingStaff?.name}.`
            : 'Create a new staff account and configure their access permissions.'}
        </p>
      </div>

      <form className="sfp-form" onSubmit={handleSubmit} noValidate>
        <div className="sfp-body">
          {/* ── Left column ── */}
          <div className="sfp-left">
            <section className="sfp-section">
              <div className="sfp-section-heading">
                <h2>Basic Information</h2>
                <p>Name and email used to identify this account.</p>
              </div>
              <div className="sfp-fields">
                <FormField
                  label="Full Name"
                  required
                  value={form.name}
                  onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                  placeholder="e.g. Sarah Johnson"
                  autoComplete="name"
                />
                <FormField
                  label="Email Address"
                  type="email"
                  required
                  value={form.email}
                  onChange={(v) => setForm((f) => ({ ...f, email: v }))}
                  placeholder="e.g. sarah@company.com"
                  autoComplete="email"
                />
                <FormField
                  label="Phone Number"
                  required
                  value={form.phone}
                  onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
                  placeholder="e.g. 9800000000"
                  autoComplete="tel"
                />
                <FormField
                  label="Hub"
                  value={vendorHub || '—'}
                  onChange={() => {}}
                  disabled
                  hint="Staff operate from your vendor hub."
                />
              </div>
            </section>

            <section className="sfp-section">
              <div className="sfp-section-heading sfp-section-heading--with-icon">
                <span className="sfp-section-icon">
                  <KeyRound size={16} />
                </span>
                <div>
                  <h2>{isEdit ? 'Set / Change Password' : 'Login Credentials'}</h2>
                  <p>
                    {isEdit
                      ? 'Set a password so this staff member can log in. Leave blank to keep existing.'
                      : 'The staff member will log in with these credentials.'}
                  </p>
                </div>
              </div>
              <div className="sfp-fields">
                <PasswordInput
                  label={isEdit ? 'New Password' : 'Password'}
                  required={!isEdit}
                  value={form.password ?? ''}
                  onChange={(v) => setForm((f) => ({ ...f, password: v }))}
                  placeholder={`Min. ${MIN_PASSWORD} characters`}
                />
                <PasswordInput
                  label="Confirm Password"
                  required={!isEdit}
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  placeholder="Re-enter password"
                />
              </div>
              <p className="sfp-password-hint">
                {isEdit
                  ? 'Leave both fields blank to keep the current password unchanged.'
                  : `Minimum ${MIN_PASSWORD} characters. Staff can change their password after logging in.`}
              </p>
            </section>

            <section className="sfp-section">
              <div className="sfp-section-heading">
                <h2>Account Status</h2>
                <p>Deactivated accounts cannot log in.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.enabled}
                className={`sfp-status-row${form.enabled ? ' sfp-status-row--on' : ''}`}
                onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
              >
                <span className="sfp-status-track" aria-hidden="true">
                  <span className="sfp-status-knob" />
                </span>
                <span className="sfp-status-text">
                  <span className="sfp-status-label">{form.enabled ? 'Active' : 'Inactive'}</span>
                  <span className="sfp-status-hint">
                    {form.enabled
                      ? 'Staff member can log in and access permitted areas.'
                      : 'Account is deactivated — staff cannot log in.'}
                  </span>
                </span>
              </button>
            </section>
          </div>

          {/* ── Right column: permissions ── */}
          <section className="sfp-section sfp-section--perms">
            <div className="sfp-section-heading sfp-section-heading--row">
              <div>
                <h2>Access Permissions</h2>
                <p>Select the areas this staff member is allowed to access.</p>
              </div>
              <span className="sfp-perm-count">
                {selectedCount} / {totalCount} selected
              </span>
            </div>
            <div className="sfp-permission-grid">
              {STAFF_PERMISSIONS.map((permission) => {
                const Icon = PERMISSION_ICONS[permission.value];
                const desc = PERMISSION_DESCRIPTIONS[permission.value];
                const selected = form.permissions.includes(permission.value);
                return (
                  <button
                    key={permission.value}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    className={`sfp-perm-card${selected ? ' sfp-perm-card--selected' : ''}`}
                    onClick={() => togglePermission(permission.value)}
                  >
                    <span className="sfp-perm-card__check" aria-hidden="true">
                      {selected && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                          <polyline
                            points="1.5,5 4,7.5 8.5,2"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                    <span className="sfp-perm-card__icon">
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span className="sfp-perm-card__label">{permission.label}</span>
                    <span className="sfp-perm-card__desc">{desc}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {error && (
          <p role="alert" className="sfp-error">
            {error}
          </p>
        )}

        <div className="sfp-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/user-management')}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting
              ? isEdit ? 'Saving…' : 'Creating…'
              : isEdit ? 'Save Changes' : 'Create Staff Member'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default StaffFormPage;
