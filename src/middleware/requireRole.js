'use strict';

const config = require('../config');

const allowed = new Set(config.auth.allowedRoles.map((r) => r.toLowerCase()));

function requireRole(req, res, next) {
  const role = req.user && req.user.role;
  if (!role || !allowed.has(String(role).toLowerCase())) {
    return res.status(403).json({ error: 'forbidden', requestId: req.id });
  }
  return next();
}

module.exports = requireRole;
