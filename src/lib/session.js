import { createHmac, timingSafeEqual } from "crypto";

const COOKIE_NAME = "rate_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured");
  }
  return secret;
}

function base64UrlEncode(input) {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(str) {
  return Buffer.from(str, "base64url");
}

export function encodeSession(payload) {
  const secret = getSecret();
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(body).digest();
  return `${body}.${base64UrlEncode(signature)}`;
}

export function decodeSession(token) {
  if (!token) return null;
  const secret = getSecret();
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  try {
    const expected = createHmac("sha256", secret).update(body).digest();
    const actual = base64UrlDecode(signature);
    if (expected.length !== actual.length) return null;
    if (!timingSafeEqual(expected, actual)) return null;
    const json = base64UrlDecode(body).toString("utf8");
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

export function setSessionCookie(response, payload) {
  const token = encodeSession(payload);
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

export function getSessionFromRequest(req) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = decodeSession(token);
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
