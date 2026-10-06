import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { login } from '../services/auth.service';
import FormField from '../components/FormField';
import Button from '../components/Button';

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionChanged = searchParams.get('session') === 'changed';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await login({ email, password });
      if (response.success) {
        // Save user data to localStorage for ProtectedRoute to verify the session.
        // The accessToken itself lives in an httpOnly cookie, not in this body.
        localStorage.setItem('user', JSON.stringify(response.data));
        if (response.data?.mustChangePassword) {
          navigate('/change-password', { replace: true });
        } else {
          navigate('/dashboard');
        }
      } else {
        setError(response.message || 'Login failed');
      }
    } catch (err: unknown) {
      console.error('Login error details:', err);
      if (axios.isAxiosError(err) && err.response) {
        // Server responded with an error
        setError(err.response.data?.message || `Server error: ${err.response.status}`);
      } else if (axios.isAxiosError(err) && err.request) {
        // Request was made but no response received (e.g. server down, CORS)
        setError('Cannot reach the server. Please ensure the backend is running.');
      } else {
        // Something else happened
        setError(err instanceof Error ? err.message : 'An error occurred during login');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h2>Login to ParcelMoover</h2>
        {sessionChanged && (
          <div className="error-message" role="alert">
            Another account signed in on this browser. Sign in to continue to the dashboard.
          </div>
        )}
        <form onSubmit={handleSubmit}>
          <FormField
            label="Email Address"
            type="email"
            required
            value={email}
            onChange={setEmail}
            placeholder="Enter your email"
            autoComplete="email"
          />
          <FormField
            label="Password"
            type="password"
            required
            value={password}
            onChange={setPassword}
            placeholder="Enter your password"
            autoComplete="current-password"
          />
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <Button type="submit" variant="primary" fullWidth disabled={loading} className="login-submit-btn">
            {loading ? 'Authenticating...' : 'Login'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default Login;
