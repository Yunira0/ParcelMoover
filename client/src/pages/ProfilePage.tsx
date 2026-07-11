import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Check, LogOut, MapPin, Mail, Phone, Shield } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import SegmentedTabs from '../components/SegmentedTabs';
import StatusChip from '../components/StatusChip';
import FormField from '../components/FormField';
import Button from '../components/Button';
import { getCurrentUser as fetchMe, changePassword, logout, updateMe } from '../services/auth.service';
import { getCurrentUser, getCurrentUserRoles } from '../utils/auth';
import './ProfilePage.css';

type Tab = 'info' | 'password';

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  vendor: 'Vendor',
  vendor_staff: 'Vendor Staff',
  rider: 'Rider',
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const cached = getCurrentUser();
  const [tab, setTab] = useState<Tab>('info');

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore — clean up locally regardless
    } finally {
      localStorage.removeItem('user');
      navigate('/login');
    }
  };

  // Loading state
  const [loading, setLoading] = useState(true);

  // Profile fields
  const [fullName, setFullName] = useState(cached?.fullName ?? '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(cached?.email ?? '');
  const [hubName, setHubName] = useState('');
  const [accountStatus, setAccountStatus] = useState('');
  const [infoLoading, setInfoLoading] = useState(false);
  const [infoSuccess, setInfoSuccess] = useState(false);
  const [infoError, setInfoError] = useState('');

  // Password fields
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdSuccess, setPwdSuccess] = useState(false);
  const [pwdError, setPwdError] = useState('');

  const roles = getCurrentUserRoles();

  useEffect(() => {
    fetchMe()
      .then((data) => {
        setFullName(data.fullName ?? '');
        setPhone(data.phone ?? '');
        setEmail(data.email ?? '');
        setHubName(data.hubName ?? '');
        setAccountStatus(data.status ?? 'active');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) { setInfoError('Full name is required'); return; }
    setInfoLoading(true);
    setInfoError('');
    setInfoSuccess(false);
    try {
      const updated = await updateMe({ fullName, phone });
      const stored = JSON.parse(localStorage.getItem('user') || 'null');
      if (stored) localStorage.setItem('user', JSON.stringify({ ...stored, fullName: updated.fullName }));
      setInfoSuccess(true);
      setTimeout(() => setInfoSuccess(false), 3000);
    } catch (err: any) {
      setInfoError(err?.response?.data?.error || 'Failed to update profile.');
    } finally {
      setInfoLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPwd) { setPwdError('Current password is required'); return; }
    if (newPwd.length < 8) { setPwdError('New password must be at least 8 characters'); return; }
    if (newPwd !== confirmPwd) { setPwdError('Passwords do not match'); return; }
    if (newPwd === currentPwd) { setPwdError('New password must be different from current password'); return; }

    setPwdLoading(true);
    setPwdError('');
    setPwdSuccess(false);
    try {
      await changePassword(currentPwd, newPwd);
      setPwdSuccess(true);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setTimeout(() => setPwdSuccess(false), 3000);
    } catch (err: any) {
      setPwdError(err?.response?.data?.message || 'Failed to change password.');
    } finally {
      setPwdLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="profile-page">
        <div className="profile-skeleton-header" />
        <div className="profile-skeleton-tabs" />
        <div className="profile-skeleton-body" />
      </div>
    );
  }

  const statusTone = accountStatus === 'active' ? 'success' : 'warning';

  return (
    <div className="profile-page">
      <PageHeader
        title="My Profile"
        subtitle="Manage your account information and security settings."
      />

      <div className="profile-overview">
        <div className="profile-avatar">
          {getInitials(fullName || cached?.fullName || 'U')}
        </div>
        <div className="profile-overview-info">
          <h2>{fullName || cached?.fullName}</h2>
          <p className="profile-overview-email">{email}</p>
          <div className="profile-overview-meta">
            <div className="profile-roles">
              {roles.map((r) => (
                <span key={r} className="profile-role-badge">{ROLE_LABELS[r] ?? r}</span>
              ))}
            </div>
            {hubName && (
              <span className="profile-hub-badge">
                <MapPin size={12} /> {hubName}
              </span>
            )}
            <StatusChip tone={statusTone} variant="solid">
              {accountStatus === 'active' ? 'Active' : 'Inactive'}
            </StatusChip>
          </div>
        </div>
      </div>

      <SegmentedTabs
        ariaLabel="Profile sections"
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={[
          { value: 'info', label: 'Personal Info' },
          { value: 'password', label: 'Security' },
        ]}
        fullWidth={false}
      />

      {tab === 'info' && (
        <div className="profile-tab-content">
          <section className="profile-section">
            <div className="profile-section-header">
              <Shield size={16} />
              <h3>Account Details</h3>
            </div>
            <div className="profile-detail-grid">
              <div className="profile-detail-item">
                <span className="profile-detail-label"><Mail size={13} /> Email</span>
                <span className="profile-detail-value">{email}</span>
              </div>
              <div className="profile-detail-item">
                <span className="profile-detail-label"><Phone size={13} /> Phone</span>
                <span className="profile-detail-value">{phone || '—'}</span>
              </div>
              <div className="profile-detail-item">
                <span className="profile-detail-label"><MapPin size={13} /> Hub</span>
                <span className="profile-detail-value">{hubName || '—'}</span>
              </div>
              <div className="profile-detail-item">
                <span className="profile-detail-label">Status</span>
                <span className="profile-detail-value">
                  <StatusChip tone={statusTone} variant="solid">
                    {accountStatus === 'active' ? 'Active' : 'Inactive'}
                  </StatusChip>
                </span>
              </div>
              <div className="profile-detail-item profile-detail-item-full">
                <span className="profile-detail-label"><Shield size={13} /> Roles</span>
                <div className="profile-detail-value profile-detail-roles">
                  {roles.map((r) => (
                    <StatusChip key={r} tone="info" variant="outline">
                      {ROLE_LABELS[r] ?? r}
                    </StatusChip>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="profile-section">
            <div className="profile-section-header">
              <User size={16} />
              <h3>Personal Information</h3>
            </div>
            <form className="profile-form" onSubmit={handleInfoSubmit}>
              <FormField
                label="Full Name"
                required
                value={fullName}
                onChange={setFullName}
                placeholder="Your full name"
              />
              <FormField
                label="Phone Number"
                value={phone}
                onChange={setPhone}
                placeholder="e.g. 9800000000"
              />

              {infoError && <p className="profile-alert profile-alert-error">{infoError}</p>}
              {infoSuccess && (
                <p className="profile-alert profile-alert-success"><Check size={14} /> Profile updated successfully</p>
              )}

              <div className="profile-form-actions">
                <Button type="submit" variant="primary" disabled={infoLoading}>
                  {infoLoading ? 'Saving\u2026' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}

      {tab === 'password' && (
        <div className="profile-tab-content">
          <section className="profile-section">
            <div className="profile-section-header">
              <Lock size={16} />
              <h3>Change Password</h3>
            </div>
            <form className="profile-form" onSubmit={handlePasswordSubmit}>
              <FormField
                label="Current Password"
                type="password"
                required
                value={currentPwd}
                onChange={setCurrentPwd}
                placeholder="Enter current password"
              />
              <FormField
                label="New Password"
                type="password"
                required
                value={newPwd}
                onChange={setNewPwd}
                placeholder="Min. 8 characters"
              />
              <FormField
                label="Confirm New Password"
                type="password"
                required
                value={confirmPwd}
                onChange={setConfirmPwd}
                placeholder="Re-enter new password"
              />

              {pwdError && <p className="profile-alert profile-alert-error">{pwdError}</p>}
              {pwdSuccess && (
                <p className="profile-alert profile-alert-success"><Check size={14} /> Password changed successfully</p>
              )}

              <div className="profile-form-actions">
                <Button type="submit" variant="primary" disabled={pwdLoading}>
                  {pwdLoading ? 'Updating\u2026' : 'Update Password'}
                </Button>
              </div>
            </form>
          </section>
        </div>
      )}

      <div className="profile-logout">
        <Button variant="danger" onClick={handleLogout}>
          <LogOut size={15} /> Log Out
        </Button>
      </div>
    </div>
  );
};

export default ProfilePage;
