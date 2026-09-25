import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { getUserPropertyId } from "@/lib/database";

/**
 * Session and property scoping for the PMS routes.
 *
 * Every PMS route repeats the same two questions -- is this a real session,
 * and which property may it act on -- so they live here rather than being
 * copied into each route. Unlike the Setup routes this does not require
 * `canManageSetup`: taking a booking is ordinary front-desk work, not
 * configuring the property, so a PropertyUser must be able to do it.
 */
export async function pmsGuard(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session };
}

/**
 * The property a request may act on.
 *
 * Only a super admin may name a property other than their own; anyone else
 * passing an id has it ignored rather than trusted. Returns null when there
 * is no property to act on, which the caller turns into a 400.
 */
export async function resolvePropertyId(session, requested) {
  const own =
    session.property_id ||
    (await getUserPropertyId(session.userId).catch(() => null));

  if (isSuperAdmin(session)) return requested || own;
  if (requested && requested !== own) return null;
  return own;
}
