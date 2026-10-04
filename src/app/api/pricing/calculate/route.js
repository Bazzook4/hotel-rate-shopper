import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import {
  listRoomTypes,
  listPricingBounds,
  getPricingStrategy,
  savePricingRecommendations,
  listDailyRates,
  listPricingRecommendations,
} from "@/lib/database";
import { resolvePropertyId } from "@/lib/propertyScope";
import {
  gatherPricingInputs,
  pickupFor,
  occupancyPctFor,
  paceFor,
  gapNightsFor,
} from "@/lib/pricingData";
import { resolveScales, rulesFor, longestGapRule } from "@/lib/pricingScales";
import { effectiveBounds, resolveWeights } from "@/lib/pricingStrategy";
import {
  compsetSignal,
  occupancySignal,
  weekdaySignal,
  pickupSignal,
  paceSignal,
  adr90Signal,
  adrLastYearSignal,
  eventsSignal,
  recommendRate,
} from "@/lib/pricingSignals";
import { addDays, clampToToday, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";
import { moduleDeniedResponse } from "@/lib/propertyScope";

const DEFAULT_DAYS = 14;
const MAX_DAYS = 60;

const near = (a, b) => a > 0 && b > 0 && Math.abs(a - b) <= Math.max(1, b * 0.01);

/**
 * How much of a night's live rate is already the hotelier's rules.
 *
 * Rules are relative to the rate the signals produce, not to whatever is
 * live: "-10% close to arrival" means ten below normal, not ten more every
 * time pricing runs. So a rule-shaped rate that was applied, and has not
 * been changed by hand since, has its rules taken out before they are put
 * back. The carried amount is passed forward on every run until the rate
 * changes, so recalculating twice does not lose track of it.
 */
function carriedRulePct(prev, currentRate) {
  if (!prev) return 0;
  if (["accepted", "applied"].includes(prev.status) && near(Number(prev.recommended_rate), currentRate)) {
    return Number(prev.rule_pct) || 0;
  }
  if (near(Number(prev.current_rate), currentRate)) return Number(prev.carried_pct) || 0;
  return 0;
}

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
  const denied = await moduleDeniedResponse(session, "pricing");
  if (denied) return denied;

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
  let previous;
  try {
    strategy = await getPricingStrategy(propertyId);
    [roomTypes, bounds, inputs, dailyRates, previous] = await Promise.all([
      listRoomTypes(propertyId),
      listPricingBounds(propertyId),
      gatherPricingInputs(propertyId, startISO, endISO, {
        gapReach: longestGapRule(strategy.adjustments),
      }),
      listDailyRates(propertyId, startISO, endISO).catch(() => []),
      listPricingRecommendations(propertyId, startISO, endISO).catch(() => []),
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
      { error: "Add your room types under Setup → Rooms before running pricing.", needsSetup: true },
      { status: 409 }
    );
  }

  const boundsByRoom = new Map(bounds.map((b) => [b.room_type_id, b]));
  // Auto unless the hotelier chose to tune them: history-based signals earn
  // their weight as the property's own bookings accumulate.
  const weights = resolveWeights(strategy, inputs.maturity);
  const scales = resolveScales(strategy.scales);
  const today = todayUTC();
  const prevByCell = new Map(previous.map((p) => [`${p.room_type_id}|${p.stay_date}`, p]));

  // The rate a night currently carries: a per-date override where one exists,
  // otherwise the room's own base price. A recommendation is written to every
  // occupancy as a share of the full-occupancy rate, so that is the one read
  // back -- a single-adult rate would look like a cut nobody made.
  const overrideByCell = {};
  const occByCell = {};
  for (const row of dailyRates || []) {
    if (row.rate == null) continue;
    const key = `${row.room_type_id}|${row.stay_date}`;
    const occ = Number(row.occupancy) || 0;
    if (occByCell[key] == null || occ > occByCell[key]) {
      occByCell[key] = occ;
      overrideByCell[key] = Number(row.rate);
    }
  }

  const rows = [];
  for (const room of roomTypes) {
    for (const date of dates) {
      const currentRate =
        overrideByCell[`${room.id}|${date}`] ??
        (room.base_price != null ? Number(room.base_price) : null);
      if (!currentRate) continue;

      // Signals and rules work from the rate without last run's rules in it.
      const carried = carriedRulePct(prevByCell.get(`${room.id}|${date}`), currentRate);
      const baseRate = carried ? currentRate / (1 + carried / 100) : currentRate;
      const daysOut = Math.round((parseDateISO(date) - parseDateISO(today)) / 86400000);

      const { recentBookings, expectedBookings } = pickupFor(date, inputs.pickup, dates);

      const signals = {
        compset: compsetSignal({
          currentRate: baseRate,
          competitorMedian: inputs.competitorMedianByDate[date],
        }),
        occupancy: occupancySignal({
          occupancyPct: occupancyPctFor(room.id, date, inputs),
          daysOut,
          scale: scales.occupancy,
        }),
        weekday: weekdaySignal({ stayDate: date, scale: scales.weekday }),
        pickup: pickupSignal({ recentBookings, expectedBookings, scale: scales.pickup }),
        pace: paceSignal({ ...paceFor(date, inputs), scale: scales.pace }),
        adr_90: adr90Signal({
          currentRate: baseRate,
          adr90: inputs.adr90ByRoom[room.id],
          scale: scales.adr_90,
        }),
        adr_ly: adrLastYearSignal({
          adr90: inputs.adr90ByRoom[room.id],
          adrLastYearSameDate: inputs.adrLastYearByCell[`${room.id}|${date}`],
          scale: scales.adr_ly,
        }),
        events: eventsSignal({ events: inputs.eventsByDate[date] }),
      };

      const rules = rulesFor({
        adjustments: strategy.adjustments,
        daysOut,
        gapNights: gapNightsFor(room.id, date, inputs, today),
        rate: baseRate,
      });

      const result = recommendRate({
        currentRate: baseRate,
        signals,
        weights,
        maxChangePct: Number(strategy.max_change_pct),
        bounds: effectiveBounds(room, boundsByRoom.get(room.id), strategy),
        rules,
      });

      if (result.rate == null) continue;

      if (carried) {
        result.reasons.unshift({
          signal: null,
          note: `Your rate already had ${carried > 0 ? "+" : ""}${Math.round(carried * 10) / 10}% from your rules; that is replaced, not added again`,
        });
      }

      rows.push({
        room_type_id: room.id,
        stay_date: date,
        current_rate: currentRate,
        recommended_rate: result.rate,
        reasons: result.reasons,
        bounded_by: result.bounded_by,
        rule_pct: result.rule_pct,
        carried_pct: carried,
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
      if (reason.signal && reason.signal !== "rule") active.add(reason.signal);
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
