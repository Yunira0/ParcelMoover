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

const EDIT_FIELD_MAP: Record<string, string> = {
  fullName: 'fullName', phone: 'phone', position: 'position',
  clientName: 'clientName', businessName: 'businessName', joinedAt: 'joinedAt',
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState('');

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
    setFieldErrors({});
    setGeneralError('');
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
    const errors: Record<string, string> = {};
    if (password.length < 8) errors.password = 'Password must be at least 8 characters long';
    if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      throw new Error('validation');
    }
    await updateUserPassword(userType, target.id, password);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setFieldErrors({});
    setGeneralError('');

    try {
      if (mode === 'edit') {
        await handleEditSubmit();
      } else {
        await handlePasswordSubmit();
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      if (err?.message === 'validation') return;
      const data = err.response?.data;
      if (data?.errors?.length) {
        const mapped: Record<string, string> = {};
        const unmapped: string[] = [];
        for (const e of data.errors as { field: string; message: string }[]) {
          const key = EDIT_FIELD_MAP[e.field];
          if (key) mapped[key] = e.message;
          else unmapped.push(e.message);
        }
        setFieldErrors(mapped);
        if (unmapped.length > 0) setGeneralError(unmapped[0]);
      } else {
        setGeneralError(data?.message || err.message || 'Action failed');
      }
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
                    error={fieldErrors.clientName}
                  />
                  <FormField
                    label="Business Name"
                    required
                    value={profileForm.businessName}
                    onChange={(value) => setProfileForm({ ...profileForm, businessName: value })}
                    error={fieldErrors.businessName}
                  />
                </>
              ) : (
                <FormField
                  label="Full Name"
                  required
                  value={profileForm.fullName}
                  onChange={(value) => setProfileForm({ ...profileForm, fullName: value })}
                  error={fieldErrors.fullName}
                />
              )}
              <FormField
                label="Phone"
                required
                value={profileForm.phone}
                onChange={(value) => setProfileForm({ ...profileForm, phone: value })}
                error={fieldErrors.phone}
              />
              {userType === 'admin' && (
                <FormField
                  label="Position"
                  required
                  value={profileForm.position}
                  onChange={(value) => setProfileForm({ ...profileForm, position: value })}
                  error={fieldErrors.position}
                />
              )}
              <FormField
                label="Joined At"
                type="date"
                value={profileForm.joinedAt}
                onChange={(value) => setProfileForm({ ...profileForm, joinedAt: value })}
                error={fieldErrors.joinedAt}
              />
            </div>
          ) : (
            <div className="form-grid">
              <FormField
                label="New Password"
                type="password"
                required
                minLength={8}
                hint="Min. 8 characters"
                value={password}
                onChange={setPassword}
                error={fieldErrors.password}
              />
              <FormField
                label="Confirm Password"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={setConfirmPassword}
                error={fieldErrors.confirmPassword}
              />
            </div>
          )}
          {generalError && <p className="error-text">{generalError}</p>}
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
