import { NextResponse } from "next/server";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { simulateOffers } from "@/lib/bookingEngine";
import { BOOKING_ENGINE_PAGES } from "@/lib/bookingEngineShared";

/**
 * The Offers tab's simulator: what a guest would pay for a stay, and why
 * each offer did or did not apply. Prices only; books nothing.
 */
export async function POST(req) {
  const { error, session } = await pmsGuard(req, BOOKING_ENGINE_PAGES);
  if (error) return error;
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const propertyId = await resolvePropertyId(session, body.propertyId);
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });
  try {
    const result = await simulateOffers(propertyId, body);
    if (result.error) return NextResponse.json(result, { status: 400 });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
