import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  KeyRound,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Package,
  Pencil,
  Search,
  Ticket,
  Truck,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import Table from '../../components/Table';
import Button from '../../components/Button';
import FormField from '../../components/FormField';
import {
  getStaff,
  updateStaff,
  PERMISSION_LABELS,
  setStaffEnabled,
  type Staff,
  type StaffPermission,
} from '../../services/staff.service';
import '../../components/Modal.css';
import './VendorUserManagement.css';

const PERMISSION_ICONS: Record<StaffPermission, LucideIcon> = {
  DASHBOARD_ACCESS: LayoutDashboard,
  ORDER_ACCESS: Package,
  FINANCE_ACCESS: Wallet,
  USER_ACCESS: Users,
  TICKETS_ACCESS: Ticket,
  REMARKS_ACCESS: MessageSquare,
  DELIVERY_CHARGES_ACCESS: Truck,
};

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'S';

const VendorUserManagement: React.FC = () => {
  const navigate = useNavigate();
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Password reset is its own action (separate from Edit): this holds the staff
  // member whose password is being changed, driving the modal below.
  const [pwdMember, setPwdMember] = useState<Staff | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdErrors, setPwdErrors] = useState<{ password?: string; confirmPassword?: string }>({});
  const [pwdGeneralError, setPwdGeneralError] = useState('');
  const [pwdSubmitting, setPwdSubmitting] = useState(false);

  const loadStaff = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStaff(await getStaff());
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load staff.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadStaff(); }, [loadStaff]);

  const visibleStaff = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return staff;
    return staff.filter(
      (s) => s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q),
    );
  }, [staff, searchQuery]);

  const openCreate = () => navigate('/user-management/staff/new');
  const openEdit = (member: Staff) =>
    navigate(`/user-management/staff/${member.id}/edit`, { state: { staff: member } });

  const openPassword = (member: Staff) => {
    setPwdMember(member);
    setNewPwd('');
    setConfirmPwd('');
    setPwdErrors({});
    setPwdGeneralError('');
  };

  const closePassword = () => setPwdMember(null);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwdMember) return;
    const errors: { password?: string; confirmPassword?: string } = {};
    if (newPwd.length < 8) errors.password = 'Password must be at least 8 characters.';
    if (newPwd !== confirmPwd) errors.confirmPassword = 'Passwords do not match.';
    if (Object.keys(errors).length > 0) { setPwdErrors(errors); return; }

    setPwdSubmitting(true);
    setPwdGeneralError('');
    try {
      // updateStaff validates the whole record, so resend the member's current
      // details unchanged alongside the new password.
      await updateStaff(pwdMember.id, {
        name: pwdMember.name,
        email: pwdMember.email,
        phone: pwdMember.phone,
        permissions: pwdMember.permissions,
        enabled: pwdMember.enabled,
        password: newPwd,
      });
      closePassword();
    } catch (err: any) {
      setPwdGeneralError(err?.response?.data?.message || 'Failed to update password.');
    } finally {
      setPwdSubmitting(false);
    }
  };

  const toggleEnabled = async (member: Staff) => {
    setTogglingId(member.id);
    try {
      await setStaffEnabled(member.id, !member.enabled);
      await loadStaff();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to update staff status.');
    } finally {
      setTogglingId(null);
    }
  };

  const columns = useMemo(
    () => [
      {
        header: 'SN',
        accessor: (member: Staff) => visibleStaff.findIndex((s) => s.id === member.id) + 1,
        width: '50px',
      },
      {
        header: 'STAFF NAME',
        accessor: (member: Staff) => (
          <div className="staff-name-cell">
            <span className="staff-avatar">{initials(member.name)}</span>
            <span className="staff-name">{member.name}</span>
          </div>
        ),
        width: '220px',
      },
      {
        header: 'EMAIL',
        accessor: (member: Staff) => (
          <span className="staff-email-cell">
            <Mail size={14} />
            {member.email}
          </span>
        ),
        width: '230px',
      },
      {
        header: 'PERMISSIONS',
        accessor: (member: Staff) => (
          <div className="staff-permission-chips">
            {member.permissions.map((permission) => {
              // Guard against legacy/unknown permission strings stored before the set changed.
              const Icon = PERMISSION_ICONS[permission];
              const label = PERMISSION_LABELS[permission];
              if (!Icon || !label) return null;
              return (
                <span key={permission} className="staff-permission-chip">
                  <Icon size={12} />
                  {label}
                </span>
              );
            })}
          </div>
        ),
      },
      {
        header: 'STATUS',
        accessor: (member: Staff) => (
          <div className="staff-status-cell">
            <button
              type="button"
              role="switch"
              aria-checked={member.enabled}
              className={`staff-switch ${member.enabled ? 'on' : ''}`}
              onClick={() => toggleEnabled(member)}
              disabled={togglingId === member.id}
              title={member.enabled ? 'Set inactive' : 'Set active'}
              aria-label={member.enabled ? 'Set inactive' : 'Set active'}
            >
              <span className="staff-switch-knob" />
            </button>
            <span className={`staff-status-label ${member.enabled ? 'active' : 'inactive'}`}>
              {member.enabled ? 'Active' : 'Inactive'}
            </span>
          </div>
        ),
        width: '150px',
      },
      {
        header: 'ACTIONS',
        accessor: (member: Staff) => (
          <div className="staff-actions-cell">
            <button
              type="button"
              className="staff-edit-btn"
              onClick={() => openEdit(member)}
              title="Edit staff"
              aria-label="Edit staff"
            >
              <Pencil size={14} />
              Edit
            </button>
            <button
              type="button"
              className="staff-password-btn"
              onClick={() => openPassword(member)}
              title="Update password"
              aria-label="Update password"
            >
              <KeyRound size={14} />
              Update password
            </button>
          </div>
        ),
        width: '230px',
      },
    ],
    [visibleStaff, togglingId],
  );

  return (
    <div className="vendor-user-page">
      <PageHeader
        title="Staff List"
        subtitle="Create staff accounts and control what each member can access."
        actionLabel="Create New Staff"
        actionIcon={<UserPlus size={16} />}
        onAction={openCreate}
      />

      <label className="vendor-user-search">
        <Search size={16} />
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search by name or email"
        />
      </label>

      {error && <p className="vendor-user-error">{error}</p>}

      <Table
        columns={columns}
        data={visibleStaff}
        selectable={false}
        loading={loading}
        loadingMessage="Loading staff..."
        emptyMessage="No staff found."
        minWidth="1080px"
      />

      {pwdMember && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Update Password — {pwdMember.name}</h2>
              <Button variant="ghost" size="icon" className="modal-close-btn" onClick={closePassword} type="button">
                &times;
              </Button>
            </div>
            <form onSubmit={submitPassword}>
              <div className="form-grid">
                <FormField
                  label="New Password"
                  type="password"
                  required
                  minLength={8}
                  hint="Min. 8 characters"
                  value={newPwd}
                  onChange={setNewPwd}
                  error={pwdErrors.password}
                />
                <FormField
                  label="Confirm Password"
                  type="password"
                  required
                  minLength={8}
                  value={confirmPwd}
                  onChange={setConfirmPwd}
                  error={pwdErrors.confirmPassword}
                />
              </div>
              {pwdGeneralError && <p className="error-text">{pwdGeneralError}</p>}
              <div className="modal-footer">
                <Button type="button" variant="secondary" onClick={closePassword}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={pwdSubmitting}>
                  {pwdSubmitting ? 'Saving...' : 'Update Password'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorUserManagement;
