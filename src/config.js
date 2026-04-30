'use strict';

const dotenv = require('dotenv');
dotenv.config();

const REQUIRED = [
  'NODE_ENV',
  'PORT',
  'CORS_ORIGINS',
  'JWT_SECRET',
  'USERS_JSON',
  'ALLOWED_ROLES',
  'NOCODB_URL',
  'NOCODB_TOKEN',
  'NOCODB_BASE_ID',
];

function fail(message, extra) {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: 'fatal', msg: message, ...(extra || {}) }));
  process.exit(1);
}

const missing = REQUIRED.filter((k) => !process.env[k] || !String(process.env[k]).trim());
if (missing.length) {
  fail('Missing required environment variables', { missing });
}

function intEnv(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n) || n < 0) {
    fail(`Invalid integer for env var ${key}`, { value: v });
  }
  return n;
}

function listEnv(key) {
  return String(process.env[key] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const corsOrigins = listEnv('CORS_ORIGINS');
if (corsOrigins.length === 0) fail('CORS_ORIGINS must contain at least one origin');
for (const origin of corsOrigins) {
  if (!/^https?:\/\/[^*\s]+$/.test(origin)) {
    fail('CORS_ORIGINS contains an invalid origin (no wildcards or whitespace)', { origin });
  }
}

const allowedRoles = listEnv('ALLOWED_ROLES');
if (allowedRoles.length === 0) fail('ALLOWED_ROLES must contain at least one role');

if (process.env.JWT_SECRET.length < 32) {
  fail('JWT_SECRET must be at least 32 characters (use `openssl rand -base64 64`)');
}

let users;
try {
  users = JSON.parse(process.env.USERS_JSON);
} catch (err) {
  fail('USERS_JSON is not valid JSON', { detail: err.message });
}
if (!Array.isArray(users) || users.length === 0) {
  fail('USERS_JSON must be a non-empty JSON array of {email, passwordHash, role} objects');
}
for (const [i, u] of users.entries()) {
  if (
    !u ||
    typeof u !== 'object' ||
    typeof u.email !== 'string' ||
    typeof u.passwordHash !== 'string' ||
    typeof u.role !== 'string' ||
    !u.email.trim() ||
    !u.passwordHash.trim() ||
    !u.role.trim()
  ) {
    fail('USERS_JSON entries must each have email, passwordHash, role (non-empty strings)', {
      index: i,
    });
  }
}

module.exports = {
  nodeEnv: process.env.NODE_ENV,
  port: intEnv('PORT', 3000),
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigins,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
    issuer: process.env.JWT_ISSUER || 'placement-exports',
  },
  users: users.map((u) => ({
    email: u.email.trim().toLowerCase(),
    passwordHash: u.passwordHash,
    role: u.role.trim(),
    id: u.id ? String(u.id) : u.email.trim().toLowerCase(),
  })),
  auth: {
    allowedRoles,
  },
  nocodb: {
    url: process.env.NOCODB_URL.replace(/\/+$/, ''),
    token: process.env.NOCODB_TOKEN,
    baseId: process.env.NOCODB_BASE_ID,
  },
  limits: {
    maxTablesPerExport: intEnv('MAX_TABLES_PER_EXPORT', 10),
    maxRowsPerTable: intEnv('MAX_ROWS_PER_TABLE', 100000),
    rateLimitExportsPerHour: intEnv('RATE_LIMIT_EXPORTS_PER_HOUR', 10),
    rateLimitListsPerHour: intEnv('RATE_LIMIT_LISTS_PER_HOUR', 60),
    rateLimitLoginPer15Min: intEnv('RATE_LIMIT_LOGIN_PER_15MIN', 10),
  },
};
