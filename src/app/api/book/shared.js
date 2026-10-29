import { NextResponse } from "next/server";
import { bookingAllowed, clientIp, recordBookingUse } from "@/lib/rateLimit";
import { findHotelByKey } from "@/lib/bookingEngine";

/**
 * The booking page's routes have no sign-in: the page key picks the hotel.
 * An unknown key and a hotel that switched its page off look the same.
 */

export const CLOSED = { error: "Online booking is not open for this hotel right now. Please contact the hotel." };
export const BUSY = { error: "Too many tries from your network. Please wait a while and try again." };

/** The hotel behind a request, or a response to send instead. */
export async function openHotel(req, key, kind) {
  const ip = clientIp(req);
  if (kind && !(await bookingAllowed(kind, ip))) {
    return { response: NextResponse.json(BUSY, { status: 429 }) };
  }
  const hotel = await findHotelByKey(key);
  if (!hotel) return { response: NextResponse.json(CLOSED, { status: 404 }) };
  return { hotel, ip, record: (k = kind) => recordBookingUse(k, ip) };
}
