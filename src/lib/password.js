import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const METHOD = "scrypt";
const SALT_BYTES = 16;
const KEY_LENGTH = 64;

function encode(buffer) {
  return buffer.toString("base64");
}

function decode(str) {
  return Buffer.from(str, "base64");
}

/**
 * Hash a plain-text password using Node's built-in scrypt implementation.
 * The result is stored as `scrypt:<salt>:<hash>` in base64.
 */
export function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password must be a non-empty string");
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, KEY_LENGTH);
  return `${METHOD}:${encode(salt)}:${encode(derived)}`;
}

/**
 * Verify a password against a stored hash produced by `hashPassword`.
 */
export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [method, saltB64, hashB64] = stored.split(":");
  if (method !== METHOD || !saltB64 || !hashB64) {
    return false;
  }
  try {
    const salt = decode(saltB64);
    const expected = decode(hashB64);
    const derived = scryptSync(password, salt, expected.length);
    return timingSafeEqual(expected, derived);
  } catch (err) {
    return false;
  }
}
