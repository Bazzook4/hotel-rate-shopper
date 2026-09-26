import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { quoteReservation } from "@/lib/database";

/**
 * What a stay would cost, from the rates the property already has configured.
 *
 * The booking form asks this whenever the price basis changes -- room type,
 * plan, dates or occupancy -- so the desk is quoted rather than made to
 * remember. Read-only and cheap: it prices a stay, it does not hold one.
 *
 * A GET because it is a question, not a change, which also lets the browser
 * cancel one in flight when the desk is still typing.
 */

export async function GET(req) {
  const { error, session } = await pmsGuard(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);

  const propertyId = await resolvePropertyId(
    session,
    searchParams.get("propertyId")
  );
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected" }, { status: 400 });
  }

  try {
    const quote = await quoteReservation({
      property_id: propertyId,
      room_type_id: searchParams.get("roomTypeId"),
      rate_plan_id: searchParams.get("ratePlanId") || null,
      check_in: searchParams.get("checkIn"),
      check_out: searchParams.get("checkOut"),
      adults: Number(searchParams.get("adults")) || 2,
      children: Number(searchParams.get("children")) || 0,
    });

    return NextResponse.json(quote);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
