import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { canManageSetup } from "@/lib/database";
import { resolvePropertyId } from "@/lib/pmsGuard";
import { getPropertyProfile, savePropertyProfile, validateProfile } from "@/lib/events";

/**
 * The property profile: country, state, city and the kinds of property it
 * is. These are the tags events are matched on, so a hotel sees the events
 * of its own town and kind.
 *
 * Anyone signed in may read their own hotel's profile -- the Events page
 * shows it -- but only someone who may change setup may change it.
 */

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const propertyId = await resolvePropertyId(session, req.nextUrl.searchParams.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  try {
    return NextResponse.json({ profile: await getPropertyProfile(propertyId) });
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

  const { profile, error } = validateProfile(body.profile);
  if (error) return NextResponse.json({ error }, { status: 400 });

  try {
    await savePropertyProfile(propertyId, profile);
    return NextResponse.json({ profile });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
