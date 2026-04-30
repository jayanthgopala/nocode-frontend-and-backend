'use strict';

const axios = require('axios');
const config = require('../config');

const client = axios.create({
  baseURL: config.nocodb.url,
  timeout: 30000,
  headers: {
    'xc-token': config.nocodb.token,
    Accept: 'application/json',
  },
  // Never follow redirects to attacker-controlled hosts; NocoDB shouldn't redirect.
  maxRedirects: 0,
});

function upstreamError(err, op) {
  const e = new Error('upstream_error');
  e.status = 502;
  e.expose = true;
  e.upstreamMessage = `nocodb ${op}: ${err && err.message ? err.message : 'unknown'}`;
  e.code = err && err.code;
  return e;
}

async function listTables() {
  try {
    const url = `/api/v2/meta/bases/${encodeURIComponent(config.nocodb.baseId)}/tables`;
    const resp = await client.get(url);
    const list = (resp.data && (resp.data.list || resp.data.tables)) || [];
    return list.map((t) => ({
      id: String(t.id),
      name: String(t.title || t.table_name || t.name || t.id),
    }));
  } catch (err) {
    throw upstreamError(err, 'listTables');
  }
}

async function countRows(tableId) {
  try {
    const url = `/api/v2/tables/${encodeURIComponent(tableId)}/records/count`;
    const resp = await client.get(url);
    const n = Number(resp.data && resp.data.count);
    return Number.isFinite(n) ? n : 0;
  } catch (err) {
    throw upstreamError(err, 'countRows');
  }
}

async function* iterateTableRows(tableId, { pageSize = 1000, hardLimit } = {}) {
  let offset = 0;
  let yielded = 0;
  while (true) {
    let resp;
    try {
      resp = await client.get(`/api/v2/tables/${encodeURIComponent(tableId)}/records`, {
        params: { limit: pageSize, offset, shuffle: 0 },
      });
    } catch (err) {
      throw upstreamError(err, 'iterateTableRows');
    }
    const data = resp.data || {};
    const rows = data.list || [];
    if (!rows.length) return;
    for (const row of rows) {
      if (hardLimit !== undefined && yielded >= hardLimit) return;
      yield row;
      yielded += 1;
    }
    const pageInfo = data.pageInfo || {};
    if (pageInfo.isLastPage === true) return;
    if (rows.length < pageSize) return;
    offset += rows.length;
  }
}

module.exports = { listTables, countRows, iterateTableRows };
