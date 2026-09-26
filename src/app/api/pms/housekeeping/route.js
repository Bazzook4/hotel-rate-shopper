import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import {
  getHousekeepingBoard,
  setRoomHousekeeping,
  HOUSEKEEPING_STATUSES,
} from "@/lib/database";

/**
 * Housekeeping: which rooms are clean, dirty, inspected or out of order.
 *
 * Front-office work, so it needs a session but not the setup permission --
 * the housekeeper marking 204 clean is not configuring the property.
 */

export async function GET(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return error;

  const params = req.nextUrl.searchParams;
  const propertyId = await resolvePropertyId(session, params.get("propertyId"));
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  // The client sends its own today: the server's clock is UTC and a hotel in
  // India is on tomorrow for five and a half hours of the server's today.
  const date = params.get("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
    return NextResponse.json({ error: "A date is required" }, { status: 400 });
  }

  try {
    return NextResponse.json({ rooms: await getHousekeepingBoard(propertyId, date) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const propertyId = await resolvePropertyId(session, body?.property_id);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids : body.id ? [body.id] : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "Choose at least one room" }, { status: 400 });
  }
  if (!HOUSEKEEPING_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "Unknown housekeeping status" }, { status: 400 });
  }

  try {
    const rooms = await setRoomHousekeeping(propertyId, ids, body.status, session.userId);
    return NextResponse.json({ rooms });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
