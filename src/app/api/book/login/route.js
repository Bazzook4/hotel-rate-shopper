import { NextResponse } from "next/server";
import { findBookingForLogin } from "@/lib/bookingEngine";
import { openHotel } from "../shared";

/**
 * Signing in to see a booking: the booking number and the mobile number or
 * email it was made with. A wrong pair is counted against the network, and
 * the answer never says which half was wrong.
 */

export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { hotel, record, response } = await openHotel(req, body.key, "badLogin");
  if (response) return response;

  try {
    const token = await findBookingForLogin(hotel, body.reference, body.contact);
    if (!token) {
      await record();
      return NextResponse.json(
        { error: "No booking matches that booking number and mobile number or email." },
        { status: 404 }
      );
    }
    return NextResponse.json({ token });
  } catch (err) {
    console.error("Booking sign-in failed:", err.message);
    return NextResponse.json({ error: "Could not sign you in. Please try again." }, { status: 500 });
  }
}
