'use strict';

const logger = require('../logger');

function auditLog(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const user = req.user || {};
    const ctx = req.exportContext || {};
    logger.info(
      {
        type: 'audit',
        requestId: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        tableIds: ctx.tableIds,
        rowCounts: ctx.rowCounts,
        bytesSent: Number(res.getHeader('content-length')) || undefined,
      },
      'request_completed'
    );
  });
  next();
}

module.exports = auditLog;
