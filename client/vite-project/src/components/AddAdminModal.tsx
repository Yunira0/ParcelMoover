import React, { useState } from 'react';
import './Modal.css';
import FormField from './FormField';
import Button from './Button';
import { registerUser, type RegisterUserInput } from '../services/users.service';

interface AddAdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AddAdminModal: React.FC<AddAdminModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [formData, setFormData] = useState<Omit<RegisterUserInput, 'type'>>({
    fullName: '',
    email: '',
    password: '',
    phone: '',
    position: '',
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
      await registerUser({ ...formData, type: 'admin' });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to add admin');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Add New Admin</h2>
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
              value={formData.phone}
              onChange={(value) => setFormData({ ...formData, phone: value })}
            />
            <FormField
              label="Position"
              required
              value={formData.position}
              onChange={(value) => setFormData({ ...formData, position: value })}
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
              {loading ? 'Adding...' : 'Add Admin'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddAdminModal;
