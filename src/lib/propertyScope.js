import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/permissions";
import { getPropertyById, getUserPropertyId } from "@/lib/database";

/**
 * A 403 when the property has `moduleId` switched off, else null.
 *
 * Page grants live on users, so they cannot stop a property from having a
 * feature: a PropertyAdmin can add a colleague with no grants, which means
 * every page. `properties.disabled_modules` is the property's own list, and
 * the routes check it because hiding a page does not stop its API.
 */
export async function moduleDisabledResponse(propertyId, moduleId) {
  const property = await getPropertyById(propertyId).catch(() => null);
  if (!property?.disabled_modules?.includes(moduleId)) return null;
  return NextResponse.json(
    { error: "This feature is not enabled for your property." },
    { status: 403 }
  );
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
