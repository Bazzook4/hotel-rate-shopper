import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId, BOOKING_VIEW_PAGES, BOOKING_PAGES } from "@/lib/pmsGuard";
import { getReservation } from "@/lib/database";
import { getOnlineBooking, setPaymentChecked } from "@/lib/bookingEngine";

/**
 * A website booking's payment, for the booking window: how the guest chose
 * to pay and where it stands, and the desk marking it received or not
 * found once it has looked at the bank.
 */

async function loadFor(session, reservationId) {
  if (!reservationId) return { response: NextResponse.json({ error: "Reservation id is required" }, { status: 400 }) };
  const reservation = await getReservation(reservationId).catch(() => null);
  if (!reservation) return { response: NextResponse.json({ error: "Reservation not found" }, { status: 404 }) };
  if (!(await resolvePropertyId(session, reservation.property_id))) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { reservation, row: await getOnlineBooking(reservationId) };
}

/** The guest's private link is never sent to the desk; it is the guest's key. */
function deskView(row) {
  if (!row) return null;
  const { token: _token, ...rest } = row;
  return rest;
}

export async function GET(req) {
  const { error, session } = await pmsGuard(req, BOOKING_VIEW_PAGES);
  if (error) return error;
  try {
    const { row, response } = await loadFor(session, req.nextUrl.searchParams.get("reservationId"));
    if (response) return response;
    return NextResponse.json({ online: deskView(row) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const { error, session } = await pmsGuard(req, BOOKING_PAGES);
  if (error) return error;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  if (!["received", "not_received"].includes(body.outcome)) {
    return NextResponse.json({ error: "Unknown outcome" }, { status: 400 });
  }
  try {
    const { row, response } = await loadFor(session, body.reservationId);
    if (response) return response;
    if (!row) return NextResponse.json({ error: "This is not a website booking." }, { status: 404 });
    const saved = await setPaymentChecked(row, body.outcome, {
      userId: session.userId,
      amount: body.amount ?? null,
    });
    return NextResponse.json({ online: deskView(saved) });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
