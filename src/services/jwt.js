'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

const SIGN_OPTS = {
  algorithm: 'HS256',
  expiresIn: config.jwt.expiresIn,
  issuer: config.jwt.issuer,
};

const VERIFY_OPTS = {
  algorithms: ['HS256'],
  issuer: config.jwt.issuer,
};

function sign(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
    },
    config.jwt.secret,
    SIGN_OPTS
  );
}

function verify(token) {
  try {
    const payload = jwt.verify(token, config.jwt.secret, VERIFY_OPTS);
    if (!payload || typeof payload !== 'object' || !payload.sub) return null;
    return {
      id: String(payload.sub),
      email: payload.email ? String(payload.email) : null,
      role: payload.role ? String(payload.role) : null,
    };
  } catch (_) {
    return null;
  }
}

module.exports = { sign, verify };
