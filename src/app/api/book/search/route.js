import { NextResponse } from "next/server";
import { readStay, searchOffers } from "@/lib/bookingEngine";
import { openHotel } from "../shared";

/** Rooms free for the guest's dates, with prices. A question, so a GET. */

export async function GET(req) {
  const params = req.nextUrl.searchParams;
  const { hotel, record, response } = await openHotel(req, params.get("key"), "search");
  if (response) return response;

  const read = readStay(hotel, {
    checkIn: params.get("checkIn"),
    checkOut: params.get("checkOut"),
    adults: params.get("adults"),
    children: params.get("children"),
    code: params.get("code"),
  });
  if (read.error) return NextResponse.json({ error: read.error }, { status: 400 });

  await record();
  try {
    return NextResponse.json(await searchOffers(hotel, read.stay));
  } catch (err) {
    console.error("Booking engine search failed:", err.message);
    return NextResponse.json({ error: "Could not load the rooms. Please try again." }, { status: 500 });
  }
}
