import React, { useEffect, useState } from 'react';
import './Modal.css';
import FormField from './FormField';
import Button from './Button';
import {
  updateUserPassword,
  updateUserProfile,
  type UpdateUserProfileInput,
} from '../services/users.service';

type ManagedUserType = 'admin' | 'vendor' | 'rider';
type UserActionMode = 'edit' | 'password';

export interface ManagedUserActionTarget {
  id: string;
  name?: string;
  client?: string;
  company?: string;
  phone?: string;
  position?: string;
  joined?: string;
}

interface UserActionModalProps {
  isOpen: boolean;
  mode: UserActionMode;
  userType: ManagedUserType;
  target: ManagedUserActionTarget | null;
  onClose: () => void;
  onSuccess: () => void;
}

const userTypeLabels: Record<ManagedUserType, string> = {
  admin: 'Admin',
  vendor: 'Vendor',
  rider: 'Rider',
};

const initialProfileForm = {
  fullName: '',
  phone: '',
  position: '',
  clientName: '',
  businessName: '',
  joinedAt: '',
};

const UserActionModal: React.FC<UserActionModalProps> = ({
  isOpen,
  mode,
  userType,
  target,
  onClose,
  onSuccess,
}) => {
  const [profileForm, setProfileForm] = useState(initialProfileForm);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !target) return;

    setProfileForm({
      fullName: target.name || target.client || '',
      phone: target.phone || '',
      position: target.position || '',
      clientName: target.client || '',
      businessName: target.company || '',
      joinedAt: target.joined || '',
    });
    setPassword('');
    setConfirmPassword('');
    setError('');
  }, [isOpen, target]);

  if (!isOpen || !target) return null;

  const titleAction = mode === 'edit' ? 'Edit' : 'Update Password';
  const title = `${titleAction} ${userTypeLabels[userType]}`;

  const handleEditSubmit = async () => {
    const payload: UpdateUserProfileInput = {
      type: userType,
      phone: profileForm.phone,
      joinedAt: profileForm.joinedAt,
    };

    if (userType === 'vendor') {
      payload.fullName = profileForm.clientName;
      payload.clientName = profileForm.clientName;
      payload.businessName = profileForm.businessName;
    } else {
      payload.fullName = profileForm.fullName;
    }

    if (userType === 'admin') {
      payload.position = profileForm.position;
    }

    await updateUserProfile(target.id, payload);
  };

  const handlePasswordSubmit = async () => {
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long');
    }

    if (password !== confirmPassword) {
      throw new Error('Passwords do not match');
    }

    await updateUserPassword(userType, target.id, password);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (mode === 'edit') {
        await handleEditSubmit();
      } else {
        await handlePasswordSubmit();
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>{title}</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose} type="button">&times;</Button>
        </div>
        <form onSubmit={handleSubmit}>
          {mode === 'edit' ? (
            <div className="form-grid">
              {userType === 'vendor' ? (
                <>
                  <FormField
                    label="Client Name"
                    required
                    value={profileForm.clientName}
                    onChange={(value) => setProfileForm({ ...profileForm, clientName: value })}
                  />
                  <FormField
                    label="Business Name"
                    required
                    value={profileForm.businessName}
                    onChange={(value) => setProfileForm({ ...profileForm, businessName: value })}
                  />
                </>
              ) : (
                <FormField
                  label="Full Name"
                  required
                  value={profileForm.fullName}
                  onChange={(value) => setProfileForm({ ...profileForm, fullName: value })}
                />
              )}
              <FormField
                label="Phone"
                required
                value={profileForm.phone}
                onChange={(value) => setProfileForm({ ...profileForm, phone: value })}
              />
              {userType === 'admin' && (
                <FormField
                  label="Position"
                  required
                  value={profileForm.position}
                  onChange={(value) => setProfileForm({ ...profileForm, position: value })}
                />
              )}
              <FormField
                label="Joined At"
                type="date"
                value={profileForm.joinedAt}
                onChange={(value) => setProfileForm({ ...profileForm, joinedAt: value })}
              />
            </div>
          ) : (
            <div className="form-grid">
              <FormField
                label="New Password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={setPassword}
              />
              <FormField
                label="Confirm Password"
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={setConfirmPassword}
              />
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? 'Saving...' : titleAction}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserActionModal;
