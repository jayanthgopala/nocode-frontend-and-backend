'use strict';

const logger = require('../logger');
const config = require('../config');

function notFound(req, res) {
  res.status(404).json({ error: 'not_found', requestId: req.id });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status =
    err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600
      ? err.status
      : 500;

  logger.error(
    {
      requestId: req.id,
      method: req.method,
      path: req.path,
      status,
      err: {
        message: err && err.message,
        stack: err && err.stack,
        upstream: err && err.upstreamMessage,
        code: err && err.code,
      },
    },
    'request_error'
  );

  if (res.headersSent) {
    try {
      res.end();
    } catch (_) {
      // already torn down
    }
    return;
  }

  const safeMessage = err && err.expose === true && err.message ? err.message : null;
  const body = {
    error: safeMessage || (status >= 500 ? 'internal_error' : 'request_failed'),
    requestId: req.id,
  };

  if (config.nodeEnv !== 'production' && !safeMessage && err && err.message) {
    body.detail = err.message;
  }

  res.status(status).json(body);
}

module.exports = { errorHandler, notFound };
