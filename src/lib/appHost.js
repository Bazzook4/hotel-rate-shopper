/**
 * Which web addresses are the app's own. Anything else that reaches the app
 * is a hotel's own domain, pointed at its website. Kept apart from the
 * database code so the middleware can use it.
 */

export const APP_URL = process.env.APP_URL || "https://hms.onlinehotelier.com";

/** Whether a request's host is ours, so anything else is a hotel's own domain. */
export function isAppHost(host) {
  const h = String(host || "").toLowerCase().split(":")[0];
  if (!h || h === "localhost" || h.endsWith(".vercel.app") || h.endsWith(".localhost")) return true;
  const own = new Set(
    ["hms.onlinehotelier.com", ...String(process.env.APP_HOSTS || "").split(",")].map((v) => v.trim().toLowerCase()).filter(Boolean)
  );
  return own.has(h);
}
