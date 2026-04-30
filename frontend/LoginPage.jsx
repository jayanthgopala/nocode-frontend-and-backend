import { useState, useCallback } from 'react';
import { login, friendlyMessage, ApiError } from './auth';

/*
 * LoginPage — minimal email/password form for placement-exports.
 *
 * Props:
 *   onLoginSuccess(user) — called after a successful login. Use it to
 *     redirect (e.g. router.push('/exports')) or to flip a state flag in
 *     the parent.
 *
 * The auth helpers (token storage, API base URL, error mapping) live in
 * ./auth.js so this component and ExportPanel.jsx stay in sync.
 */

export default function LoginPage({ onLoginSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      if (submitting) return;
      setError(null);

      const trimmedEmail = email.trim();
      if (!trimmedEmail || !password) {
        setError('Enter your email and password.');
        return;
      }

      setSubmitting(true);
      try {
        const user = await login(trimmedEmail, password);
        setPassword('');
        if (typeof onLoginSuccess === 'function') onLoginSuccess(user);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'network_error') {
          setError('Cannot reach the server. Check your connection and try again.');
        } else {
          setError(friendlyMessage(err));
        }
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, submitting, onLoginSuccess]
  );

  return (
    <form
      className="login-page"
      onSubmit={handleSubmit}
      autoComplete="on"
      style={{
        maxWidth: 360,
        margin: '64px auto',
        padding: 24,
        border: '1px solid #e5e5e5',
        borderRadius: 8,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: 16 }}>Sign in</h2>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ display: 'block', marginBottom: 4 }}>Email</span>
        <input
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
          autoComplete="username"
          spellCheck={false}
          maxLength={254}
          style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
        />
      </label>

      <label style={{ display: 'block', marginBottom: 16 }}>
        <span style={{ display: 'block', marginBottom: 4 }}>Password</span>
        <input
          type="password"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          maxLength={1024}
          style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
        />
      </label>

      {error && (
        <p role="alert" style={{ color: '#b00020', marginTop: 0 }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{ width: '100%', padding: 10 }}
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
