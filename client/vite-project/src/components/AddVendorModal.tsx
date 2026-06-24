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
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await registerUser({ ...formData, type: 'vendor' });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to add vendor');
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
            />
            <FormField
              label="Email"
              type="email"
              required
              value={formData.email}
              onChange={(value) => setFormData({ ...formData, email: value })}
            />
            <FormField
              label="Password"
              type="password"
              required
              value={formData.password}
              onChange={(value) => setFormData({ ...formData, password: value })}
            />
            <FormField
              label="Phone"
              required
              value={formData.phone}
              onChange={(value) => setFormData({ ...formData, phone: value })}
            />
            <FormField
              label="Client Name"
              required
              value={formData.clientName}
              onChange={(value) => setFormData({ ...formData, clientName: value })}
            />
            <FormField
              label="Business Name"
              required
              value={formData.businessName}
              onChange={(value) => setFormData({ ...formData, businessName: value })}
            />
            <FormField
              label="Address"
              gridColumn="span 2"
              value={formData.address}
              onChange={(value) => setFormData({ ...formData, address: value })}
            />
            <FormField
              label="Joined At"
              type="date"
              value={formData.joinedAt}
              onChange={(value) => setFormData({ ...formData, joinedAt: value })}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
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
