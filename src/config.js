'use strict';

const dotenv = require('dotenv');
dotenv.config();

const REQUIRED = [
  'NODE_ENV',
  'PORT',
  'CORS_ORIGINS',
  'MAIN_BACKEND_URL',
  'MAIN_BACKEND_VERIFY_PATH',
  'AUTH_HEADER_NAME',
  'AUTH_USER_ID_FIELD',
  'AUTH_USER_EMAIL_FIELD',
  'AUTH_USER_ROLE_FIELD',
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

const verifyCacheTtl = Math.min(60, Math.max(0, intEnv('VERIFY_CACHE_TTL_SECONDS', 0)));

module.exports = {
  nodeEnv: process.env.NODE_ENV,
  port: intEnv('PORT', 3000),
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigins,
  mainBackend: {
    url: process.env.MAIN_BACKEND_URL.replace(/\/+$/, ''),
    verifyPath: process.env.MAIN_BACKEND_VERIFY_PATH,
  },
  auth: {
    headerName: process.env.AUTH_HEADER_NAME,
    headerPrefix: process.env.AUTH_HEADER_PREFIX || '',
    userIdField: process.env.AUTH_USER_ID_FIELD,
    userEmailField: process.env.AUTH_USER_EMAIL_FIELD,
    userRoleField: process.env.AUTH_USER_ROLE_FIELD,
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
  },
  verifyCache: {
    ttlSeconds: verifyCacheTtl,
    enabled: verifyCacheTtl > 0,
  },
};
