import { getSupabaseAdmin, getAvailabilityGrid } from "@/lib/database";
import { addDays, formatDateISO, parseDateISO } from "@/lib/date";
import { eventsForProperty, toPricingEvent } from "@/lib/events";

/**
 * The facts the signals read.
 *
 * Gathered once for a whole window rather than per cell, because every source
 * here is one query for the entire date range and doing it per night would
 * turn a grid into hundreds of round trips.
 *
 * Everything about the hotel itself comes from the PMS -- `reservation_nights`
 * -- not from the raw channel bookings in `partner_reservations`. The PMS
 * counts every night of a stay and every room of a booking, carries the
 * actual nightly rate, and includes walk-ins and direct bookings the channel
 * manager never saw.
 *
 * Anything absent comes back absent rather than zeroed: a signal must be able
 * to tell "no bookings" from "no data", since the first is a reason to drop
 * the rate and the second is a reason to stay quiet.
 */

/** Statuses that are real, paid demand. Inquiries hold a room but are not sold. */
const SOLD_STATUSES = ["confirmed", "in_house", "checked_out"];

/** A competitor's rate older than this says little about tonight's market. */
const COMPSET_FRESH_HOURS = 48;
/** Fewer competitors than this and the "median" is one hotel's opinion. */
const COMPSET_MIN_HOTELS = 3;

const PAGE = 1000;

export async function gatherPricingInputs(propertyId, startDate, endDate) {
  const supabase = getSupabaseAdmin();

  const [grid, pickup, history, competitorRates, events] = await Promise.all([
    getAvailabilityGrid(propertyId, startDate, endDate),
    recentPickup(supabase, propertyId, startDate, endDate),
    nightlyHistory(supabase, propertyId, startDate, endDate),

    // Only the like-for-like search (one night, two guests) and only what was
    // checked recently -- a partial or week-old scrape must not vote.
    supabase
      .from("competitor_rates")
      .select("competitor_id, stay_date, rate, sold_out, checked_at")
      .eq("property_id", propertyId)
      .eq("nights", 1)
      .eq("guests", 2)
      .gte("stay_date", startDate)
      .lte("stay_date", endDate)
      .gte("checked_at", new Date(Date.now() - COMPSET_FRESH_HOURS * 3600 * 1000).toISOString())
      .then(({ data }) => data || []),

    // The events this hotel's calendar shows: its own, and the public ones
    // its profile matches. A failure here means no events, which the signal
    // treats as having nothing to say, rather than no prices at all.
    eventsForProperty(propertyId, startDate, endDate)
      .then((rows) => rows.map(toPricingEvent))
      .catch(() => []),
  ]);

  // Occupancy per room type and for the whole hotel, net of out-of-order
  // rooms: a room that cannot be sold is not a room left to sell.
  const occupancyByCell = {};
  const hotelByDate = {};
  for (const rt of grid.roomTypes) {
    for (const day of rt.days) {
      const sellable = rt.capacity - day.blocked;
      if (sellable > 0) occupancyByCell[`${rt.id}|${day.date}`] = { sold: day.sold, sellable };
      const h = (hotelByDate[day.date] ||= { sold: 0, sellable: 0 });
      h.sold += day.sold;
      h.sellable += Math.max(0, sellable);
    }
  }

  // Competitor median per night, only where enough hotels were seen.
  const compByDate = {};
  for (const row of competitorRates) {
    if (row.rate == null || row.sold_out) continue;
    (compByDate[row.stay_date] ||= new Map()).set(row.competitor_id, Number(row.rate));
  }
  const competitorMedianByDate = {};
  for (const [date, byHotel] of Object.entries(compByDate)) {
    if (byHotel.size < COMPSET_MIN_HOTELS) continue;
    competitorMedianByDate[date] = median([...byHotel.values()]);
  }

  // Events by the dates they cover.
  const eventsByDate = {};
  for (const e of events) {
    for (let d = parseDateISO(e.start_date); formatDateISO(d) <= e.end_date; d = addDays(d, 1)) {
      (eventsByDate[formatDateISO(d)] ||= []).push(e);
    }
  }

  return {
    occupancyByCell,
    hotelByDate,
    pickup,
    competitorMedianByDate,
    eventsByDate,
    adr90ByRoom: history.adr90ByRoom,
    adrLastYearByCell: history.adrLastYearByCell,
    maturity: {
      pickupBookings: pickup.baselineBookings,
      nights90: history.nights90,
      nightsLastYear: history.nightsLastYear,
    },
  };
}

/**
 * How full a room type is for a night, as a percentage.
 *
 * Half the room type, half the hotel. A room type of two rooms reads 50% on
 * one booking, which is true of that type but says little about demand; the
 * hotel figure steadies it, while the type figure still lifts the last
 * rooms of a type that is selling out ahead of the rest.
 */
export function occupancyPctFor(roomTypeId, date, inputs) {
  const cell = inputs.occupancyByCell[`${roomTypeId}|${date}`];
  const hotel = inputs.hotelByDate[date];
  if (!cell || !hotel || hotel.sellable <= 0) return null;
  const typePct = (cell.sold / cell.sellable) * 100;
  const hotelPct = (hotel.sold / hotel.sellable) * 100;
  return (typePct + hotelPct) / 2;
}

/**
 * Room-nights booked in the last week for each night of the window.
 *
 * Read from when the reservation was created, which for an OTA booking is
 * the moment it was adopted -- automatic since the webhook, so within
 * seconds of the guest booking.
 */
async function recentPickup(supabase, propertyId, startDate, endDate) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const byDate = {};

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("reservation_nights")
      .select("reservation_id, stay_date, reservations!inner(property_id, status, created_at)")
      .eq("reservations.property_id", propertyId)
      .in("reservations.status", SOLD_STATUSES)
      .gte("reservations.created_at", weekAgo)
      .gte("stay_date", startDate)
      .lte("stay_date", endDate)
      .order("reservation_id")
      .order("stay_date")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Failed to load pickup: ${error.message}`);

    for (const row of data || []) byDate[row.stay_date] = (byDate[row.stay_date] || 0) + 1;
    if (!data || data.length < PAGE) break;
  }

  const baselineBookings = Object.values(byDate).reduce((a, b) => a + b, 0);
  return { byDate, baselineBookings };
}

/**
 * A night's pickup against the window's usual pace.
 *
 * "Usual" is the property's own average across every night in the window,
 * nights with nothing included -- leaving them out would make a quiet hotel's
 * one busy night look ordinary. Silent until there is enough to average.
 */
export function pickupFor(date, pickup, windowDates) {
  if (!pickup || pickup.baselineBookings < 3 || windowDates.length === 0) {
    return { recentBookings: null, expectedBookings: null };
  }
  return {
    recentBookings: pickup.byDate[date] || 0,
    expectedBookings: pickup.baselineBookings / windowDates.length,
  };
}

/**
 * What each room type actually sold at: over the last 90 days, and on the
 * window's nights a year ago.
 *
 * Nightly rates, never booking totals -- a week-long stay is seven nights at
 * its rate, not one night at seven times it. Zero-rated nights are left out,
 * which is what a complimentary stay is.
 *
 * Last year is 364 days back rather than the same calendar date, so a
 * Saturday is compared with a Saturday.
 */
async function nightlyHistory(supabase, propertyId, startDate, endDate) {
  const today = new Date();
  const since90 = formatDateISO(addDays(today, -90));
  const yesterday = formatDateISO(addDays(today, -1));
  const lyStart = formatDateISO(addDays(parseDateISO(startDate), -364));
  const lyEnd = formatDateISO(addDays(parseDateISO(endDate), -364));

  const [recent, lastYear] = await Promise.all([
    soldNights(supabase, propertyId, since90, yesterday),
    soldNights(supabase, propertyId, lyStart, lyEnd),
  ]);

  const adr90ByRoom = averageBy(recent, (n) => n.room_type_id);

  const adrLastYearByCell = {};
  for (const [key, avg] of Object.entries(
    averageBy(lastYear, (n) => `${n.room_type_id}|${n.stay_date}`)
  )) {
    const [roomTypeId, date] = key.split("|");
    adrLastYearByCell[`${roomTypeId}|${formatDateISO(addDays(parseDateISO(date), 364))}`] = avg;
  }

  return {
    adr90ByRoom,
    adrLastYearByCell,
    nights90: recent.length,
    nightsLastYear: lastYear.length,
  };
}

async function soldNights(supabase, propertyId, startDate, endDate) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("reservation_nights")
      .select("reservation_id, stay_date, room_type_id, rate, reservations!inner(property_id, status)")
      .eq("reservations.property_id", propertyId)
      .in("reservations.status", SOLD_STATUSES)
      .gt("rate", 0)
      .gte("stay_date", startDate)
      .lte("stay_date", endDate)
      .order("reservation_id")
      .order("stay_date")
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`Failed to load booking history: ${error.message}`);

    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function averageBy(nights, keyOf) {
  const sums = {};
  for (const n of nights) {
    const k = keyOf(n);
    const s = (sums[k] ||= { total: 0, count: 0 });
    s.total += Number(n.rate);
    s.count += 1;
  }
  return Object.fromEntries(Object.entries(sums).map(([k, s]) => [k, s.total / s.count]));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
