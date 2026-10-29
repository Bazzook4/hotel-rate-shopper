import { NextResponse } from "next/server";
import { bookingAllowed, clientIp, recordBookingUse } from "@/lib/rateLimit";
import { findOnlineBooking, guestBookingView, markGuestPaid } from "@/lib/bookingEngine";
import { BUSY } from "../shared";

/**
 * A guest's own booking, from its private link: where it stands, and the
 * hotel's UPI details while money is owed. An unknown link is counted like a
 * wrong sign-in, so links cannot be guessed in bulk.
 */

const GONE = { error: "We could not find this booking. Please sign in again or contact the hotel." };

async function open(req, token) {
  const ip = clientIp(req);
  if (!(await bookingAllowed("badLogin", ip))) return { response: NextResponse.json(BUSY, { status: 429 }) };
  const found = await findOnlineBooking(token);
  if (!found) {
    await recordBookingUse("badLogin", ip);
    return { response: NextResponse.json(GONE, { status: 404 }) };
  }
  return { found };
}

export async function GET(req) {
  const { found, response } = await open(req, req.nextUrl.searchParams.get("token"));
  if (response) return response;
  try {
    return NextResponse.json(await guestBookingView(found));
  } catch (err) {
    console.error("Booking status failed:", err.message);
    return NextResponse.json({ error: "Could not load your booking. Please try again." }, { status: 500 });
  }
}

/** The guest says they paid, with the UPI reference from their app if they have it. */
export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { found, response } = await open(req, body.token);
  if (response) return response;
  try {
    const result = await markGuestPaid(found, body.reference);
    if (result.error) return NextResponse.json(result, { status: 409 });
    const fresh = await findOnlineBooking(body.token);
    return NextResponse.json(await guestBookingView(fresh));
  } catch (err) {
    console.error("Marking a website payment failed:", err.message);
    return NextResponse.json({ error: "That did not save. Please try again." }, { status: 500 });
  }
}
