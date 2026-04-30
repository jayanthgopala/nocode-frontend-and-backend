'use strict';

const pino = require('pino');
const config = require('./config');

const logger = pino({
  level: config.logLevel,
  base: { service: 'placement-exports' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["xc-token"]',
      'req.headers["x-auth-token"]',
      'res.headers["set-cookie"]',
      'token',
      'tokens',
      '*.token',
      '*.password',
      'password',
      'NOCODB_TOKEN',
      'env.NOCODB_TOKEN',
    ],
    remove: true,
  },
});

module.exports = logger;
