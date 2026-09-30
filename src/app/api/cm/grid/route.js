import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import { isSuperAdmin } from "@/lib/permissions";
import {
  listRoomTypes,
  listRatePlans,
  getPropertyIntegration,
  getUserPropertyId,
  listDailyRates,
  listDailyRestrictions,
  listRatePlanRooms,
  getAvailabilityGrid,
} from "@/lib/database";
import {
  describeRule,
  gridOwnRateAt,
  plansForRoom,
  roomRateResolver,
} from "@/lib/ratePlanPricing";
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
    const start = req.nextUrl.searchParams.get("start");
    const end = req.nextUrl.searchParams.get("end");

    const [
      roomTypes,
      ratePlans,
      integration,
      stored,
      storedRestrictions,
      assignments,
      availabilityGrid,
    ] = await Promise.all([
        listRoomTypes(propertyId),
        listRatePlans(propertyId),
        getPropertyIntegration(propertyId, "aiosell").catch(() => null),
        start && end ? listDailyRates(propertyId, start, end).catch(() => []) : [],
        start && end
          ? listDailyRestrictions(propertyId, start, end).catch(() => [])
          : [],
        // Additive: a property with no assignments yet still loads, and the
        // room_type_id fallback below keeps its grid working.
        listRatePlanRooms(propertyId).catch(() => []),
        // What the PMS says is free -- the number the channels are sent.
        // Optional: a failure here leaves the rate grid usable.
        start && end
          ? getAvailabilityGrid(propertyId, start, end).catch(() => null)
          : null,
      ]);

    // Keyed "<roomTypeId>|<date>", like the rate keys.
    const availability = {};
    for (const rt of availabilityGrid?.roomTypes || []) {
      for (const day of rt.days) {
        availability[`${rt.id}|${day.date}`] = {
          capacity: rt.capacity,
          sold: day.sold,
          free: day.free,
        };
      }
    }

    // Per-date restrictions, keyed "<ratePlanId>|<date>". A null field means
    // nothing is set for that date, so the plan's own value still applies --
    // the grid renders that as "inherit", not as a value of its own.
    const dailyRestrictions = {};
    for (const row of storedRestrictions) {
      dailyRestrictions[`${row.rate_plan_id}|${row.room_type_id || ""}|${row.stay_date}`] = {
        stopSell: row.stop_sell,
        minStay: row.min_stay,
        maxStay: row.max_stay,
        pushed: Boolean(row.pushed_at),
      };
    }

    // Stored rates win over the plan's base price, keyed the same way the
    // grid keys its cells.
    const dailyRates = {};
    for (const row of stored) {
      dailyRates[`${row.rate_plan_id}|${row.room_type_id || ""}|${row.occupancy}|${row.stay_date}`] = {
        rate: Number(row.rate),
        pushed: Boolean(row.pushed_at),
      };
    }

    // Partner codes, keyed by what they map.
    const codeByRoom = {};
    const codeByPlan = {};
    for (const row of integration?.codeMap || []) {
      if (row.rate_plan_id) {
        // Keyed by room too: the same plan carries a different partner code
        // in each room it is sold on.
        codeByPlan[
          `${row.room_type_id ?? ""}|${row.rate_plan_id}|${row.occupancy ?? 1}`
        ] = {
          code: row.partner_rateplan_code,
          extraAdult: row.extra_adult,
          meals: row.no_of_meals,
        };
      } else if (row.room_type_id) {
        codeByRoom[row.room_type_id] = row.partner_room_code;
      }
    }

    const assignmentFor = {};
    for (const a of assignments) {
      assignmentFor[`${a.rate_plan_id}|${a.room_type_id}`] = a;
    }
    const ownRateAt = gridOwnRateAt(assignments, roomTypes);
    const planById = Object.fromEntries(ratePlans.map((p) => [p.id, p]));
    const roomById = Object.fromEntries(roomTypes.map((r) => [r.id, r]));

    // Every room rate resolved once, adult by adult. A room rate can follow
    // its plan's master in the same room, or -- once unlocked in Rate Plan
    // Setup -- any other room rate, so resolution spans rooms rather than
    // running room by room.
    const resolver = roomRateResolver({ ratePlans, assignments, roomTypes, ownRateAt });

    // One row per rate plan per occupancy, matching how the partner models
    // rate plans and how the grid displays them.
    const rooms = roomTypes.map((room) => {
      // A plan is sold on the rooms assigned to it; plansForRoom holds the
      // fallback for a property that has not assigned any yet.
      const plans = plansForRoom(ratePlans, room.id, assignments);
      const baseAdults = resolver.baseAdultsOf(room.id);
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
          // Set when the room rate follows another: its cells are then worked
          // out from the source on each date and are not typed.
          derived: (() => {
            const src = resolver.sourceOf(p.id, room.id);
            if (src.manual) return null;
            return {
              planId: src.planId,
              roomId: src.roomId,
              // The room is named only when it is a different one.
              from:
                src.roomId === room.id
                  ? planById[src.planId]?.plan_name || "Plan"
                  : `${roomById[src.roomId]?.room_type_name || "Room"} / ${planById[src.planId]?.plan_name || "Plan"}`,
              rule: describeRule(src.method, src.value, src.value2),
            };
          })(),
          // A room rate may override its plan's defaults; NULL follows it.
          restrictions: {
            stopSell: Boolean(assignmentFor[`${p.id}|${room.id}`]?.stop_sell ?? p.stop_sell),
            minStay: assignmentFor[`${p.id}|${room.id}`]?.min_stay ?? p.min_stay ?? null,
            maxStay: assignmentFor[`${p.id}|${room.id}`]?.max_stay ?? p.max_stay ?? null,
          },
          resolvedRate: resolver.rate(p.id, room.id, baseAdults),
          occupancies: Array.from({ length: maxAdults }, (_, i) => i + 1).map(
            (occ) => ({
              occupancy: occ,
              // The rate a cell falls back to, which now varies by how many
              // adults the row is for.
              resolvedRate: resolver.rate(p.id, room.id, occ),
              partnerCode:
                codeByPlan[`${room.id}|${p.id}|${occ}`]?.code || null,
              extraAdult:
                codeByPlan[`${room.id}|${p.id}|${occ}`]?.extraAdult ?? null,
            })
          ),
        })),
      };
    });

    const unmapped = rooms.filter((r) => !r.partnerCode).length;

    return NextResponse.json({
      propertyId,
      rooms,
      dailyRates,
      dailyRestrictions,
      availability,
      connected: Boolean(integration?.integration?.enabled),
      hotelCode: integration?.integration?.hotel_code || null,
      unmappedRooms: unmapped,
      // What the browser needs to price a derived cell on a date, live as the
      // master's cell is typed into, through the same resolver as above.
      pricing: {
        ratePlans: ratePlans.map((p) => ({
          id: p.id,
          derive_from_id: p.derive_from_id,
          derive_method: p.derive_method,
          derive_value: p.derive_value,
          derive_value_2: p.derive_value_2 ?? null,
          min_rate: p.min_rate ?? null,
        })),
        assignments,
        roomTypes: roomTypes.map((r) => ({
          id: r.id,
          base_adults: r.base_adults,
          max_adults: r.max_adults,
          base_price: r.base_price,
        })),
      },
      ready: rooms.length > 0,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
