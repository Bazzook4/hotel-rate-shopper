import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import { getUserPropertyId } from "@/lib/database";
import { syncInventoryForward, FORWARD_DAYS } from "@/lib/inventorySync";

/**
 * Resend availability from the PMS for a date range.
 *
 * Every booking change already pushes the nights it touched. This is for when
 * one of those pushes did not land -- the channel manager was down, a room
 * was mapped after the fact -- and the channels have drifted from the PMS.
 * The counts are worked out fresh, never taken from the request: the PMS is
 * the only thing that knows them.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    // No body resends the default window for every mapped room type.
  }

  const own =
    session.property_id ||
    (await getUserPropertyId(session.userId).catch(() => null));
  const requested = body.propertyId || null;
  const propertyId = isSuperAdmin(session)
    ? requested || own
    : !requested || requested === own
    ? own
    : null;
  if (!propertyId) {
    return NextResponse.json(
      { error: "No property selected, or not yours to update." },
      { status: 400 }
    );
  }

  const { start = null, end = null, roomTypeIds = null } = body;
  if ((start && !ISO_DATE.test(start)) || (end && !ISO_DATE.test(end))) {
    return NextResponse.json({ error: "Dates must be YYYY-MM-DD." }, { status: 400 });
  }
  if (start && end && start > end) {
    return NextResponse.json({ error: "The start date is after the end date." }, { status: 400 });
  }
  if (start && end) {
    const days = (new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000;
    if (days >= FORWARD_DAYS) {
      return NextResponse.json(
        { error: `Resend at most ${FORWARD_DAYS} days at a time.` },
        { status: 400 }
      );
    }
  }

  const inventory = await syncInventoryForward(propertyId, roomTypeIds, {
    session,
    from: start,
    to: end,
  });

  const status = inventory.status === "failed" ? 502 : 200;
  return NextResponse.json({ inventory }, { status });
}
