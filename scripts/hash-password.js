#!/usr/bin/env node
'use strict';

const bcrypt = require('bcryptjs');

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: node scripts/hash-password.js <password>');
    console.error('Tip: wrap in single quotes so the shell does not interpret special chars.');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('Refusing to hash: password must be at least 12 characters.');
    process.exit(1);
  }
  const rounds = Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
  const hash = await bcrypt.hash(password, rounds);
  process.stdout.write(hash + '\n');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
