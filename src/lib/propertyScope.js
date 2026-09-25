import { isSuperAdmin } from "@/lib/permissions";
import { getUserPropertyId } from "@/lib/database";

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
