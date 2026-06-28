import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import Button from '../components/Button';
import FormField from '../components/FormField';
import { registerUser } from '../services/users.service';
import './AdminFormPage.css';

interface AdminFormInput {
  fullName: string;
  email: string;
  password: string;
  phone: string;
  position: string;
  joinedAt: string;
}

const emptyForm: AdminFormInput = {
  fullName: '',
  email: '',
  password: '',
  phone: '',
  position: '',
  joinedAt: new Date().toISOString().split('T')[0],
};

const AdminFormPage: React.FC = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState<AdminFormInput>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const set = (field: keyof AdminFormInput) => (value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const validate = (): string => {
    if (!form.fullName.trim()) return 'Full name is required';
    if (!form.email.trim()) return 'Email is required';
    if (!form.password.trim()) return 'Password is required';
    if (form.password.length < 8) return 'Password must be at least 8 characters';
    if (!form.position.trim()) return 'Position is required';
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const err = validate();
    if (err) { setError(err); setLoading(false); return; }

    try {
      await registerUser({
        type: 'admin',
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: form.phone,
        position: form.position,
        joinedAt: form.joinedAt,
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to create admin. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="afp-page">
        <button type="button" className="afp-back" onClick={() => navigate('/admin')}>
          <ArrowLeft size={15} />
          Admin List
        </button>
        <div className="afp-success-card">
          <CheckCircle size={52} className="afp-success-icon" />
          <h3>Admin Created Successfully!</h3>
          <p>Admin <strong>{form.fullName}</strong> has been created.</p>
          <p>Login credentials will be sent to <strong>{form.email}</strong>.</p>
          <div className="afp-success-actions">
            <Button variant="secondary" onClick={() => { setSubmitted(false); setForm(emptyForm); }}>
              Create Another Admin
            </Button>
            <Button variant="primary" onClick={() => navigate('/admin')}>
              Back to Admin List
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="afp-page">
      <button type="button" className="afp-back" onClick={() => navigate('/admin')}>
        <ArrowLeft size={15} />
        Admin List
      </button>

      <div className="afp-header">
        <h1>Add New Admin</h1>
        <p>Fill in the details below to create a new admin account.</p>
      </div>

      <form className="afp-form" onSubmit={handleSubmit} noValidate>
        <div className="afp-form-card">
          <div className="afp-section">
            <h3>Personal Information</h3>
            <div className="afp-grid">
              <FormField
                label="Full Name"
                required
                value={form.fullName}
                onChange={set('fullName')}
                placeholder="e.g. John Doe"
                gridColumn="span 2"
              />
              <FormField
                label="Email"
                type="email"
                required
                value={form.email}
                onChange={set('email')}
                placeholder="admin@example.com"
              />
              <FormField
                label="Phone"
                value={form.phone}
                onChange={set('phone')}
                placeholder="e.g. 9800000000"
              />
            </div>
          </div>

          <div className="afp-section">
            <h3>Account Details</h3>
            <div className="afp-grid">
              <FormField
                label="Position"
                required
                value={form.position}
                onChange={set('position')}
                placeholder="e.g. Operations Manager"
                gridColumn="span 2"
              />
              <FormField
                label="Joined At"
                type="date"
                value={form.joinedAt}
                onChange={set('joinedAt')}
              />
            </div>
          </div>

          <div className="afp-section">
            <h3>Login Credentials</h3>
            <div className="afp-grid">
              <FormField
                label="Password"
                type="password"
                required
                value={form.password}
                onChange={set('password')}
                placeholder="Min. 8 characters"
                gridColumn="span 2"
              />
            </div>
            <p className="afp-hint">Minimum 8 characters. Admin can change password after logging in.</p>
          </div>
        </div>

        {error && <p className="afp-error">{error}</p>}

        <div className="afp-actions">
          <Button type="button" variant="secondary" onClick={() => navigate('/admin')}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Creating...' : 'Create Admin'}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default AdminFormPage;
