#!/usr/bin/env node

/**
 * Password Hashing Utility (using scrypt - same as the app)
 *
 * Usage:
 *   node scripts/hashPassword.js "your-password"
 *
 * Example:
 *   node scripts/hashPassword.js "admin123"
 */

const crypto = require('crypto');

const METHOD = "scrypt";
const SALT_BYTES = 16;
const KEY_LENGTH = 64;

function encode(buffer) {
  return buffer.toString("base64");
}

function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password must be a non-empty string");
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `${METHOD}:${encode(salt)}:${encode(derived)}`;
}

const password = process.argv[2];

if (!password) {
  console.error('❌ Error: Please provide a password');
  console.log('\nUsage:');
  console.log('  node scripts/hashPassword.js "your-password"');
  console.log('\nExample:');
  console.log('  node scripts/hashPassword.js "admin123"');
  process.exit(1);
}

const hash = hashPassword(password);

console.log('\n✅ Password Hash Generated!\n');
console.log('Password:', password);
console.log('Hash:    ', hash);
console.log('\n📋 Copy the hash above and paste it into Airtable Users table → Password Hash field\n');
