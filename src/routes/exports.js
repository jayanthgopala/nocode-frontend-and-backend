'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const config = require('../config');
const logger = require('../logger');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const auditLog = require('../middleware/auditLog');
const nocodb = require('../services/nocodb');
const excel = require('../services/excel');

const router = express.Router();

const HOUR_MS = 60 * 60 * 1000;

const keyByUserOrIp = (req) =>
  req.user && req.user.id ? `u:${req.user.id}` : `ip:${req.ip}`;

const listLimiter = rateLimit({
  windowMs: HOUR_MS,
  limit: config.limits.rateLimitListsPerHour,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  handler: (req, res) =>
    res.status(429).json({ error: 'rate_limited', requestId: req.id }),
});

const exportLimiter = rateLimit({
  windowMs: HOUR_MS,
  limit: config.limits.rateLimitExportsPerHour,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: keyByUserOrIp,
  handler: (req, res) =>
    res.status(429).json({ error: 'rate_limited', requestId: req.id }),
});

router.use(auth, requireRole, auditLog);

router.get('/tables', listLimiter, async (req, res, next) => {
  try {
    const tables = await nocodb.listTables();
    res.json({ tables });
  } catch (err) {
    next(err);
  }
});

router.post('/excel', exportLimiter, async (req, res, next) => {
  try {
    const tableIds = validateTableIds(req.body && req.body.tableIds);
    const allTables = await nocodb.listTables();
    const known = new Map(allTables.map((t) => [t.id, t]));
    const selected = [];
    for (const id of tableIds) {
      const t = known.get(id);
      if (!t) {
        return res.status(400).json({
          error: 'invalid_table_id',
          tableId: id,
          requestId: req.id,
        });
      }
      selected.push(t);
    }

    const counts = await Promise.all(selected.map((t) => nocodb.countRows(t.id)));
    for (let i = 0; i < selected.length; i += 1) {
      if (counts[i] > config.limits.maxRowsPerTable) {
        return res.status(413).json({
          error: 'payload_too_large',
          tableId: selected[i].id,
          tableName: selected[i].name,
          rows: counts[i],
          limit: config.limits.maxRowsPerTable,
          hint: 'Filter your data or split the export.',
          requestId: req.id,
        });
      }
    }

    req.exportContext = { tableIds: selected.map((t) => t.id) };

    const items = selected.map((t) => ({
      table: t,
      iterator: nocodb.iterateTableRows(t.id, {
        hardLimit: config.limits.maxRowsPerTable,
      }),
    }));

    const filename = `placement-export-${timestampSlug()}.xlsx`;
    await excel.streamWorkbook(res, items, filename);

    req.exportContext.rowCounts = items.map((i) => i.rowCount || 0);
  } catch (err) {
    if (res.headersSent) {
      logger.error(
        { requestId: req.id, err: err && err.message },
        'excel export failed mid-stream'
      );
      try {
        res.end();
      } catch (_) {
        // already torn down
      }
      return;
    }
    next(err);
  }
});

router.get('/csv/:tableId', exportLimiter, async (req, res, next) => {
  try {
    const tableId = String(req.params.tableId || '');
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(tableId)) {
      return res.status(400).json({ error: 'invalid_table_id', requestId: req.id });
    }
    const allTables = await nocodb.listTables();
    const table = allTables.find((t) => t.id === tableId);
    if (!table) {
      return res.status(404).json({ error: 'table_not_found', requestId: req.id });
    }

    const count = await nocodb.countRows(tableId);
    if (count > config.limits.maxRowsPerTable) {
      return res.status(413).json({
        error: 'payload_too_large',
        tableId,
        tableName: table.name,
        rows: count,
        limit: config.limits.maxRowsPerTable,
        hint: 'Filter your data or split the export.',
        requestId: req.id,
      });
    }

    req.exportContext = { tableIds: [tableId] };

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${sanitizeFilename(table.name)}-${timestampSlug()}.csv"`
    );
    res.setHeader('Cache-Control', 'no-store');
    // Excel-friendly UTF-8 BOM
    res.write('﻿');

    let headers = null;
    let rowCount = 0;
    for await (const row of nocodb.iterateTableRows(tableId, {
      hardLimit: config.limits.maxRowsPerTable,
    })) {
      if (!headers) {
        headers = Object.keys(row);
        res.write(headers.map(csvCell).join(',') + '\r\n');
      }
      res.write(headers.map((h) => csvCell(row[h])).join(',') + '\r\n');
      rowCount += 1;
    }
    if (!headers) {
      res.write('(no rows)\r\n');
    }
    req.exportContext.rowCounts = [rowCount];
    res.end();
  } catch (err) {
    if (res.headersSent) {
      logger.error(
        { requestId: req.id, err: err && err.message },
        'csv export failed mid-stream'
      );
      try {
        res.end();
      } catch (_) {
        // already torn down
      }
      return;
    }
    next(err);
  }
});

function validateTableIds(input) {
  if (!Array.isArray(input)) {
    const e = new Error('tableIds must be an array of strings');
    e.status = 400;
    e.expose = true;
    throw e;
  }
  if (input.length === 0) {
    const e = new Error('tableIds must not be empty');
    e.status = 400;
    e.expose = true;
    throw e;
  }
  if (input.length > config.limits.maxTablesPerExport) {
    const e = new Error(
      `Too many tables (max ${config.limits.maxTablesPerExport})`
    );
    e.status = 400;
    e.expose = true;
    throw e;
  }
  const seen = new Set();
  const out = [];
  for (const id of input) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      const e = new Error('Invalid tableId format');
      e.status = 400;
      e.expose = true;
      throw e;
    }
    if (seen.has(id)) {
      const e = new Error('Duplicate tableIds');
      e.status = 400;
      e.expose = true;
      throw e;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s;
  if (typeof v === 'object') {
    try {
      s = JSON.stringify(v);
    } catch (_) {
      s = String(v);
    }
  } else {
    s = String(v);
  }
  if (s.length > 0 && /^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function sanitizeFilename(name) {
  return String(name || 'export').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'export';
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

module.exports = router;
