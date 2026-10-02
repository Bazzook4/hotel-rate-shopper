import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/permissions";
import { getUserById, getUserPropertyId } from "@/lib/database";
import { effectiveModules } from "@/lib/rights";

/**
 * A 403 when the signed-in user may not use `moduleId`, else null. Given a
 * list, any one of those pages is enough: a route several pages share must
 * stay open to whoever holds any of them.
 *
 * Read from the database rather than the session cookie, which keeps the
 * rights from sign-in for a week: taking a page away must take effect now.
 */
export async function moduleDeniedResponse(session, moduleId) {
  const { rights } = await sessionRights(session);
  const wanted = Array.isArray(moduleId) ? moduleId : [moduleId];
  if (wanted.some((id) => rights.includes(id))) return null;
  return NextResponse.json(
    { error: "This feature is not enabled for your account." },
    { status: 403 }
  );
}

/**
 * The signed-in user and the pages they may use right now, for a route that
 * shows several pages' worth of data and must leave out what is switched off.
 */
export async function sessionRights(session) {
  const user = await getUserById(session?.userId).catch(() => null);
  const own = user && !isSuperAdmin(user) ? await getUserPropertyId(user.id).catch(() => null) : null;
  const rights = await effectiveModules(user, own).catch(() => []);
  return { user, rights };
}

/**
 * The property a request may act on.
 *
 * A SuperAdmin may name one and falls back to their own; everyone else is
 * forced onto theirs, and naming someone else's is refused rather than
 * quietly redirected. Returns null when the caller may not act at all, which
 * every caller turns into a 403.
 */
export async function resolvePropertyId(session, requested) {
  const own = session?.property_id || (await getUserPropertyId(session?.userId).catch(() => null));
  if (isSuperAdmin(session)) return requested || own;
  if (requested && requested !== own) return null;
  return own;
}
