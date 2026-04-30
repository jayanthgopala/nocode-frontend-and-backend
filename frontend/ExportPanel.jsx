import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  EXPORTS_BASE_URL,
  authHeaders,
  handleApiResponse,
  friendlyMessage,
  downloadBlob,
  filenameFromContentDisposition,
  logout as doLogout,
  ApiError,
} from './auth';

/*
 * ExportPanel — checkbox list of NocoDB tables, Excel/CSV download.
 *
 * Props:
 *   user            — { id, email, role } from /api/auth/login or /api/auth/me
 *   onUnauthenticated() — called if a request returns 401 (token cleared).
 *                         Use it to flip the parent back to <LoginPage/>.
 */

export default function ExportPanel({ user, onUnauthenticated }) {
  const [tables, setTables] = useState([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const [tablesError, setTablesError] = useState(null);

  const [selected, setSelected] = useState(() => new Set());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const [csvBusy, setCsvBusy] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleAuthFailure = useCallback(
    (err) => {
      if (err instanceof ApiError && err.code === 'unauthorized') {
        if (typeof onUnauthenticated === 'function') onUnauthenticated();
        return true;
      }
      return false;
    },
    [onUnauthenticated]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingTables(true);
      setTablesError(null);
      try {
        const res = await fetch(`${EXPORTS_BASE_URL}/api/exports/tables`, {
          method: 'GET',
          headers: authHeaders({ Accept: 'application/json' }),
        });
        await handleApiResponse(res);
        const body = await res.json();
        if (!cancelled) setTables(Array.isArray(body.tables) ? body.tables : []);
      } catch (err) {
        if (cancelled) return;
        if (handleAuthFailure(err)) return;
        setTablesError(friendlyMessage(err));
      } finally {
        if (!cancelled) setLoadingTables(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handleAuthFailure]);

  const allIds = useMemo(() => tables.map((t) => t.id), [tables]);
  const allSelected = selected.size > 0 && selected.size === allIds.length;

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => setSelected(new Set(allIds)), [allIds]);
  const clearAll = useCallback(() => setSelected(new Set()), []);

  const exportExcel = useCallback(async () => {
    if (exporting || selected.size === 0) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch(`${EXPORTS_BASE_URL}/api/exports/excel`, {
        method: 'POST',
        headers: authHeaders({
          'Content-Type': 'application/json',
          Accept:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        body: JSON.stringify({ tableIds: Array.from(selected) }),
      });
      await handleApiResponse(res);
      const blob = await res.blob();
      const filename = filenameFromContentDisposition(
        res.headers.get('content-disposition'),
        `placement-export-${Date.now()}.xlsx`
      );
      downloadBlob(blob, filename);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      setExportError(friendlyMessage(err));
    } finally {
      setExporting(false);
    }
  }, [exporting, selected, handleAuthFailure]);

  const exportCsv = useCallback(
    async (table) => {
      if (csvBusy) return;
      setCsvBusy(table.id);
      setExportError(null);
      try {
        const res = await fetch(
          `${EXPORTS_BASE_URL}/api/exports/csv/${encodeURIComponent(table.id)}`,
          {
            method: 'GET',
            headers: authHeaders({ Accept: 'text/csv' }),
          }
        );
        await handleApiResponse(res);
        const blob = await res.blob();
        const filename = filenameFromContentDisposition(
          res.headers.get('content-disposition'),
          `${table.name}-${Date.now()}.csv`
        );
        downloadBlob(blob, filename);
      } catch (err) {
        if (handleAuthFailure(err)) return;
        setExportError(friendlyMessage(err));
      } finally {
        setCsvBusy(null);
      }
    },
    [csvBusy, handleAuthFailure]
  );

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await doLogout();
    } finally {
      setLoggingOut(false);
      if (typeof onUnauthenticated === 'function') onUnauthenticated();
    }
  }, [loggingOut, onUnauthenticated]);

  return (
    <div className="export-panel" style={{ padding: 16, maxWidth: 640, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0 }}>Export placement data</h2>
        {user && (
          <div style={{ fontSize: 14, color: '#555' }}>
            <span style={{ marginRight: 12 }}>
              {user.email}
              {user.role ? ` · ${user.role}` : ''}
            </span>
            <button type="button" onClick={handleLogout} disabled={loggingOut}>
              {loggingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        )}
      </div>

      {loadingTables && <p>Loading tables…</p>}
      {tablesError && (
        <p role="alert" style={{ color: '#b00020' }}>
          {tablesError}
        </p>
      )}

      {!loadingTables && !tablesError && tables.length === 0 && (
        <p>No tables available.</p>
      )}

      {tables.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            <button
              type="button"
              onClick={allSelected ? clearAll : selectAll}
              disabled={exporting}
            >
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
            <span style={{ color: '#666' }}>{selected.size} selected</span>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {tables.map((t) => (
              <li
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: '1px solid #eee',
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                    disabled={exporting}
                  />
                  <span>{t.name}</span>
                </label>
                <button
                  type="button"
                  onClick={() => exportCsv(t)}
                  disabled={!!csvBusy || exporting}
                >
                  {csvBusy === t.id ? 'Downloading…' : 'CSV'}
                </button>
              </li>
            ))}
          </ul>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={exportExcel}
              disabled={exporting || selected.size === 0}
            >
              {exporting ? 'Building Excel…' : `Download Excel (${selected.size})`}
            </button>
          </div>
        </>
      )}

      {exportError && (
        <p role="alert" style={{ color: '#b00020', marginTop: 12 }}>
          {exportError}
        </p>
      )}
    </div>
  );
}
