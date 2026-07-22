import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, KeyRound, LogOut, ShieldAlert } from 'lucide-react';
import Button from '../components/Button';
import { changePassword, logout } from '../services/auth.service';
import { getCurrentUser } from '../utils/auth';
import './ForceChangePasswordPage.css';

const MIN_LENGTH = 8;

const PasswordInput: React.FC<{
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}> = ({ id, label, value, onChange, placeholder, autoComplete }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="fcp-field">
      <label htmlFor={id}>{label}</label>
      <div className="fcp-input-wrap">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          className="fcp-eye"
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

const ForceChangePasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const user = getCurrentUser();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');

  // Lets someone bail out of this step to sign in with a different account -
  // the temporary-password login is otherwise a dead end until completed.
  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      // ignore - fall through to local cleanup regardless
    } finally {
      localStorage.removeItem('user');
      navigate('/login', { replace: true });
    }
  };

  const validate = (): string | null => {
    if (!current) return 'Current password is required.';
    if (next.length < MIN_LENGTH) return `New password must be at least ${MIN_LENGTH} characters.`;
    if (next !== confirm) return 'Passwords do not match.';
    if (next === current) return 'New password must be different from your current password.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const msg = validate();
    if (msg) { setError(msg); return; }

    setSubmitting(true);
    try {
      await changePassword(current, next);
      // Clear the flag from localStorage so guards don't redirect again.
      const stored = JSON.parse(localStorage.getItem('user') || 'null');
      if (stored) {
        localStorage.setItem('user', JSON.stringify({ ...stored, mustChangePassword: false }));
      }
      navigate('/dashboard', { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to change password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fcp-page">
      <div className="fcp-card">
        <div className="fcp-icon-wrap">
          <ShieldAlert size={32} />
        </div>
        <h1 className="fcp-title">Set Your Password</h1>
        <p className="fcp-subtitle">
          {user?.fullName ? `Hi ${user.fullName}, you` : 'You'} are logging in with a
          temporary password. Please set a permanent password to continue.
        </p>

        <div className="fcp-notice">
          <KeyRound size={15} />
          You won't be able to access the app until this step is complete.
        </div>

        <form className="fcp-form" onSubmit={handleSubmit} noValidate>
          <PasswordInput
            id="fcp-current"
            label="Temporary Password"
            value={current}
            onChange={setCurrent}
            placeholder="Enter the password from your email"
            autoComplete="current-password"
          />
          <PasswordInput
            id="fcp-new"
            label="New Password"
            value={next}
            onChange={setNext}
            placeholder={`Min. ${MIN_LENGTH} characters`}
            autoComplete="new-password"
          />
          <PasswordInput
            id="fcp-confirm"
            label="Confirm New Password"
            value={confirm}
            onChange={setConfirm}
            placeholder="Re-enter your new password"
            autoComplete="new-password"
          />

          {error && (
            <p role="alert" className="fcp-error">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" fullWidth disabled={submitting}>
            {submitting ? 'Saving…' : 'Set Password & Continue'}
          </Button>

          <button
            type="button"
            className="fcp-logout"
            onClick={handleLogout}
            disabled={submitting || loggingOut}
          >
            <LogOut size={15} />
            {loggingOut ? 'Logging out…' : 'Log out and use another account'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ForceChangePasswordPage;
