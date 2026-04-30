'use strict';

const bcrypt = require('bcryptjs');
const config = require('../config');

const byEmail = new Map(config.users.map((u) => [u.email, u]));

function findByEmail(email) {
  if (typeof email !== 'string') return null;
  return byEmail.get(email.trim().toLowerCase()) || null;
}

async function verifyPassword(plain, hash) {
  if (typeof plain !== 'string' || typeof hash !== 'string') return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch (_) {
    return false;
  }
}

const FAKE_HASH = '$2a$12$CwTycUXWue0Thq9StjUM0uJ8CbPEcL0rVkgY2qNb6NcaJzYTzGv9G';

async function authenticate(email, password) {
  const user = findByEmail(email);
  // Run bcrypt even on miss to keep timing constant.
  if (!user) {
    await bcrypt.compare(String(password || ''), FAKE_HASH).catch(() => false);
    return null;
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;
  return { id: user.id, email: user.email, role: user.role };
}

module.exports = { findByEmail, authenticate };
