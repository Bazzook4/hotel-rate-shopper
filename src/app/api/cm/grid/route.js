import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import {
  listRoomTypes,
  listRatePlans,
  getPropertyIntegration,
  getUserPropertyId,
} from "@/lib/database";
import { resolveAllRates } from "@/lib/ratePlanPricing";
import { planLabel } from "@/lib/mealPlans";

/**
 * The Channel Manager grid, assembled from the property's own setup rather
 * than from a fixture: room types and rate plans from Property Setup, and
 * the partner codes from the Integrations mapping.
 */
export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const own =
    session.property_id ||
    (await getUserPropertyId(session.userId).catch(() => null));
  const requested = req.nextUrl.searchParams.get("propertyId");

  const propertyId = isSuperAdmin(session)
    ? requested || own
    : !requested || requested === own
    ? own
    : null;

  if (!propertyId) {
    return NextResponse.json(
      { error: "No property selected, or not yours to view." },
      { status: 400 }
    );
  }

  try {
    const [roomTypes, ratePlans, integration] = await Promise.all([
      listRoomTypes(propertyId),
      listRatePlans(propertyId),
      getPropertyIntegration(propertyId, "aiosell").catch(() => null),
    ]);

    // Partner codes, keyed by what they map.
    const codeByRoom = {};
    const codeByPlan = {};
    for (const row of integration?.codeMap || []) {
      if (row.rate_plan_id) {
        codeByPlan[`${row.rate_plan_id}|${row.occupancy ?? 1}`] = {
          code: row.partner_rateplan_code,
          extraAdult: row.extra_adult,
          meals: row.no_of_meals,
        };
      } else if (row.room_type_id) {
        codeByRoom[row.room_type_id] = row.partner_room_code;
      }
    }

    // A plan's own rate comes from its room type's base price; derived plans
    // resolve from their master.
    const baseRates = {};
    const roomById = Object.fromEntries(roomTypes.map((r) => [r.id, r]));
    for (const p of ratePlans) {
      const room = roomById[p.room_type_id];
      baseRates[p.id] = room ? Number(room.base_price) : null;
    }
    const resolved = resolveAllRates(ratePlans, baseRates);

    // One row per rate plan per occupancy, matching how the partner models
    // rate plans and how the grid displays them.
    const rooms = roomTypes.map((room) => {
      const plans = ratePlans.filter(
        (p) => !p.room_type_id || p.room_type_id === room.id
      );
      const maxAdults = room.max_adults || 2;

      return {
        id: room.id,
        name: room.room_type_name,
        partnerCode: codeByRoom[room.id] || null,
        count: room.number_of_rooms,
        maxAdults,
        basePrice: Number(room.base_price),
        plans: plans.map((p) => ({
          id: p.id,
          name: p.plan_name,
          label: planLabel(p),
          mealPlan: p.meal_plan,
          refundable: p.refundable !== false,
          restrictions: {
            stopSell: Boolean(p.stop_sell),
            minStay: p.min_stay ?? null,
            maxStay: p.max_stay ?? null,
          },
          resolvedRate: resolved[p.id] ?? null,
          occupancies: Array.from({ length: maxAdults }, (_, i) => i + 1).map(
            (occ) => ({
              occupancy: occ,
              partnerCode: codeByPlan[`${p.id}|${occ}`]?.code || null,
              extraAdult: codeByPlan[`${p.id}|${occ}`]?.extraAdult ?? null,
            })
          ),
        })),
      };
    });

    const unmapped = rooms.filter((r) => !r.partnerCode).length;

    return NextResponse.json({
      propertyId,
      rooms,
      connected: Boolean(integration?.integration?.enabled),
      hotelCode: integration?.integration?.hotel_code || null,
      unmappedRooms: unmapped,
      ready: rooms.length > 0,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
