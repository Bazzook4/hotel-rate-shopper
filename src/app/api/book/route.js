import { NextResponse } from "next/server";
import { createOnlineBooking, hotelView, isMobileRequest } from "@/lib/bookingEngine";
import { openHotel } from "./shared";

/** The hotel's booking page: what it shows first, and booking a stay. */

export async function GET(req) {
  const { hotel, response } = await openHotel(req, req.nextUrl.searchParams.get("key"));
  if (response) return response;
  return NextResponse.json(hotelView(hotel));
}

export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { hotel, record, response } = await openHotel(req, body.key, "book");
  if (response) return response;

  // A box people never see, which only a bot fills in. It is told it
  // worked, so it learns nothing.
  if (body.website) return NextResponse.json({ token: null, ok: true });

  try {
    const result = await createOnlineBooking(hotel, body, { mobile: isMobileRequest(req) });
    if (result.error) return NextResponse.json(result, { status: result.gone ? 409 : 400 });
    await record();
    return NextResponse.json(result);
  } catch (err) {
    console.error("Website booking failed:", err.message);
    return NextResponse.json(
      { error: "Your booking did not go through. Nothing has been booked. Please try again." },
      { status: 500 }
    );
  }
}
