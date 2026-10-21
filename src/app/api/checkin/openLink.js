import { NextResponse } from "next/server";
import { checkinAllowed, clientIp, recordCheckinUse } from "@/lib/rateLimit";
import { checkinReady, findCheckinByToken } from "@/lib/onlineCheckin";

/**
 * Opening a check-in link, shared by the guest's routes. An unknown link, a
 * booking that is over, and a switched-off link all look the same from
 * outside, so the page cannot be used to learn which bookings exist.
 */

export const GONE = { error: "This check-in link is no longer valid. Please contact the hotel." };
const BUSY = { error: "Too many tries from your network. Please wait a while and try again." };

/** The check-in behind the request's link, or a response to send instead. */
export async function openLink(req, token) {
  const ip = clientIp(req);
  if (!(await checkinAllowed(ip))) return { response: NextResponse.json(BUSY, { status: 429 }) };
  if (!(await checkinReady())) return { response: NextResponse.json(GONE, { status: 404 }) };
  const found = await findCheckinByToken(token);
  if (!found) {
    await recordCheckinUse(ip, { badLink: true });
    return { response: NextResponse.json(GONE, { status: 404 }) };
  }
  return { found, ip };
}

