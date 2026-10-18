import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { canManageSetup, getDayUseHours, setDayUseHours } from "@/lib/database";
import { resolvePropertyId } from "@/lib/pmsGuard";

/**
 * The day-use slots a hotel offers (properties.day_use_hours): 3, 6 and 9
 * hours unless it changes them. Their prices live on each room type.
 *
 * Anyone signed in may read their own hotel's slots -- the booking form
 * offers them -- but only someone who may change setup may change them.
 */

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const propertyId = await resolvePropertyId(session, req.nextUrl.searchParams.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  try {
    return NextResponse.json({ hours: await getDayUseHours(propertyId) });
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
    return NextResponse.json({ hours: await setDayUseHours(propertyId, body.hours) });
  } catch (err) {
    const missing = /migration 048/.test(err.message);
    return NextResponse.json({ error: err.message }, { status: missing ? 409 : 500 });
  }
}
