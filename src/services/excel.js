'use strict';

const ExcelJS = require('exceljs');

const INVALID_SHEET_CHARS = /[\[\]:*?\/\\]/g;

function sanitizeSheetName(name) {
  const cleaned = String(name || 'Sheet').replace(INVALID_SHEET_CHARS, '_').trim();
  const truncated = cleaned.slice(0, 31) || 'Sheet';
  return truncated;
}

function uniqueName(base, used) {
  let candidate = sanitizeSheetName(base);
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  for (let i = 2; i < 1000; i += 1) {
    const suffix = `_${i}`;
    const trimmedBase = sanitizeSheetName(base).slice(0, 31 - suffix.length);
    candidate = `${trimmedBase}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const fallback = `Sheet_${used.size + 1}`.slice(0, 31);
  used.add(fallback);
  return fallback;
}

function normalizeCell(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  const t = typeof v;
  if (t === 'number' || t === 'boolean' || t === 'string') return v;
  if (t === 'bigint') return v.toString();
  try {
    return JSON.stringify(v);
  } catch (_) {
    return String(v);
  }
}

/**
 * Stream a multi-sheet workbook to res.
 * items: [{ table: {id, name}, iterator: AsyncIterable<row> }]
 * Mutates each item to set item.rowCount after writing.
 */
async function streamWorkbook(res, items, filename) {
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    useStyles: false,
    useSharedStrings: false,
  });

  const usedNames = new Set();

  for (const item of items) {
    const sheetName = uniqueName(item.table.name, usedNames);
    const ws = workbook.addWorksheet(sheetName);
    let headers = null;
    let count = 0;

    for await (const row of item.iterator) {
      if (!headers) {
        headers = Object.keys(row);
        ws.addRow(headers).commit();
      }
      const values = headers.map((h) => normalizeCell(row[h]));
      ws.addRow(values).commit();
      count += 1;
    }

    if (!headers) {
      // Empty table: write a single header-less placeholder row so the sheet exists.
      ws.addRow(['(no rows)']).commit();
    }

    ws.commit();
    item.rowCount = count;
  }

  await workbook.commit();
}

module.exports = { streamWorkbook };
