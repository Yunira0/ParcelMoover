import React, { useState } from 'react';
import './Modal.css';
import FormField from './FormField';
import Button from './Button';
import { registerUser, type RegisterUserInput } from '../services/users.service';

interface AddVendorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const VENDOR_FIELD_MAP: Record<string, string> = {
  fullName: 'fullName', email: 'email', password: 'password',
  phone: 'phone', clientName: 'clientName', businessName: 'businessName',
  address: 'address', joinedAt: 'joinedAt',
};

const AddVendorModal: React.FC<AddVendorModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [formData, setFormData] = useState<Omit<RegisterUserInput, 'type'>>({
    fullName: '',
    email: '',
    password: '',
    phone: '',
    clientName: '',
    businessName: '',
    address: '',
    joinedAt: new Date().toISOString().split('T')[0],
  });
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setFieldErrors({});
    setGeneralError('');

    try {
      await registerUser({ ...formData, type: 'vendor' });
      onSuccess();
      onClose();
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.errors?.length) {
        const mapped: Record<string, string> = {};
        const unmapped: string[] = [];
        for (const e of data.errors as { field: string; message: string }[]) {
          const key = VENDOR_FIELD_MAP[e.field];
          if (key) mapped[key] = e.message;
          else unmapped.push(e.message);
        }
        setFieldErrors(mapped);
        if (unmapped.length > 0) setGeneralError(unmapped[0]);
      } else {
        setGeneralError(data?.message || 'Failed to add vendor');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Add New Vendor</h2>
          <Button variant="ghost" size="icon" className="modal-close-btn" onClick={onClose}>&times;</Button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <FormField
              label="Full Name"
              required
              value={formData.fullName}
              onChange={(value) => setFormData({ ...formData, fullName: value })}
              error={fieldErrors.fullName}
            />
            <FormField
              label="Email"
              type="email"
              required
              value={formData.email}
              onChange={(value) => setFormData({ ...formData, email: value })}
              error={fieldErrors.email}
            />
            <FormField
              label="Password"
              type="password"
              required
              minLength={8}
              hint="Min. 8 characters"
              value={formData.password}
              onChange={(value) => setFormData({ ...formData, password: value })}
              error={fieldErrors.password}
            />
            <FormField
              label="Phone"
              required
              value={formData.phone}
              onChange={(value) => setFormData({ ...formData, phone: value })}
              error={fieldErrors.phone}
            />
            <FormField
              label="Client Name"
              required
              value={formData.clientName}
              onChange={(value) => setFormData({ ...formData, clientName: value })}
              error={fieldErrors.clientName}
            />
            <FormField
              label="Business Name"
              required
              value={formData.businessName}
              onChange={(value) => setFormData({ ...formData, businessName: value })}
              error={fieldErrors.businessName}
            />
            <FormField
              label="Address"
              gridColumn="span 2"
              value={formData.address}
              onChange={(value) => setFormData({ ...formData, address: value })}
              error={fieldErrors.address}
            />
            <FormField
              label="Joined At"
              type="date"
              value={formData.joinedAt}
              onChange={(value) => setFormData({ ...formData, joinedAt: value })}
              error={fieldErrors.joinedAt}
            />
          </div>
          {generalError && <p className="error-text">{generalError}</p>}
          <div className="modal-footer">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? 'Adding...' : 'Add Vendor'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddVendorModal;
