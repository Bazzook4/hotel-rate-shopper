import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import {
  listRoomTypes,
  listPricingBounds,
  getPricingStrategy,
  savePricingRecommendations,
  listDailyRates,
} from "@/lib/database";
import { resolvePropertyId } from "@/lib/propertyScope";
import { gatherPricingInputs, pickupFor } from "@/lib/pricingData";
import {
  compsetSignal,
  occupancySignal,
  weekdaySignal,
  pickupSignal,
  adr90Signal,
  adrLastYearSignal,
  eventsSignal,
  recommendRate,
} from "@/lib/pricingSignals";
import { addDays, clampToToday, formatDateISO, parseDateISO } from "@/lib/date";

const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;

/**
 * Work out what every room type should charge across a window.
 *
 * Reads only our own stored data -- no outside calls -- so it is fast and
 * free to re-run, and a hotelier can recalculate as often as they like after
 * changing weights or bounds.
 */
export async function POST(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const propertyId = await resolvePropertyId(session, body?.propertyId);
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected." }, { status: 403 });
  }

  // Pricing a night that has already begun is meaningless.
  const start = parseDateISO(clampToToday(body?.start)) || new Date();
  const days = Math.min(Math.max(Number(body?.days) || DEFAULT_DAYS, 1), MAX_DAYS);
  const startISO = formatDateISO(start);
  const endISO = formatDateISO(addDays(start, days - 1));
  const dates = Array.from({ length: days }, (_, i) => formatDateISO(addDays(start, i)));

  let roomTypes;
  let bounds;
  let strategy;
  let inputs;
  let dailyRates;
  try {
    [roomTypes, bounds, strategy, inputs, dailyRates] = await Promise.all([
      listRoomTypes(propertyId),
      listPricingBounds(propertyId),
      getPricingStrategy(propertyId),
      gatherPricingInputs(propertyId, startISO, endISO),
      listDailyRates(propertyId, startISO, endISO).catch(() => []),
    ]);
  } catch (err) {
    console.error("Pricing calculate failed to load inputs:", err.message);
    return NextResponse.json(
      { error: "Could not load the data pricing needs. Please try again." },
      { status: 500 }
    );
  }

  if (roomTypes.length === 0) {
    return NextResponse.json(
      { error: "Add your room types in Room Setup before running pricing.", needsSetup: true },
      { status: 409 }
    );
  }

  const boundsByRoom = new Map(bounds.map((b) => [b.room_type_id, b]));
  const weights = {
    compset: Number(strategy.weight_compset),
    occupancy: Number(strategy.weight_occupancy),
    weekday: Number(strategy.weight_weekday),
    pickup: Number(strategy.weight_pickup),
    adr_90: Number(strategy.weight_adr_90),
    adr_ly: Number(strategy.weight_adr_ly),
    events: Number(strategy.weight_events),
  };

  // The rate a night currently carries: a per-date override where one exists,
  // otherwise the room's own base price.
  const overrideByCell = {};
  for (const row of dailyRates || []) {
    if (row.rate == null) continue;
    overrideByCell[`${row.room_type_id}|${row.stay_date}`] = Number(row.rate);
  }

  const rows = [];
  for (const room of roomTypes) {
    for (const date of dates) {
      const currentRate =
        overrideByCell[`${room.id}|${date}`] ??
        (room.base_price != null ? Number(room.base_price) : null);
      if (!currentRate) continue;

      const { recentBookings, expectedBookings } = pickupFor(date, inputs.bookedAtByDate, dates);

      const signals = {
        compset: compsetSignal({
          currentRate,
          competitorMedian: inputs.competitorMedianByDate[date],
        }),
        occupancy: occupancySignal({
          soldRooms: inputs.soldByDate[date] ?? null,
          totalRooms: room.number_of_rooms,
        }),
        weekday: weekdaySignal({ stayDate: date }),
        pickup: pickupSignal({ recentBookings, expectedBookings }),
        adr_90: adr90Signal({ currentRate, adr90: inputs.adr90 }),
        adr_ly: adrLastYearSignal({
          adr90: inputs.adr90,
          adrLastYearSameDate: inputs.adrLastYearByDate[date],
        }),
        events: eventsSignal({ events: inputs.eventsByDate[date] }),
      };

      const result = recommendRate({
        currentRate,
        signals,
        weights,
        maxChangePct: Number(strategy.max_change_pct),
        bounds: boundsByRoom.get(room.id),
      });

      if (result.rate == null) continue;

      rows.push({
        room_type_id: room.id,
        stay_date: date,
        current_rate: currentRate,
        recommended_rate: result.rate,
        reasons: result.reasons,
        bounded_by: result.bounded_by,
      });
    }
  }

  try {
    await savePricingRecommendations(propertyId, rows);
  } catch (err) {
    console.error("Saving recommendations failed:", err.message);
    return NextResponse.json({ error: "Could not save the recommendations." }, { status: 500 });
  }

  // Which signals actually had data, so the page can say what it is pricing
  // on rather than implying all seven are informed.
  const active = new Set();
  for (const row of rows) {
    for (const reason of row.reasons || []) {
      if (reason.signal) active.add(reason.signal);
    }
  }

  return NextResponse.json({
    calculated: rows.length,
    start: startISO,
    end: endISO,
    roomTypes: roomTypes.length,
    activeSignals: [...active],
    calculatedAt: new Date().toISOString(),
  });
}
