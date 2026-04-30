# Placement Exports Service

A standalone Node.js/Express microservice that lets authorized users (TPO, admins) export placement data from NocoDB into Excel or CSV files.

This service is a **pure resource server**: the **main backend** (your existing app's API) owns login and sessions. Every request to this service forwards its auth token to the main backend's verify endpoint and trusts whatever user/role comes back. No second login form, no second user list, no second password store.

---

## What it does

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Liveness probe |
| `GET /api/exports/tables` | required | Lists `{id, name}` of all NocoDB tables in the configured base |
| `POST /api/exports/excel` | required | Body: `{ "tableIds": ["..."] }`. Streams a multi-sheet `.xlsx` |
| `GET /api/exports/csv/:tableId` | required | Streams a single CSV |

Default auth header: `Authorization: Bearer <token>`. Configurable. Every authenticated request emits one JSON audit log line on stdout.

---

## Architecture

```
React frontend
   │
   │  Authorization: Bearer <token>
   ▼
exports-service ──── server-to-server verify ────▶ main backend  (/api/auth/me)
   │                                                  │
   │  xc-token                                        └─ returns { user: {id,email,role} }
   ▼
NocoDB ──▶ Postgres (read-only role)
```

- **No DB write access.** All data is read through NocoDB's REST API, which connects with a read-only Postgres user.
- **No standalone auth.** This service never sees passwords. It only forwards tokens to the main backend.

---

## Connect to the main backend

The exports service calls **one** endpoint on the main backend to verify each request. You don't need to add anything to the main backend if it already has a "who am I" endpoint.

### Step 1 — find the verify endpoint

Anything that takes the user's token and returns the user object will do. Common shapes:

```
GET /api/auth/me            → { id, email, role }
GET /api/auth/me            → { user: { id, email, role } }
GET /api/users/current      → { data: { id, email, role } }
```

The middleware unwraps `{user:{...}}`, `{data:{...}}`, or root-level objects automatically. Field names are configurable.

### Step 2 — pick the URL

Use the **internal Docker hostname**, not the public URL — it's faster, doesn't go through Cloudflare/Traefik, and doesn't depend on DNS.

| Where the main backend runs | `MAIN_BACKEND_URL` |
| --- | --- |
| Same VPS, same Docker network (`placement-network`) | `http://<service-or-container-name>:<internal-port>` (e.g. `http://main-backend:3000`) |
| Same VPS, different network | Add this service's container to that network in `docker-compose.yml`, then use the internal name |
| Different host | `https://api.sumantheluri.tech` (public URL) |

To find the right name on the VPS:

```bash
docker network inspect placement-network --format '{{range .Containers}}{{.Name}}{{"\n"}}{{end}}'
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
```

### Step 3 — configure these env vars in Dokploy

| Variable | Example | What it is |
| --- | --- | --- |
| `MAIN_BACKEND_URL` | `http://main-backend:3000` | Base URL (no trailing slash) |
| `MAIN_BACKEND_VERIFY_PATH` | `/api/auth/me` | Path on the main backend |
| `AUTH_HEADER_NAME` | `Authorization` | Header the frontend sends |
| `AUTH_HEADER_PREFIX` | `Bearer` | Prefix before the token, or empty |
| `AUTH_USER_ID_FIELD` | `id` | Where the user id lives in the response |
| `AUTH_USER_EMAIL_FIELD` | `email` | Where the user email lives |
| `AUTH_USER_ROLE_FIELD` | `role` | Where the role lives |
| `ALLOWED_ROLES` | `admin,tpo` | Comma-separated; case-insensitive |

### Step 4 — verify it works

From the **VPS shell** (inside the Docker network), reproduce the call the exports service will make:

```bash
docker exec -it placement-exports sh -c \
  'wget -qO- --header="Authorization: Bearer $REAL_TOKEN" "$MAIN_BACKEND_URL$MAIN_BACKEND_VERIFY_PATH"'
```

You should see the user JSON. If you get `Connection refused`: wrong hostname/port, or the two services aren't on the same network. If you get 404: wrong path. If you get 401: token is wrong (try a fresh one from the main app).

---

## Environment variables

See [`.env.example`](./.env.example) for the full list with comments. Required at startup (the process exits with a clear error if any are missing):

- `NODE_ENV`, `PORT`, `CORS_ORIGINS`
- `MAIN_BACKEND_URL`, `MAIN_BACKEND_VERIFY_PATH`
- `AUTH_HEADER_NAME`, `AUTH_USER_ID_FIELD`, `AUTH_USER_EMAIL_FIELD`, `AUTH_USER_ROLE_FIELD`
- `ALLOWED_ROLES`
- `NOCODB_URL`, `NOCODB_TOKEN`, `NOCODB_BASE_ID`

Tunable (defaults shown):

- `AUTH_HEADER_PREFIX=Bearer`
- `MAX_TABLES_PER_EXPORT=10`
- `MAX_ROWS_PER_TABLE=100000`
- `RATE_LIMIT_EXPORTS_PER_HOUR=10`
- `RATE_LIMIT_LISTS_PER_HOUR=60`
- `VERIFY_CACHE_TTL_SECONDS=0` (disabled; max 60)
- `LOG_LEVEL=info`

`CORS_ORIGINS` is a comma-separated allowlist of exact origins (no wildcards).

---

## Local development

```bash
cp .env.example .env       # fill in real values
npm install
npm run dev                # node --watch
```

The service listens on `http://localhost:3000`. Smoke test:

```bash
curl -fsS http://localhost:3000/health
curl -fsS -H "Authorization: Bearer <real-token>" http://localhost:3000/api/exports/tables
```

Run a security audit before pushing:

```bash
npm run audit
```

---

## Deploying via Dokploy (GitHub Compose)

### 1. Push to GitHub

This repo is already at `https://github.com/jayanthgopala/nocode-frontend-and-backend`. Push subsequent changes to `main`.

### 2. Create the Compose service in Dokploy

1. Dashboard → **Create** → **Compose**.
2. Name: `placement-exports`. Type: `Docker Compose`. Source: `GitHub`.
3. Connect the GitHub repo and select branch `main`.
4. Compose file path: `docker-compose.yml` (default).

### 3. Paste environment variables

In the **Environment** tab, add every variable from `.env.example`. The `NOCODB_TOKEN` must be the real token here — never in the repo.

Sanity checks:

- `CORS_ORIGINS` matches the exact frontend origin (scheme + host, no trailing slash).
- `MAIN_BACKEND_URL` is reachable **from inside the Dokploy network**. Use the internal Docker hostname when both services share a network.
- `ALLOWED_ROLES` matches the strings the main backend actually returns (case-insensitive match, but exact spelling).

### 4. Networks

The compose file attaches to two external networks: `placement-network` and `dokploy-network`. Both must exist on the host. If `placement-network` doesn't already exist:

```bash
docker network create placement-network
```

The main backend's container must also be on `placement-network` for the internal-hostname call to work. If it isn't, add it (in the main backend's `docker-compose.yml`) or use the public URL.

### 5. Domain + DNS

1. **Cloudflare**: add A record `exports` → VPS IP. Proxy as you do for the rest of the stack.
2. **Dokploy → Domains**: add `exports.sumantheluri.tech` → service `exports-service` → port `3000` → HTTPS.
   - If Let's Encrypt fails behind Cloudflare proxy, use Cloudflare Flexible/Full SSL instead.

### 6. Deploy + verify

1. Click **Deploy**. Tail logs in Dokploy. Expect one JSON line: `"exports service listening"` showing `mainBackendVerify` and `allowedRoles`.
2. Smoke test from your laptop:
   ```bash
   curl -fsS https://exports.sumantheluri.tech/health
   # → {"status":"ok",...}

   curl -fsS \
     -H "Authorization: Bearer <real-token-from-main-app>" \
     https://exports.sumantheluri.tech/api/exports/tables
   ```
3. Without a token: must return `401 unauthorized`.
4. With a valid token whose role isn't in `ALLOWED_ROLES`: must return `403 forbidden`.

### 7. Auto-deploy

In Dokploy's **Deployments** tab, enable the GitHub webhook. Pushes to `main` redeploy automatically.

---

## Calling this service from your frontend

This repo ships **no UI** — your existing React app calls these endpoints directly. Send the same auth token the main app already issues; this service forwards it to the main backend's `/api/auth/whoami` for verification.

### List tables

```js
const res = await fetch('https://exports.sumantheluri.tech/api/exports/tables', {
  headers: { Authorization: `Bearer ${token}` },
});
const { tables } = await res.json();   // [{ id, name }, ...]
```

### Multi-sheet Excel

```js
const res = await fetch('https://exports.sumantheluri.tech/api/exports/excel', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ tableIds: ['tbl_xxx', 'tbl_yyy'] }),
});
const blob = await res.blob();
// trigger a browser download from the blob (URL.createObjectURL + <a download>)
```

### Single-table CSV

```js
const res = await fetch(
  `https://exports.sumantheluri.tech/api/exports/csv/${encodeURIComponent(tableId)}`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const blob = await res.blob();
```

### Status codes to handle

| Status | Meaning | UX |
| --- | --- | --- |
| 401 | Token invalid or missing | Bounce to your existing login |
| 403 | User's role isn't in `ALLOWED_ROLES` | "You don't have permission to export." |
| 413 | Table exceeds `MAX_ROWS_PER_TABLE` | Show `body.tableName` + `body.rows`, ask user to filter |
| 429 | Per-user hourly rate limit hit | "Try again later." |
| 502 | NocoDB upstream is down | "Data source unavailable, try again shortly." |

Error responses always include `requestId` matching the audit log line server-side, useful for debugging.

---

## Security notes

- **Token verification on every request.** No bypasses. The optional cache is off by default and capped at 60s when on.
- **Role check** runs after verification; missing/disallowed role → 403.
- **CORS** is an exact-origin allowlist. No wildcards. No credentials.
- **`helmet()`** applied with defaults.
- **Rate limits** are per-user (or per-IP for unauthenticated calls), via `express-rate-limit` keyed on `req.user.id || req.ip`. Default: 60 list calls/h, 10 exports/h.
- **Input validation:** `tableIds` must match `^[A-Za-z0-9_-]{1,64}$`, capped at `MAX_TABLES_PER_EXPORT`, and must exist in NocoDB. Tables exceeding `MAX_ROWS_PER_TABLE` return `413` before any streaming starts.
- **Audit logging:** one JSON line per authenticated request to stdout, including user id/email/role, table ids, row counts, status, IP, user-agent, and request id. Tokens, passwords, and the NocoDB API token are redacted.
- **CSV formula injection:** cells starting with `= + - @ \t \r` are prefixed with `'` so spreadsheets won't auto-execute them.
- **Errors:** clients only see a generic message + `requestId`. Stack traces stay in the server log.
- **Container:** non-root user, multi-stage build, alpine base, no extra packages.
- **Dependencies:** exact versions pinned; run `npm audit` (`npm run audit`) before each deploy.
- **Secrets:** all in env. `.env` is gitignored. NocoDB token is never logged, never returned to clients.

### Hardening you may want to add later

- **Pre-auth IP rate limit.** Today, every request hits the main backend's verify endpoint once before any per-user limit applies. A small `express-rate-limit` keyed on `req.ip` in front of `auth` would reduce verify-endpoint pressure under bot traffic.
- **Verification cache** (already supported via `VERIFY_CACHE_TTL_SECONDS`). Turn it on (e.g. 30s) if the main backend's `/me` becomes a hot path.
- **Sentry/OpenTelemetry** wired to the existing `pino` logger.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Service exits on boot with `Missing required environment variables` | Env var typo in Dokploy | Check the `missing` array in the log line; add the var(s) and redeploy |
| Every request returns 401, even with a known-good token | Wrong `MAIN_BACKEND_URL`, `MAIN_BACKEND_VERIFY_PATH`, or header name; or the main backend is unreachable from this container | Reproduce the verify call from inside the container with `wget`/`curl`; align config to whatever the main backend expects |
| 401 *only* in production, fine locally | Public URL works locally but the container can't resolve/reach it inside the Docker network | Switch `MAIN_BACKEND_URL` to the internal Docker hostname, or add this service to the main backend's network |
| 403 forbidden for a valid user | Main backend returns role under a different field, or with different casing | Adjust `AUTH_USER_ROLE_FIELD` and/or `ALLOWED_ROLES` |
| Browser blocks calls with CORS error | Origin not in `CORS_ORIGINS` (typo, scheme mismatch, trailing slash) | Fix the env var; redeploy |
| 502 upstream_error on listing tables | NocoDB token wrong or `NOCODB_BASE_ID` wrong | Test: `curl -H "xc-token: $T" $NOCODB_URL/api/v2/meta/bases/$BASE/tables` |
| 413 payload_too_large | Table exceeds `MAX_ROWS_PER_TABLE` | Filter the data, or raise the limit (this is the memory guardrail — raise carefully) |
| 429 rate_limited | User exceeded their hourly quota | Wait, or raise `RATE_LIMIT_*_PER_HOUR` |
| Big exports time out at the proxy | Traefik/Cloudflare default timeouts | Lower `MAX_ROWS_PER_TABLE` for users hitting this, or raise proxy read timeouts |

---

## File layout

```
exports-service/
├── .gitignore
├── .dockerignore
├── .env.example
├── README.md
├── Dockerfile
├── docker-compose.yml
├── package.json
└── src/
    ├── index.js               # entry point
    ├── config.js              # env loading + validation
    ├── logger.js              # pino, JSON, redaction
    ├── server.js              # express app: helmet, cors, routes, error handling
    ├── middleware/
    │   ├── auth.js            # forwards token to main backend's verify endpoint
    │   ├── requireRole.js     # ALLOWED_ROLES check
    │   ├── auditLog.js        # one JSON line per authenticated request
    │   └── errorHandler.js    # generic client errors, full server-side logs
    ├── routes/
    │   ├── health.js
    │   └── exports.js
    └── services/
        ├── nocodb.js          # NocoDB v2 API: list, count, paginated iterate
        └── excel.js           # streaming multi-sheet workbook
```
