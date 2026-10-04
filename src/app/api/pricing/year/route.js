import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";
import {
  getAvailabilityGrid,
  getSoldCounts,
  getSupabaseAdmin,
  listDailyRestrictions,
} from "@/lib/database";
import { eventsForProperty } from "@/lib/events";
import { moduleDeniedResponse, resolvePropertyId } from "@/lib/propertyScope";
import { addDays, formatDateISO, parseDateISO, todayUTC } from "@/lib/date";

/**
 * How busy each day of the coming year looks, for the year strip on Dynamic
 * Pricing.
 *
 * Built only from what the hotel itself knows, never from market data:
 *  - days already past: the occupancy the hotel actually had;
 *  - days ahead: rooms sold so far, or the same weekday last year (364 days
 *    back) when that was fuller, since a far-off date is never full yet;
 *  - a high-impact event lifts a day by one level.
 * A day with nothing sold, no history and no event is "unknown" rather than
 * "low": a new hotel has not been quiet, it simply has no record yet.
 */

const LEVELS = [
  { id: "low", min: 0 },
  { id: "normal", min: 40 },
  { id: "good", min: 65 },
  { id: "high", min: 85 },
];

function levelFor(pct) {
  let out = LEVELS[0].id;
  for (const l of LEVELS) if (pct >= l.min) out = l.id;
  return out;
}

function bump(level) {
  const i = LEVELS.findIndex((l) => l.id === level);
  return LEVELS[Math.min(i + 1, LEVELS.length - 1)].id;
}

/** The first night this hotel ever sold, so "no bookings" can be told from "no record". */
async function firstSoldNight(propertyId) {
  const { data } = await getSupabaseAdmin()
    .from("reservation_nights")
    .select("stay_date, reservations!inner(property_id)")
    .eq("reservations.property_id", propertyId)
    .order("stay_date", { ascending: true })
    .limit(1);
  return data?.[0]?.stay_date || null;
}

export async function GET(req) {
  const session = await getSessionFromRequest(req);
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const denied = await moduleDeniedResponse(session, "pricing");
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const propertyId = await resolvePropertyId(session, searchParams.get("propertyId"));
  if (!propertyId) {
    return NextResponse.json({ error: "No property selected." }, { status: 403 });
  }

  // Twelve whole months from the first of this one.
  const today = todayUTC();
  const t = parseDateISO(today);
  const startDate = new Date(t.getFullYear(), t.getMonth(), 1);
  const endDate = new Date(t.getFullYear(), t.getMonth() + 12, 0);
  const start = formatDateISO(startDate);
  const end = formatDateISO(endDate);
  const lyStart = formatDateISO(addDays(startDate, -364));
  const lyEnd = formatDateISO(addDays(endDate, -364));

  let grid, lastYear, restrictions, events, firstNight;
  try {
    [grid, lastYear, restrictions, events, firstNight] = await Promise.all([
      getAvailabilityGrid(propertyId, start, end),
      getSoldCounts(propertyId, lyStart, lyEnd),
      listDailyRestrictions(propertyId, start, end).catch(() => []),
      eventsForProperty(propertyId, start, end).catch(() => []),
      firstSoldNight(propertyId),
    ]);
  } catch (err) {
    console.error("Year demand read failed:", err.message);
    return NextResponse.json({ error: "Could not load the year view." }, { status: 500 });
  }

  // Whole-hotel figures per date, net of out-of-order rooms.
  const capacity = grid.roomTypes.reduce((n, rt) => n + rt.capacity, 0);
  const byDate = {};
  for (const rt of grid.roomTypes) {
    for (const day of rt.days) {
      const h = (byDate[day.date] ||= { sold: 0, sellable: 0 });
      h.sold += day.sold;
      h.sellable += Math.max(0, rt.capacity - day.blocked);
    }
  }

  const lySoldByDate = {};
  for (const [key, n] of Object.entries(lastYear)) {
    const date = key.split("|")[1];
    lySoldByDate[date] = (lySoldByDate[date] || 0) + n;
  }

  const minStayDates = new Set(
    restrictions.filter((r) => Number(r.min_stay) > 1).map((r) => r.stay_date)
  );

  const highEventByDate = {};
  for (const e of events) {
    if (e.impact !== "high") continue;
    for (let d = parseDateISO(e.start_date); formatDateISO(d) <= e.end_date; d = addDays(d, 1)) {
      const iso = formatDateISO(d);
      if (iso >= start && iso <= end) (highEventByDate[iso] ||= []).push(e.name);
    }
  }

  const days = grid.dates.map((date) => {
    const h = byDate[date] || { sold: 0, sellable: 0 };
    const out = { date, minStay: minStayDates.has(date), events: highEventByDate[date] || [] };
    if (h.sellable <= 0) return { ...out, level: "closed" };

    const soldPct = Math.round((h.sold / h.sellable) * 100);
    out.soldPct = soldPct;

    if (date < today) return { ...out, basis: "actual", level: levelFor(soldPct) };

    const lyDate = formatDateISO(addDays(parseDateISO(date), -364));
    const hasHistory = firstNight != null && firstNight <= lyDate && capacity > 0;
    const lyPct = hasHistory ? Math.round(((lySoldByDate[lyDate] || 0) / capacity) * 100) : null;
    if (lyPct != null) out.lastYearPct = lyPct;

    if (h.sold === 0 && lyPct == null && out.events.length === 0) {
      return { ...out, level: "unknown" };
    }
    const basisPct = Math.max(soldPct, lyPct ?? 0);
    let level = levelFor(basisPct);
    if (out.events.length) level = bump(level);
    return { ...out, basis: lyPct != null && lyPct > soldPct ? "lastYear" : "sold", level };
  });

  // On the books per month: room nights sold out of room nights sellable.
  const months = {};
  for (const date of grid.dates) {
    const key = date.slice(0, 7);
    const h = byDate[date] || { sold: 0, sellable: 0 };
    const m = (months[key] ||= { sold: 0, sellable: 0 });
    m.sold += h.sold;
    m.sellable += h.sellable;
  }

  return NextResponse.json({
    today,
    start,
    end,
    days,
    months: Object.fromEntries(
      Object.entries(months).map(([k, m]) => [
        k,
        m.sellable > 0 ? Math.round((m.sold / m.sellable) * 100) : null,
      ])
    ),
  });
}
