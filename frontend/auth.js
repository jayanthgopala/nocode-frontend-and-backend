/*
 * Shared auth helpers for the placement-exports frontend.
 *
 * Configuration:
 *   - EXPORTS_BASE_URL is read from window.__EXPORTS_BASE_URL__ if present,
 *     otherwise falls back to the default below. Override at build time
 *     (e.g. set window.__EXPORTS_BASE_URL__ in index.html, or replace this
 *     value before bundling).
 *   - STORAGE_KEY isolates this app's token from the rest of the app.
 *
 * Security notes:
 *   - Stores the JWT in localStorage. Convenient, but vulnerable to XSS.
 *     For a hardened deployment, switch the backend to httpOnly cookies +
 *     CSRF tokens and remove the storage helpers from this file.
 *   - Always serve the frontend over HTTPS.
 */

export const EXPORTS_BASE_URL =
  (typeof window !== 'undefined' && window.__EXPORTS_BASE_URL__) ||
  'https://exports.sumantheluri.tech';

const STORAGE_KEY = 'placement_exports_token';

export function getAuthToken() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function storeAuthToken(token) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearAuthToken() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

export function authHeaders(extra) {
  const token = getAuthToken();
  return {
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export class ApiError extends Error {
  constructor(code, status, body) {
    super(code);
    this.code = code;
    this.status = status;
    this.body = body || null;
  }
}

/**
 * Inspect a fetch Response. Throws ApiError on failure (after parsing the
 * JSON body if any). On 401 also clears the stored token. Returns the
 * response unchanged on success.
 */
export async function handleApiResponse(res) {
  if (res.ok) return res;

  let body = null;
  try {
    body = await res.clone().json();
  } catch (_) {
    /* non-JSON response */
  }

  if (res.status === 401) {
    clearAuthToken();
    throw new ApiError('unauthorized', 401, body);
  }

  const code = (body && body.error) || `http_${res.status}`;
  throw new ApiError(code, res.status, body);
}

export function friendlyMessage(err) {
  if (!err) return 'Something went wrong. Please try again.';
  const code = err.code || err.message;
  switch (code) {
    case 'unauthorized':
      return 'Your session has expired. Please log in again.';
    case 'forbidden':
      return 'You do not have permission to perform this action.';
    case 'rate_limited':
      return 'Rate limit reached. Please try again in a few minutes.';
    case 'invalid_credentials':
      return 'Email or password is incorrect.';
    case 'invalid_table_id':
      return 'One of the selected tables is no longer available.';
    case 'table_not_found':
      return 'That table no longer exists.';
    case 'payload_too_large': {
      const b = err.body;
      if (b && b.tableName)
        return `"${b.tableName}" has ${b.rows} rows (limit ${b.limit}). Filter your data and try again.`;
      return 'Too much data to export. Filter your data first.';
    }
    case 'upstream_error':
      return 'The data source is temporarily unavailable. Try again shortly.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function filenameFromContentDisposition(header, fallback) {
  if (!header) return fallback;
  const m = /filename="?([^";]+)"?/.exec(header);
  return m && m[1] ? m[1] : fallback;
}

export async function login(email, password) {
  let res;
  try {
    res = await fetch(`${EXPORTS_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch (_) {
    throw new ApiError('network_error', 0, null);
  }
  await handleApiResponse(res);
  const body = await res.json();
  if (!body || !body.token || !body.user) {
    throw new ApiError('invalid_response', 200, body);
  }
  storeAuthToken(body.token);
  return body.user;
}

export async function fetchCurrentUser() {
  let res;
  try {
    res = await fetch(`${EXPORTS_BASE_URL}/api/auth/me`, {
      method: 'GET',
      headers: authHeaders({ Accept: 'application/json' }),
    });
  } catch (_) {
    throw new ApiError('network_error', 0, null);
  }
  await handleApiResponse(res);
  const body = await res.json();
  return (body && body.user) || null;
}

export async function logout() {
  try {
    await fetch(`${EXPORTS_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      headers: authHeaders({ Accept: 'application/json' }),
    });
  } catch (_) {
    /* best-effort; we still clear locally */
  }
  clearAuthToken();
}
