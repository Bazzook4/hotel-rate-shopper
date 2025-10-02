const COOKIE_NAME = "rate_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }
  return secret;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function base64Encode(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64Decode(str) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(str, "base64"));
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64UrlEncode(bytes) {
  const base64 = base64Encode(bytes);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + "=".repeat(padLength);
  return base64Decode(base64);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function getHmacKey() {
  const secret = getSecret();
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto API is not available in this environment");
  }
  if (getHmacKey.cache?.secret === secret && getHmacKey.cache.key) {
    return getHmacKey.cache.key;
  }
  const keyData = textEncoder.encode(secret);
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  getHmacKey.cache = { secret, key };
  return key;
}

async function signPayload(body) {
  const key = await getHmacKey();
  const data = textEncoder.encode(body);
  const signature = await globalThis.crypto.subtle.sign("HMAC", key, data);
  return new Uint8Array(signature);
}

export async function encodeSession(payload) {
  const bodyBytes = textEncoder.encode(JSON.stringify(payload));
  const body = base64UrlEncode(bodyBytes);
  const signatureBytes = await signPayload(body);
  const signature = base64UrlEncode(signatureBytes);
  return `${body}.${signature}`;
}

export async function decodeSession(token) {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  try {
    const expected = await signPayload(body);
    const actual = base64UrlDecode(signature);
    if (!constantTimeEqual(expected, actual)) return null;
    const jsonBytes = base64UrlDecode(body);
    return JSON.parse(textDecoder.decode(jsonBytes));
  } catch (err) {
    return null;
  }
}

export async function setSessionCookie(response, payload) {
  const token = await encodeSession(payload);
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

export function clearSessionCookie(response) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

export async function getSessionFromRequest(req) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = await decodeSession(token);
  if (session) return session;

  if (process.env.DISABLE_AUTH === "true") {
    return {
      userId: "dev-user",
      email: "dev@example.com",
      role: "Admin",
      propertyId: process.env.DEV_PROPERTY_ID || null,
    };
  }

  return null;
}

export function getSessionCookieName() {
  return COOKIE_NAME;
}
