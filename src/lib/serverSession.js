/**
 * The session as API routes should trust it.
 *
 * The cookie is signed at sign-in and lasts a week, so on its own it still
 * says what was true then. A user switched off, removed, moved to another
 * hotel or given a lower role would keep their old access for the rest of
 * that week. So every request reads the user again: anyone no longer Active
 * gets no session, and the role and hotel come from the database, not the
 * cookie.
 *
 * Server-side only. The middleware keeps using the cookie alone (lib/session),
 * since it runs before any route and only decides whether to show sign-in.
 */

import { getSessionFromRequest as readCookie } from "@/lib/session";
import { getUserById, getUserPropertyId } from "@/lib/database";
import { isSuperAdmin } from "@/lib/permissions";

export * from "@/lib/session";

export async function getSessionFromRequest(req) {
  const session = await readCookie(req);
  // The local-development stand-in has no user row to check.
  if (!session?.userId || session.userId === "dev-user") return session;

  const user = await getUserById(session.userId).catch(() => null);
  if (!user || (user.status && user.status !== "Active")) return null;

  const own = await getUserPropertyId(user.id).catch(() => null);
  return {
    ...session,
    role: user.role,
    email: user.email || session.email,
    // A super admin works across hotels and keeps the one they picked.
    property_id: isSuperAdmin(user) ? session.property_id || own : own,
  };
}
