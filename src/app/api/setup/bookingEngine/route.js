import { NextResponse } from "next/server";
import { canManageSetup, listRatePlans, listRoomTypes } from "@/lib/database";
import { pmsGuard, resolvePropertyId } from "@/lib/pmsGuard";
import { isDayUsePlan } from "@/lib/dayUse";
import { mealPlan } from "@/lib/mealPlans";
import {
  BOOKING_NOT_READY,
  getBookingSettings,
  saveBookingContent,
  saveBookingSettings,
} from "@/lib/bookingEngine";
import { BOOKING_ENGINE_PAGES } from "@/lib/bookingEngineShared";

/**
 * The Booking Engine page: the hotel's payment choices and page key
 * (properties.booking_engine), and what the booking page shows -- rooms,
 * plans, promotions and long-stay discounts.
 *
 * Open to whoever holds the Booking Engine page, or Rates & Inventory, since
 * the content is selling work. Where guests' money goes -- the UPI ID -- is
 * changed only by someone who may change property setup.
 */

export async function GET(req) {
  const { error, session } = await pmsGuard(req, BOOKING_ENGINE_PAGES);
  if (error) return error;

  const propertyId = await resolvePropertyId(session, req.nextUrl.searchParams.get("propertyId"));
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  try {
    const [settings, roomTypes, ratePlans, canSetup] = await Promise.all([
      getBookingSettings(propertyId),
      listRoomTypes(propertyId),
      listRatePlans(propertyId),
      canManageSetup(session.userId),
    ]);
    return NextResponse.json({
      ...settings,
      canChangePayment: canSetup,
      roomTypes: roomTypes.map((t) => ({
        id: t.id,
        name: t.room_type_name,
        description: t.description || "",
        amenities: Array.isArray(t.amenities) ? t.amenities : [],
      })),
      ratePlans: ratePlans
        .filter((p) => !isDayUsePlan(p))
        .map((p) => ({
          id: p.id,
          name: p.plan_name || "",
          meals: mealPlan(p.meal_plan)?.hint || "",
          refundable: p.refundable !== false,
        })),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/** { prefs } saves the payment choices; { content } saves the page's content. */
export async function PUT(req) {
  const { error, session } = await pmsGuard(req, BOOKING_ENGINE_PAGES);
  if (error) return error;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const propertyId = await resolvePropertyId(session, body.propertyId);
  if (!propertyId) return NextResponse.json({ error: "No property selected" }, { status: 400 });

  try {
    if (body.prefs) {
      if (!(await canManageSetup(session.userId))) {
        return NextResponse.json(
          { error: "Only someone who may change property setup can change how guests pay." },
          { status: 403 }
        );
      }
      const result = await saveBookingSettings(propertyId, body.prefs);
      if (result.error) return NextResponse.json(result, { status: 400 });
      return NextResponse.json(result);
    }
    if (body.content) return NextResponse.json(await saveBookingContent(propertyId, body.content));
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  } catch (err) {
    const missing = err.message === BOOKING_NOT_READY;
    return NextResponse.json({ error: err.message }, { status: missing ? 409 : 500 });
  }
}
