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
} from "@/lib/database";
import { resolveAllRates, plansForRoom } from "@/lib/ratePlanPricing";
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
      ]);

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

    // Which rooms each plan is sold on, and at what rate, from the room
    // assignments. Keyed "<planId>|<roomId>".
    const assignedRate = {};
    const assignmentFor = {};
    for (const a of assignments) {
      assignedRate[`${a.rate_plan_id}|${a.room_type_id}`] = a.full_rate;
      assignmentFor[`${a.rate_plan_id}|${a.room_type_id}`] = a;
    }

    /**
     * What a plan costs in a room for a given number of adults.
     *
     * The assigned full rate covers included_occupancy adults; each adult
     * beyond that adds extra_adult_rate. Fewer adults than included are not
     * discounted, since the rate is for the room.
     */
    const rateForOccupancy = (planId, roomId, base, occupancy) => {
      const a = assignmentFor[`${planId}|${roomId}`];
      const room = roomById[roomId];
      const baseAdults = Math.max(1, Number(room?.base_adults) || 0);

      // Within base occupancy the rate is set per adult, since a single and a
      // double are different prices rather than the same room half-empty.
      const perAdult = a?.adult_rates || null;
      if (perAdult && occupancy <= baseAdults) {
        const own = Number(perAdult[occupancy] ?? perAdult[String(occupancy)]);
        if (Number.isFinite(own)) return own;
      }

      if (base === null || base === undefined) return null;

      // Beyond base occupancy, each further adult adds the extra person rate
      // on top of the base-occupancy rate.
      const atBase = perAdult
        ? Number(perAdult[baseAdults] ?? perAdult[String(baseAdults)] ?? base)
        : base;
      const extra = Number(a?.extra_adult_rate);
      if (!Number.isFinite(extra) || !Number.isFinite(atBase)) return base;
      return atBase + Math.max(0, occupancy - baseAdults) * extra;
    };

    const roomById = Object.fromEntries(roomTypes.map((r) => [r.id, r]));

    /**
     * A plan's own rate in one room.
     *
     * The assignment wins; a plan with none falls back to the room's base
     * price, so a property that has not assigned rooms yet keeps working.
     */
    const baseRateFor = (plan, roomId) => {
      const assigned = assignedRate[`${plan.id}|${roomId}`];
      if (assigned !== undefined && assigned !== null) return Number(assigned);
      const room = roomById[roomId];
      return room ? Number(room.base_price) : null;
    };

    // One row per rate plan per occupancy, matching how the partner models
    // rate plans and how the grid displays them.
    const rooms = roomTypes.map((room) => {
      // A plan is sold on the rooms assigned to it; plansForRoom holds the
      // fallback for a property that has not assigned any yet.
      const plans = plansForRoom(ratePlans, room.id, assignments);

      // Rates resolve per room, since the same plan can cost differently in
      // each, and a derived plan must follow its master's rate in THIS room.
      const baseRates = {};
      for (const p of ratePlans) baseRates[p.id] = baseRateFor(p, room.id);
      const resolved = resolveAllRates(ratePlans, baseRates);
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
              // The rate a cell falls back to, which now varies by how many
              // adults the row is for.
              resolvedRate: rateForOccupancy(p.id, room.id, resolved[p.id], occ),
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
      connected: Boolean(integration?.integration?.enabled),
      hotelCode: integration?.integration?.hotel_code || null,
      unmappedRooms: unmapped,
      ready: rooms.length > 0,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
