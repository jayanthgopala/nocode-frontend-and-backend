# Placement Exports Service

A standalone Node.js/Express microservice that lets authorized users (TPO, admins) export placement data from NocoDB into Excel or CSV files. The service is **read-only** to the database, **API-only**, and ships with its own login + JWT auth (no dependency on any other backend).

It is designed to be deployed via Dokploy's **GitHub → Compose** flow.

---

## What it does

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | none | Liveness probe |
| `POST /api/auth/login` | none (rate-limited per IP) | Body: `{email, password}`. Returns a JWT |
| `GET /api/auth/me` | required | Returns `{user}` derived from the JWT |
| `POST /api/auth/logout` | required | Audit-logs the event (JWT is stateless; client just drops it) |
| `GET /api/exports/tables` | required | Lists `{id, name}` of all NocoDB tables in the configured base |
| `POST /api/exports/excel` | required | Body: `{ "tableIds": ["..."] }`. Streams a multi-sheet `.xlsx` |
| `GET /api/exports/csv/:tableId` | required | Streams a single CSV |

Auth header: `Authorization: Bearer <jwt>`. Every authenticated request emits one JSON audit log line on stdout.

---

## Architecture

```
React frontend ──Bearer JWT──▶ exports-service ──xc-token──▶ NocoDB ──▶ Postgres (read-only user)
                                       │
                                       └── verifies the JWT locally with HS256 + JWT_SECRET
```

- **No DB write access.** All data is read through NocoDB's REST API. The Postgres role NocoDB uses is read-only.
- **No external auth dependency.** Users are stored as bcrypt-hashed entries in `USERS_JSON`. JWTs are signed and verified locally with `JWT_SECRET`.

---

## Environment variables

See [`.env.example`](./.env.example) for the full list with comments. Required at startup:

- `NODE_ENV`, `PORT`, `CORS_ORIGINS`
- `JWT_SECRET` (>= 32 chars; generate with `openssl rand -base64 64`)
- `USERS_JSON` (single-line JSON array of user records)
- `ALLOWED_ROLES`
- `NOCODB_URL`, `NOCODB_TOKEN`, `NOCODB_BASE_ID`

Tunable (defaults shown):

- `JWT_EXPIRES_IN=12h`, `JWT_ISSUER=placement-exports`
- `MAX_TABLES_PER_EXPORT=10`
- `MAX_ROWS_PER_TABLE=100000`
- `RATE_LIMIT_EXPORTS_PER_HOUR=10`
- `RATE_LIMIT_LISTS_PER_HOUR=60`
- `RATE_LIMIT_LOGIN_PER_15MIN=10`
- `LOG_LEVEL=info`

`CORS_ORIGINS` is a comma-separated allowlist of exact origins (no wildcards).

### USERS_JSON format

```json
[
  {"email": "admin@bms.in",  "passwordHash": "$2a$12$...", "role": "admin"},
  {"email": "tpo@bms.in",    "passwordHash": "$2a$12$...", "role": "tpo"}
]
```

- `email` — used for login and shown in audit logs.
- `passwordHash` — bcrypt hash. **Never** put a plaintext password here.
- `role` — must match one of `ALLOWED_ROLES` (case-insensitive) for the user to be allowed to export.
- `id` — optional; defaults to the email.

### Hashing a password

```bash
node scripts/hash-password.js 'their-strong-password'
# → $2a$12$....
```

Wrap the password in single quotes so the shell doesn't expand `$`, `!`, etc. Minimum 12 characters enforced.

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

# Log in
TOKEN=$(curl -fsS -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@bms.in","password":"your-password"}' | jq -r .token)

# Use it
curl -fsS -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/exports/tables
```

Run a security audit before pushing:

```bash
npm run audit
```

---

## Deploying via Dokploy (GitHub Compose)

### 1. Push to GitHub

1. Create a new **private** repo, e.g. `placement-exports-service`.
2. Push this folder. Confirm `.env` is **not** in the diff (`git status` should show only `.env.example`).
3. Branch: `main`.

### 2. Create the Compose service in Dokploy

1. Dashboard → **Create** → **Compose**.
2. Name: `placement-exports`. Type: `Docker Compose`. Source: `GitHub`.
3. Connect the GitHub repo and select branch `main`.
4. Compose file path: `docker-compose.yml` (default).

### 3. Paste environment variables

In the **Environment** tab, add every variable from `.env.example`. The `JWT_SECRET`, `USERS_JSON`, and `NOCODB_TOKEN` must be the real values here — never in the repo.

Sanity checks:

- `CORS_ORIGINS` matches the exact frontend origin (scheme + host, no trailing slash).
- `JWT_SECRET` is at least 32 chars and was freshly generated for this deploy.
- `USERS_JSON` parses (test locally first: `node -e 'JSON.parse(process.env.USERS_JSON)'`).
- Each entry's `role` is in `ALLOWED_ROLES`.

### 4. Networks

The compose file attaches to two external networks: `placement-network` and `dokploy-network`. Both must exist on the host. If `placement-network` doesn't already exist:

```bash
docker network create placement-network
```

### 5. Domain + DNS

1. **Cloudflare**: add A record `exports` → VPS IP. Proxy as you do for the rest of the stack.
2. **Dokploy → Domains**: add `exports.sumantheluri.tech` → service `exports-service` → port `3000` → HTTPS.
   - If Let's Encrypt fails behind Cloudflare proxy, use Cloudflare Flexible/Full SSL instead.

### 6. Deploy + verify

1. Click **Deploy**. Wait for the container to come up.
2. Tail logs in Dokploy. You should see one JSON line: `"exports service listening"`.
3. Smoke test from your laptop:
   ```bash
   curl -fsS https://exports.sumantheluri.tech/health
   # → {"status":"ok",...}

   TOKEN=$(curl -fsS -X POST https://exports.sumantheluri.tech/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@bms.in","password":"..."}' | jq -r .token)

   curl -fsS -H "Authorization: Bearer $TOKEN" \
     https://exports.sumantheluri.tech/api/exports/tables
   ```
4. Without a token: must return `401 unauthorized`.
5. With a JWT for a user whose role is not in `ALLOWED_ROLES`: must return `403 forbidden`.
6. Wrong password 11 times in a row from one IP: must return `429 rate_limited`.

### 7. Auto-deploy

In Dokploy's **Deployments** tab, enable the GitHub webhook. Pushes to `main` redeploy automatically.

---

## Frontend integration

Drop-in React files under `frontend/` (copy them into the existing app, same folder, then import):

| File | Purpose |
| --- | --- |
| `auth.js` | Shared helpers: token storage, `fetch` wrappers, `login()` / `logout()` / `fetchCurrentUser()`, error mapping. **All config (base URL, storage key) lives here — adjust once.** |
| `LoginPage.jsx` | Email/password form. Props: `onLoginSuccess(user)`. |
| `ExportPanel.jsx` | Table list + Excel/CSV download + sign-out button. Props: `user`, `onUnauthenticated()`. |
| `ExportApp.jsx` | Optional one-line drop-in that picks Login vs Panel based on the stored JWT (calls `/api/auth/me` on mount). Use this if you don't have routing for the exports feature. |

What to edit in `auth.js`:

- **`EXPORTS_BASE_URL`** — point at `https://exports.sumantheluri.tech`. You can also set `window.__EXPORTS_BASE_URL__` before the bundle loads (e.g. in `index.html`) and leave the file untouched.
- **`STORAGE_KEY`** — defaults to `placement_exports_token`. Change only if it collides with something else in the existing app.

If you already have an auth context / cookie-based session in the existing app, replace the four storage helpers (`getAuthToken`, `storeAuthToken`, `clearAuthToken`, `authHeaders`) with calls into your context. Everything else (`login`, `fetchCurrentUser`, `logout`, the components) is built on top of those four.

Behavior already wired:

- 401 → token cleared, `onUnauthenticated()` fires, user lands back on login.
- 403 / 413 / 429 / network errors → user-facing messages from `friendlyMessage()`.
- Excel/CSV downloads → triggered via blob + `<a download>` with the filename from `Content-Disposition`.

---

## Security notes

- **Local JWT auth.** HS256, configurable expiry, configurable issuer. Verified on every request — no caching, no bypasses.
- **bcrypt password storage.** Cost 12. Plaintext passwords never reach the service except over HTTPS during login, and never appear in logs.
- **Constant-time login.** Bcrypt is run even on unknown emails to avoid leaking user existence via timing.
- **Login rate limiting.** Per-IP, default 10 attempts per 15 minutes.
- **Per-user rate limits** for listing (60/h) and exports (10/h), keyed on `req.user.id` after auth.
- **Role check** runs after auth; missing/disallowed role → 403.
- **CORS** is an exact-origin allowlist. No wildcards. No credentials.
- **`helmet()`** applied with defaults.
- **Input validation:** `tableIds` must match `^[A-Za-z0-9_-]{1,64}$`, capped at `MAX_TABLES_PER_EXPORT`, and must exist in NocoDB. Tables exceeding `MAX_ROWS_PER_TABLE` return `413` before any streaming starts.
- **Audit logging:** one JSON line per authenticated request to stdout, plus dedicated `login_succeeded` / `login_failed` / `logout` events. Tokens, password, and the NocoDB API token are redacted.
- **CSV formula injection:** cells starting with `= + - @ \t \r` are prefixed with `'` so spreadsheets won't auto-execute them.
- **Errors:** clients only see a generic message + `requestId`. Stack traces stay in the server log.
- **Container:** non-root user, multi-stage build, alpine base, no extra packages.
- **Dependencies:** exact versions pinned; run `npm audit` (`npm run audit`) before each deploy.
- **Secrets:** all in env. `.env` is gitignored. `JWT_SECRET`, `USERS_JSON`, and `NOCODB_TOKEN` are never logged, never returned to clients.

### Hardening you may want to add later

- **Rotate `JWT_SECRET`.** Changing it invalidates all outstanding tokens (a feature, not a bug — useful after suspected compromise).
- **HttpOnly cookies + CSRF tokens** instead of localStorage for the JWT, to remove the XSS risk window.
- **Token revocation list** (jti + exp), if you ever need server-side logout.
- **MFA** — add TOTP via `otplib` if the user list grows.
- **Sentry/OpenTelemetry** wired to the existing `pino` logger.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Service exits on boot with `Missing required environment variables` | Env var typo in Dokploy | Check the `missing` array in the log line; add the var(s) and redeploy |
| Service exits with `JWT_SECRET must be at least 32 characters` | Secret too short | `openssl rand -base64 64`, redeploy |
| Service exits with `USERS_JSON is not valid JSON` | Newlines or unescaped quotes inside the value | Compact the JSON to a single line; verify with `jq`; redeploy |
| Login always 401 | Wrong password, or hash generated for a different password, or copy-paste lost a character | Re-hash the password with `scripts/hash-password.js`, redeploy |
| 403 forbidden for a known user | User's `role` isn't in `ALLOWED_ROLES` (case-insensitive) | Fix one or the other |
| Browser blocks calls with CORS error | Origin not in `CORS_ORIGINS` (typo, scheme mismatch, trailing slash) | Fix the env var; redeploy |
| 502 upstream_error on listing tables | NocoDB token wrong or `NOCODB_BASE_ID` wrong | Test: `curl -H "xc-token: $T" $NOCODB_URL/api/v2/meta/bases/$BASE/tables` |
| 413 payload_too_large | Table exceeds `MAX_ROWS_PER_TABLE` | Filter the data, or raise the limit (raise carefully; this is the memory guardrail) |
| 429 rate_limited on `/api/auth/login` | Bot or user typo storm | Wait 15 min, or raise `RATE_LIMIT_LOGIN_PER_15MIN` |
| 429 rate_limited on `/api/exports/*` | User hit hourly quota | Wait, or raise `RATE_LIMIT_*_PER_HOUR` |
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
├── scripts/
│   └── hash-password.js       # bcrypt helper for USERS_JSON entries
├── frontend/
│   ├── auth.js                # shared token storage + fetch helpers
│   ├── LoginPage.jsx          # email/password form, calls /api/auth/login
│   ├── ExportPanel.jsx        # table list + Excel/CSV download + sign-out
│   └── ExportApp.jsx          # optional one-line drop-in (Login ↔ Panel)
└── src/
    ├── index.js               # entry point
    ├── config.js              # env loading + validation
    ├── logger.js              # pino, JSON, redaction
    ├── server.js              # express app: helmet, cors, routes, error handling
    ├── middleware/
    │   ├── auth.js            # JWT verification (HS256)
    │   ├── requireRole.js     # ALLOWED_ROLES check
    │   ├── auditLog.js        # one JSON line per authenticated request
    │   └── errorHandler.js    # generic client errors, full server-side logs
    ├── routes/
    │   ├── health.js
    │   ├── auth.js            # login / me / logout
    │   └── exports.js
    └── services/
        ├── users.js           # USERS_JSON lookup + bcrypt verify
        ├── jwt.js             # sign + verify
        ├── nocodb.js          # NocoDB v2 API: list, count, paginated iterate
        └── excel.js           # streaming multi-sheet workbook
```
