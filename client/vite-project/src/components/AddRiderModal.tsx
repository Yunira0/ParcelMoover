import React, { useState, useEffect } from 'react';
import './Modal.css';
import FormField from './FormField';
import Button from './Button';
import { registerUser, getLocations, type RegisterUserInput } from '../services/users.service';

interface AddRiderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AddRiderModal: React.FC<AddRiderModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [formData, setFormData] = useState<Omit<RegisterUserInput, 'type'>>({
    fullName: '',
    email: '',
    password: '',
    phone: '',
    locationId: '',
    joinedAt: new Date().toISOString().split('T')[0],
  });
  const [locations, setLocations] = useState<{ id: string, name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      const fetchLocations = async () => {
        try {
          const res = await getLocations();
          if (res.success && Array.isArray(res.data)) {
            setLocations(res.data);
          }
        } catch (err) {
          console.error('Failed to fetch locations:', err);
        }
      };
      fetchLocations();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await registerUser({ ...formData, type: 'rider' });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to add rider');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Add New Rider</h2>
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
              label="Location"
              type="select"
              required
              placeholder="Select Location"
              options={locations.map((loc) => ({ value: loc.id, label: loc.name }))}
              value={formData.locationId}
              onChange={(value) => setFormData({ ...formData, locationId: value })}
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
              {loading ? 'Adding...' : 'Add Rider'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddRiderModal;
