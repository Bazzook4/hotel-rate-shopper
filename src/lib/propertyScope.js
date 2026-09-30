import { NextResponse } from "next/server";
import { isSuperAdmin } from "@/lib/permissions";
import { getUserModules, getUserPropertyId } from "@/lib/database";
import { grantsInclude } from "@/app/dashboard/modules";

/**
 * A 403 when the signed-in user has not been granted `moduleId`, else null.
 *
 * Read from the database rather than the session cookie, which keeps the
 * grants from sign-in for a week: taking a page away must take effect now.
 */
export async function moduleDeniedResponse(session, moduleId) {
  const granted = await getUserModules(session?.userId).catch(() => []);
  if (grantsInclude(granted, moduleId)) return null;
  return NextResponse.json(
    { error: "This feature is not enabled for your account." },
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
