import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { canManageSetup } from "@/lib/database";
import { resolvePropertyId } from "@/lib/pmsGuard";
import { BOOKING_NOT_READY, getBookingSettings, saveBookingSettings } from "@/lib/bookingEngine";

/**
 * The hotel's booking engine choices (properties.booking_engine) and its
 * page key. Anyone signed in may read their own hotel's; only someone who
 * may change setup may change them.
 */

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const propertyId = await resolvePropertyId(session, req.nextUrl.searchParams.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  try {
    return NextResponse.json(await getBookingSettings(propertyId));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canManageSetup(session.userId))) {
    return NextResponse.json({ error: "You do not have permission to change property setup." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const propertyId = await resolvePropertyId(session, body.propertyId);
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  try {
    const result = await saveBookingSettings(propertyId, body.prefs);
    if (result.error) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    const missing = err.message === BOOKING_NOT_READY;
    return NextResponse.json({ error: err.message }, { status: missing ? 409 : 500 });
  }
}
