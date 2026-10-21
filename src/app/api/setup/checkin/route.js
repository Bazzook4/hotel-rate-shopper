import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { canManageSetup } from "@/lib/database";
import { resolvePropertyId } from "@/lib/pmsGuard";
import { getCheckinPrefs, saveCheckinPrefs } from "@/lib/onlineCheckin";

/**
 * What the hotel asks of guests on online check-in (properties.checkin_prefs).
 *
 * Anyone signed in may read their own hotel's choices -- the booking window
 * follows them -- but only someone who may change setup may change them.
 * Before migration 053 reading gives the defaults and saving says what to run.
 */

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const propertyId = await resolvePropertyId(session, req.nextUrl.searchParams.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  try {
    return NextResponse.json({ prefs: await getCheckinPrefs(propertyId) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canManageSetup(session.userId))) {
    return NextResponse.json(
      { error: "You do not have permission to change property setup." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const propertyId = await resolvePropertyId(session, body.propertyId);
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  try {
    return NextResponse.json({ prefs: await saveCheckinPrefs(propertyId, body.prefs) });
  } catch (err) {
    const missing = /053_online_checkin/.test(err.message);
    return NextResponse.json({ error: err.message }, { status: missing ? 409 : 500 });
  }
}
