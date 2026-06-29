import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Check, LogOut } from 'lucide-react';
import FormField from '../components/FormField';
import Button from '../components/Button';
import { getCurrentUser as fetchMe, changePassword, updateMe } from '../services/auth.service';
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

const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const cached = getCurrentUser();
  const [tab, setTab] = useState<Tab>('info');

  const handleLogout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    navigate('/login');
  };

  // Profile fields
  const [fullName, setFullName] = useState(cached?.fullName ?? '');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(cached?.email ?? '');
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
    fetchMe().then((data) => {
      setFullName(data.fullName ?? '');
      setPhone(data.phone ?? '');
      setEmail(data.email ?? '');
    }).catch(() => {});
  }, []);

  const handleInfoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) { setInfoError('Full name is required'); return; }
    setInfoLoading(true);
    setInfoError('');
    setInfoSuccess(false);
    try {
      const updated = await updateMe({ fullName, phone });
      // Sync localStorage so topnav name updates
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

  return (
    <div className="profile-page">
      <div className="profile-header">
        <div className="profile-avatar">
          <User size={32} />
        </div>
        <div className="profile-header-info">
          <h1>{fullName || cached?.fullName}</h1>
          <p className="profile-email">{email}</p>
          <div className="profile-roles">
            {roles.map((r) => (
              <span key={r} className="profile-role-badge">{ROLE_LABELS[r] ?? r}</span>
            ))}
          </div>
        </div>
        <Button variant="danger" className="profile-logout-btn" onClick={handleLogout}>
          <LogOut size={16} /> Log Out
        </Button>
      </div>

      <div className="profile-tabs">
        <button
          className={`profile-tab ${tab === 'info' ? 'active' : ''}`}
          onClick={() => setTab('info')}
        >
          <User size={15} /> Profile Info
        </button>
        <button
          className={`profile-tab ${tab === 'password' ? 'active' : ''}`}
          onClick={() => setTab('password')}
        >
          <Lock size={15} /> Change Password
        </button>
      </div>

      <div className="profile-body">
        {tab === 'info' && (
          <form className="profile-form" onSubmit={handleInfoSubmit}>
            <FormField
              label="Full Name"
              required
              value={fullName}
              onChange={setFullName}
              placeholder="Your full name"
            />
            <FormField
              label="Email Address"
              value={email}
              onChange={() => {}}
              disabled
            />
            <FormField
              label="Phone Number"
              value={phone}
              onChange={setPhone}
              placeholder="e.g. 9800000000"
            />

            {infoError && <p className="profile-error">{infoError}</p>}
            {infoSuccess && (
              <p className="profile-success"><Check size={15} /> Profile updated successfully</p>
            )}

            <div className="profile-form-actions">
              <Button type="submit" variant="primary" disabled={infoLoading}>
                {infoLoading ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </form>
        )}

        {tab === 'password' && (
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

            {pwdError && <p className="profile-error">{pwdError}</p>}
            {pwdSuccess && (
              <p className="profile-success"><Check size={15} /> Password changed successfully</p>
            )}

            <div className="profile-form-actions">
              <Button type="submit" variant="primary" disabled={pwdLoading}>
                {pwdLoading ? 'Updating…' : 'Update Password'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ProfilePage;
