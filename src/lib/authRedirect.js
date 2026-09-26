"use client";

/**
 * What the browser does when the server says the session is gone.
 *
 * The middleware answers an expired session with a 401 rather than a redirect,
 * because a redirect to an HTML login page is invisible to fetch() -- it
 * follows it, fails to parse the result, and the caller sees only an opaque
 * network error. That fixes the confusing message, but a 401 on its own still
 * leaves the desk staring at a form that will not save.
 *
 * So the reply is turned back into the thing the person needs: the login
 * screen, carrying where they were, so signing in returns them to the booking
 * they were part way through rather than to the dashboard root.
 *
 * Returns true when it has taken over, so the caller can stop.
 */
export function handleExpiredSession(res) {
  if (!res || res.status !== 401) return false;
  if (typeof window === "undefined") return false;

  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  return true;
}
