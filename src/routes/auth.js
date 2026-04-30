'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const config = require('../config');
const logger = require('../logger');
const users = require('../services/users');
const jwtSvc = require('../services/jwt');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.limits.rateLimitLoginPer15Min,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // IP-keyed: we don't know who the user is yet.
  keyGenerator: (req) => `login:${req.ip}`,
  handler: (req, res) =>
    res.status(429).json({ error: 'rate_limited', requestId: req.id }),
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!email || !password || email.length > 254 || password.length > 1024) {
      return res
        .status(400)
        .json({ error: 'invalid_credentials', requestId: req.id });
    }

    const user = await users.authenticate(email, password);
    if (!user) {
      logger.info(
        { type: 'audit', event: 'login_failed', ip: req.ip, email, requestId: req.id },
        'login_failed'
      );
      return res
        .status(401)
        .json({ error: 'invalid_credentials', requestId: req.id });
    }

    const token = jwtSvc.sign(user);
    logger.info(
      {
        type: 'audit',
        event: 'login_succeeded',
        ip: req.ip,
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        requestId: req.id,
      },
      'login_succeeded'
    );

    res.json({
      token,
      tokenType: 'Bearer',
      expiresIn: config.jwt.expiresIn,
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

router.post('/logout', authMiddleware, (req, res) => {
  // Stateless JWT: nothing to revoke server-side. Frontend should drop the token.
  // (If you ever need true revocation, add a denylist keyed on jti+exp.)
  logger.info(
    {
      type: 'audit',
      event: 'logout',
      userId: req.user.id,
      userEmail: req.user.email,
      requestId: req.id,
    },
    'logout'
  );
  res.json({ ok: true });
});

module.exports = router;
