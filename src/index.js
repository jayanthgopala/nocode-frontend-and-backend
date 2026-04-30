'use strict';

const { buildApp } = require('./server');
const config = require('./config');
const logger = require('./logger');

const app = buildApp();

const server = app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      env: config.nodeEnv,
      jwtIssuer: config.jwt.issuer,
      jwtExpiresIn: config.jwt.expiresIn,
      userCount: config.users.length,
      allowedRoles: config.auth.allowedRoles,
      maxTablesPerExport: config.limits.maxTablesPerExport,
      maxRowsPerTable: config.limits.maxRowsPerTable,
    },
    'exports service listening'
  );
});

server.headersTimeout = 65000;
server.keepAliveTimeout = 60000;
server.requestTimeout = 0; // exports can take a while to stream

function shutdown(signal) {
  logger.info({ signal }, 'received shutdown signal');
  server.close((err) => {
    if (err) {
      logger.error({ err: err.message }, 'error during server.close');
      process.exit(1);
    }
    process.exit(0);
  });
  setTimeout(() => {
    logger.warn('forced shutdown after 10s');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'unhandled rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'uncaught exception');
  process.exit(1);
});
