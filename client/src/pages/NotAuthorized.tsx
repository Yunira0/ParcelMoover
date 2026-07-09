import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import Button from '../components/Button';

const NotAuthorized: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 'var(--space-4)',
        minHeight: '60vh',
        padding: 'var(--space-6)',
      }}
    >
      <ShieldAlert size={56} style={{ color: 'var(--color-text-danger, #dc2626)' }} />
      <h1 style={{ margin: 0, fontSize: '1.4rem', color: 'var(--color-text-default)' }}>
        Not Authorized
      </h1>
      <p style={{ margin: 0, maxWidth: 420, color: 'var(--color-text-caption)' }}>
        You don't have permission to view this page. If you think this is a mistake,
        contact your administrator.
      </p>
      <Button variant="primary" onClick={() => navigate('/dashboard')}>
        Back to Dashboard
      </Button>
    </div>
  );
};

export default NotAuthorized;
