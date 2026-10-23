import { NextResponse } from "next/server";
import { recordCheckinUse } from "@/lib/rateLimit";
import { closedReason, findCheckinByToken, guestView, markOpened, saveGuestDetails } from "@/lib/onlineCheckin";
import { GONE, openLink } from "./openLink";

/** The guest's online check-in page, with no sign-in: the link is the key. */

export async function GET(req) {
  const { found, response } = await openLink(req, req.nextUrl.searchParams.get("token"));
  if (response) return response;
  if (!found.prefs.enabled) return NextResponse.json(GONE, { status: 404 });

  await markOpened(found.row);
  return NextResponse.json(guestView(found));
}

export async function POST(req) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const { found, ip, response } = await openLink(req, body.token);
  if (response) return response;
  if (!found.prefs.enabled) return NextResponse.json(GONE, { status: 404 });
  if (closedReason(found.row, found.reservation, found.property.timezone)) {
    return NextResponse.json({ error: "Your details can no longer be changed online. Please speak to the front desk." }, { status: 409 });
  }

  await recordCheckinUse(ip);
  try {
    const result = await saveGuestDetails(found, body, { submit: body.submit === true });
    if (result.error) return NextResponse.json({ error: result.error, gap: result.gap }, { status: 400 });
    const fresh = await findCheckinByToken(body.token);
    return NextResponse.json(guestView(fresh));
  } catch (err) {
    console.error("Online check-in save failed:", err.message);
    return NextResponse.json({ error: "Your details did not save. Please try again." }, { status: 500 });
  }
}
