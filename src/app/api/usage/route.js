import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { getSupabaseAdmin } from "@/lib/database";
import { resolvePropertyId } from "@/lib/propertyScope";
import { MODULES } from "@/app/dashboard/modules";

/**
 * Count one page open: page, role and job profile only -- never who (see
 * migration 042). Best effort: until the table exists, or if the insert
 * fails, it answers 204 all the same, since a page view must never fail
 * because it could not be counted.
 */

const PAGES = new Set(MODULES.map((m) => m.id));
const PROFILES = new Set(["owner", "desk", "housekeeping", "other"]);

export async function POST(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) return new NextResponse(null, { status: 204 });

  let body;
  try {
    body = await req.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (!PAGES.has(body?.page)) return new NextResponse(null, { status: 204 });

  try {
    const propertyId = await resolvePropertyId(session, body?.propertyId);
    await getSupabaseAdmin()
      .from("page_opens")
      .insert({
        property_id: propertyId || null,
        page_id: body.page,
        role: session.role || null,
        profile: PROFILES.has(body?.profile) ? body.profile : "other",
      });
  } catch {
    // Not counted; nothing else changes.
  }
  return new NextResponse(null, { status: 204 });
}
