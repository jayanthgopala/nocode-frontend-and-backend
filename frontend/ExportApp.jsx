import { useEffect, useState, useCallback } from 'react';
import {
  getAuthToken,
  fetchCurrentUser,
  clearAuthToken,
  ApiError,
} from './auth';
import LoginPage from './LoginPage';
import ExportPanel from './ExportPanel';

/*
 * ExportApp — single drop-in that decides between LoginPage and
 * ExportPanel based on whether a valid JWT is in storage. Renders a
 * brief "checking session…" state while it calls /api/auth/me on mount.
 *
 * Use this if your existing app doesn't already have routing for the
 * exports feature and you just want one component to mount somewhere.
 *
 * If you do have routing, ignore this file and import LoginPage and
 * ExportPanel directly into your routes.
 */

export default function ExportApp() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(() => Boolean(getAuthToken()));

  useEffect(() => {
    let cancelled = false;
    if (!getAuthToken()) {
      setChecking(false);
      return undefined;
    }
    (async () => {
      try {
        const u = await fetchCurrentUser();
        if (!cancelled) setUser(u);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'unauthorized') {
          clearAuthToken();
        }
        setUser(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLoginSuccess = useCallback((u) => setUser(u), []);
  const handleUnauthenticated = useCallback(() => setUser(null), []);

  if (checking) {
    return (
      <p style={{ textAlign: 'center', marginTop: 64, color: '#666' }}>
        Checking session…
      </p>
    );
  }

  if (!user) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  return <ExportPanel user={user} onUnauthenticated={handleUnauthenticated} />;
}
