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

const RIDER_FIELD_MAP: Record<string, string> = {
  fullName: 'fullName',
  email: 'email',
  password: 'password',
  phone: 'phone',
  locationId: 'locationId',
  joinedAt: 'joinedAt',
};

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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState('');

  useEffect(() => {
    if (isOpen) {
      const fetchLocations = async () => {
        try {
          const res = await getLocations();
          if (res.success && Array.isArray(res.data)) {
            setLocations(res.data);
            // Location (hub) is fixed to the Imadol admin hub.
            const imadol = res.data.find(
              (loc: any) => (loc.code || '').toUpperCase() === 'IMADOL' || (loc.name || '').trim().toLowerCase() === 'imadol',
            );
            if (imadol?.id) {
              setFormData((prev) => (prev.locationId ? prev : { ...prev, locationId: imadol.id }));
            }
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
    setFieldErrors({});
    setGeneralError('');

    try {
      await registerUser({ ...formData, type: 'rider' });
      onSuccess();
      onClose();
    } catch (err: any) {
      const data = err.response?.data;
      if (data?.errors?.length) {
        const mapped: Record<string, string> = {};
        const unmapped: string[] = [];
        for (const e of data.errors as { field: string; message: string }[]) {
          const key = RIDER_FIELD_MAP[e.field];
          if (key) mapped[key] = e.message;
          else unmapped.push(e.message);
        }
        setFieldErrors(mapped);
        if (unmapped.length > 0) setGeneralError(unmapped[0]);
      } else {
        setGeneralError(data?.message || 'Failed to add rider');
      }
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
              label="Location"
              type="select"
              required
              disabled
              placeholder="Select Location"
              options={locations.map((loc) => ({ value: loc.id, label: loc.name }))}
              value={formData.locationId}
              onChange={(value) => setFormData({ ...formData, locationId: value })}
              error={fieldErrors.locationId}
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
              {loading ? 'Adding...' : 'Add Rider'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddRiderModal;
