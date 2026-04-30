'use strict';

const jwtSvc = require('../services/jwt');

function extractBearer(req) {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== 'string') return null;
  if (!raw.startsWith('Bearer ')) return null;
  const token = raw.slice('Bearer '.length).trim();
  return token || null;
}

function authMiddleware(req, res, next) {
  const token = extractBearer(req);
  if (!token) {
    return res.status(401).json({ error: 'unauthorized', requestId: req.id });
  }
  const user = jwtSvc.verify(token);
  if (!user) {
    return res.status(401).json({ error: 'unauthorized', requestId: req.id });
  }
  req.user = user;
  return next();
}

module.exports = authMiddleware;
