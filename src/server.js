'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');

const config = require('./config');
const logger = require('./logger');
const healthRoutes = require('./routes/health');
const exportsRoutes = require('./routes/exports');
const { errorHandler, notFound } = require('./middleware/errorHandler');

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind Cloudflare + Traefik on Dokploy: trust the first proxy hop.
  app.set('trust proxy', 2);

  // Request id (correlate logs with client errors)
  app.use((req, res, next) => {
    const incoming = req.headers['x-request-id'];
    req.id =
      typeof incoming === 'string' && /^[A-Za-z0-9_\-]{1,128}$/.test(incoming)
        ? incoming
        : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  app.use(helmet());

  const allowed = new Set(config.corsOrigins);
  app.use(
    cors({
      origin(origin, cb) {
        // Non-browser callers (no Origin header) — allow through; CORS only matters for browsers.
        if (!origin) return cb(null, true);
        if (allowed.has(origin)) return cb(null, true);
        // Don't throw — just don't set Allow-Origin so the browser blocks it.
        return cb(null, false);
      },
      credentials: false,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Request-Id', config.auth.headerName],
      exposedHeaders: ['Content-Disposition', 'X-Request-Id'],
      maxAge: 600,
    })
  );

  app.use(express.json({ limit: '64kb' }));

  app.use('/health', healthRoutes);
  app.use('/api/exports', exportsRoutes);

  app.use(notFound);
  app.use(errorHandler);

  // Surface logger so index.js doesn't have to import it twice
  app.locals.logger = logger;

  return app;
}

module.exports = { buildApp };
