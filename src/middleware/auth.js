'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../logger');

const cache = new Map();
const CACHE_MAX_ENTRIES = 5000;

function cacheGet(token) {
  if (!config.verifyCache.enabled) return null;
  const entry = cache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(token);
    return null;
  }
  return entry.user;
}

function cacheSet(token, user) {
  if (!config.verifyCache.enabled) return;
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(token, {
    user,
    expiresAt: Date.now() + config.verifyCache.ttlSeconds * 1000,
  });
}

function extractToken(req) {
  const headerName = config.auth.headerName.toLowerCase();
  const raw = req.headers[headerName];
  if (!raw || typeof raw !== 'string') return null;
  const prefix = config.auth.headerPrefix;
  if (!prefix) return raw.trim() || null;
  const expected = `${prefix} `;
  if (!raw.startsWith(expected)) return null;
  const token = raw.slice(expected.length).trim();
  return token || null;
}

function pickField(obj, field) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, field)) return obj[field];
  return undefined;
}

async function verifyToken(token, requestId) {
  const url = `${config.mainBackend.url}${config.mainBackend.verifyPath}`;
  const headers = {
    [config.auth.headerName]: config.auth.headerPrefix
      ? `${config.auth.headerPrefix} ${token}`
      : token,
    Accept: 'application/json',
  };
  let resp;
  try {
    resp = await axios.get(url, {
      headers,
      timeout: 8000,
      validateStatus: () => true,
      maxRedirects: 0,
    });
  } catch (err) {
    logger.warn(
      { requestId, err: err.message },
      'token verification request to main backend failed'
    );
    return null;
  }
  if (resp.status < 200 || resp.status >= 300) {
    logger.debug(
      { requestId, status: resp.status },
      'main backend rejected token'
    );
    return null;
  }
  const data = resp.data;
  if (!data || typeof data !== 'object') return null;
  const candidate =
    pickField(data, 'user') && typeof data.user === 'object' ? data.user :
    pickField(data, 'data') && typeof data.data === 'object' ? data.data :
    data;
  const id = pickField(candidate, config.auth.userIdField);
  const email = pickField(candidate, config.auth.userEmailField);
  const role = pickField(candidate, config.auth.userRoleField);
  if (id === undefined || id === null || id === '') return null;
  return {
    id: String(id),
    email: email ? String(email) : null,
    role: role ? String(role) : null,
  };
}

async function authMiddleware(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'unauthorized', requestId: req.id });

    let user = cacheGet(token);
    if (!user) {
      user = await verifyToken(token, req.id);
      if (!user) return res.status(401).json({ error: 'unauthorized', requestId: req.id });
      cacheSet(token, user);
    }

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = authMiddleware;
