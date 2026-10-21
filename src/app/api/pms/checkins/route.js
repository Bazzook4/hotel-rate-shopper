import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId, BOOKING_VIEW_PAGES } from "@/lib/pmsGuard";
import { moduleDeniedResponse } from "@/lib/propertyScope";
import { getReservation } from "@/lib/database";
import {
  CHECKIN_NOT_READY,
  acceptCheckin,
  checkinReady,
  deleteCheckin,
  deskView,
  ensureCheckin,
  getCheckinForReservation,
  getCheckinPrefs,
} from "@/lib/onlineCheckin";

/**
 * A booking's online check-in, from the desk: make the link, see what the
 * guest sent, accept it into the guest records, or switch the link off.
 *
 * Part of working a booking, so it opens to the same pages as the booking
 * window. The ID photos themselves need the Guests page, as they do there.
 */

/** The booking, if this session may act on it, or a response to send instead. */
async function scope(req, reservationId) {
  const { error, session } = await pmsGuard(req, BOOKING_VIEW_PAGES);
  if (error) return { response: error };
  if (!reservationId) return { response: NextResponse.json({ error: "Reservation id is required" }, { status: 400 }) };
  const reservation = await getReservation(reservationId).catch(() => null);
  if (!reservation) return { response: NextResponse.json({ error: "Reservation not found" }, { status: 404 }) };
  if (!(await resolvePropertyId(session, reservation.property_id))) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, reservation };
}

async function answer(session, reservation) {
  const [prefs, row, idsDenied] = await Promise.all([
    getCheckinPrefs(reservation.property_id),
    getCheckinForReservation(reservation.id),
    moduleDeniedResponse(session, ["guests"]),
  ]);
  return NextResponse.json({
    ready: true,
    enabled: prefs.enabled,
    canSeeIds: !idsDenied,
    checkin: await deskView(row, { reservation, withFiles: !idsDenied }),
  });
}

export async function GET(req) {
  const { session, reservation, response } = await scope(req, req.nextUrl.searchParams.get("reservationId"));
  if (response) return response;
  // Before the migration the booking window simply shows no online check-in.
  if (!(await checkinReady())) return NextResponse.json({ ready: false, enabled: false, checkin: { status: "none", guests: [] } });
  try {
    return await answer(session, reservation);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { session, reservation, response } = await scope(req, body.reservationId);
  if (response) return response;
  if (!(await checkinReady())) return NextResponse.json({ error: CHECKIN_NOT_READY }, { status: 409 });

  try {
    if (body.action === "create") {
      const prefs = await getCheckinPrefs(reservation.property_id);
      if (!prefs.enabled) {
        return NextResponse.json({ error: "Online check-in is switched off in Property Setup." }, { status: 409 });
      }
      if (!["inquiry", "confirmed"].includes(reservation.status)) {
        return NextResponse.json({ error: "Online check-in is only for bookings that have not arrived yet." }, { status: 409 });
      }
      await ensureCheckin(reservation, session.userId);
    } else if (body.action === "accept") {
      const row = await getCheckinForReservation(reservation.id);
      if (!row) return NextResponse.json({ error: "This booking has no online check-in." }, { status: 404 });
      await acceptCheckin(row, reservation, session.userId);
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    return await answer(session, await getReservation(reservation.id));
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  const { session, reservation, response } = await scope(req, req.nextUrl.searchParams.get("reservationId"));
  if (response) return response;
  if (!(await checkinReady())) return NextResponse.json({ error: CHECKIN_NOT_READY }, { status: 409 });
  try {
    const row = await getCheckinForReservation(reservation.id);
    if (row) await deleteCheckin(row);
    return await answer(session, reservation);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
