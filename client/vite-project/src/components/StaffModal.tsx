import React, { useEffect, useState } from 'react';
import './Modal.css';
import './StaffModal.css';
import FormField from './FormField';
import Button from './Button';
import {
  STAFF_PERMISSIONS,
  type Staff,
  type StaffInput,
  type StaffPermission,
} from '../services/staff.service';

interface StaffModalProps {
  isOpen: boolean;
  /** When provided the modal edits this staff member; otherwise it creates a new one. */
  staff?: Staff | null;
  onClose: () => void;
  onSubmit: (input: StaffInput) => Promise<void>;
}

const emptyForm: StaffInput = {
  name: '',
  email: '',
  permissions: ['DASHBOARD_ACCESS'],
  enabled: true,
};

const StaffModal: React.FC<StaffModalProps> = ({ isOpen, staff, onClose, onSubmit }) => {
  const [form, setForm] = useState<StaffInput>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Re-seed the form whenever the modal opens (create = blank, edit = staff's values).
  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setForm(
      staff
        ? { name: staff.name, email: staff.email, permissions: [...staff.permissions], enabled: staff.enabled }
        : emptyForm,
    );
  }, [isOpen, staff]);

  if (!isOpen) return null;

  const togglePermission = (permission: StaffPermission) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter((p) => p !== permission)
        : [...prev.permissions, permission],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim() || !form.email.trim()) {
      setError('Name and email are required.');
      return;
    }
    if (form.permissions.length === 0) {
      setError('Select at least one permission.');
      return;
    }

    setLoading(true);
    try {
      await onSubmit({ ...form, name: form.name.trim(), email: form.email.trim() });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.message || 'Failed to save staff.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>{staff ? 'Edit Staff' : 'Create New Staff'}</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose}>&times;</Button>
        </div>
        <form onSubmit={handleSubmit} className="staff-form">
          <div className="form-grid">
            <FormField
              label="Staff Name"
              required
              value={form.name}
              onChange={(value) => setForm({ ...form, name: value })}
            />
            <FormField
              label="Email"
              type="email"
              required
              value={form.email}
              onChange={(value) => setForm({ ...form, email: value })}
            />
          </div>

          <div className="staff-permissions">
            <span className="staff-permissions-label">Permissions</span>
            <div className="staff-permissions-grid">
              {STAFF_PERMISSIONS.map((permission) => (
                <label key={permission.value} className="staff-permission-option">
                  <input
                    type="checkbox"
                    checked={form.permissions.includes(permission.value)}
                    onChange={() => togglePermission(permission.value)}
                  />
                  <span>{permission.label}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="staff-enabled-toggle">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <span>Account enabled</span>
          </label>

          {error && <p className="error-text">{error}</p>}
          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? 'Saving...' : staff ? 'Save Changes' : 'Create Staff'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default StaffModal;
