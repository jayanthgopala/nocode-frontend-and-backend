/*
 * Shared helpers for the placement-exports frontend.
 *
 * The MAIN APP (your existing React app) owns login. This service just
 * trusts the token the main app already issued. Configure two things:
 *
 *   1. EXPORTS_BASE_URL — the public URL of this service.
 *   2. getAuthToken()    — read from wherever the main app stores its
 *                          auth token (localStorage, AuthContext, cookie).
 *
 * On 401 we clear nothing locally (the main app's session machinery does
 * that) and redirect the browser to MAIN_APP_LOGIN_URL.
 */

export const EXPORTS_BASE_URL =
  (typeof window !== 'undefined' && window.__EXPORTS_BASE_URL__) ||
  'https://exports.sumantheluri.tech';

export const MAIN_APP_LOGIN_URL =
  (typeof window !== 'undefined' && window.__MAIN_APP_LOGIN_URL__) ||
  '/login';

// TODO: replace with the main app's actual token source.
// Examples:
//   - localStorage:        localStorage.getItem('authToken')
//   - AuthContext:         useAuth().token  (call from a hook, not here)
//   - httpOnly cookie:     return null and use credentials: 'include' below
export function getAuthToken() {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem('authToken');
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

export async function handleApiResponse(res) {
  if (res.ok) return res;

  let body = null;
  try {
    body = await res.clone().json();
  } catch (_) {
    /* non-JSON response */
  }

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      window.location.href = MAIN_APP_LOGIN_URL;
    }
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
      return 'You do not have permission to export data.';
    case 'rate_limited':
      return 'Rate limit reached. Please try again in a few minutes.';
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
