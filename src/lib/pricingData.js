import { getSupabaseAdmin } from "@/lib/database";

/**
 * The facts the signals read.
 *
 * Gathered once for a whole window rather than per cell, because every source
 * here is one query for the entire date range and doing it per night would
 * turn a grid into hundreds of round trips.
 *
 * Anything absent comes back absent rather than zeroed: a signal must be able
 * to tell "no bookings" from "no data", since the first is a reason to drop
 * the rate and the second is a reason to stay quiet.
 */
export async function gatherPricingInputs(propertyId, startDate, endDate) {
  const supabase = getSupabaseAdmin();

  const [reservations, competitorRates, events] = await Promise.all([
    // Bookings touching the window, for occupancy and pickup.
    supabase
      .from('partner_reservations')
      .select('check_in, check_out, amount, action, received_at')
      .eq('property_id', propertyId)
      .gte('check_in', startDate)
      .lte('check_in', endDate)
      .then(({ data }) => data || []),

    // What the comp set is charging, from Competitor Shopper.
    supabase
      .from('competitor_rates')
      .select('stay_date, rate')
      .eq('property_id', propertyId)
      .gte('stay_date', startDate)
      .lte('stay_date', endDate)
      .then(({ data }) => data || []),

    // Events near the property that overlap the window.
    supabase
      .from('pricing_events')
      .select('*')
      .eq('property_id', propertyId)
      .lte('start_date', endDate)
      .gte('end_date', startDate)
      .then(({ data }) => data || [])
      // The table arrives in a later migration; until then there are simply
      // no events, which the signal treats as having nothing to say.
      .catch(() => []),
  ]);

  // Rooms sold per night, from bookings that were not cancelled.
  const soldByDate = {};
  const bookedAtByDate = {};
  for (const r of reservations) {
    if (r.action === 'cancel') continue;
    soldByDate[r.check_in] = (soldByDate[r.check_in] || 0) + 1;
    if (r.received_at) {
      (bookedAtByDate[r.check_in] ||= []).push(r.received_at);
    }
  }

  // Competitor median per night.
  const compByDate = {};
  for (const row of competitorRates) {
    if (row.rate == null) continue;
    (compByDate[row.stay_date] ||= []).push(Number(row.rate));
  }
  const competitorMedianByDate = {};
  for (const [date, rates] of Object.entries(compByDate)) {
    const sorted = rates.sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    competitorMedianByDate[date] =
      sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  // Events by the dates they cover.
  const eventsByDate = {};
  for (const e of events) {
    for (let d = new Date(e.start_date); d <= new Date(e.end_date); d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      (eventsByDate[key] ||= []).push(e);
    }
  }

  // Achieved ADR over the trailing 90 days, and on these dates a year ago.
  const [adr90, adrLastYearByDate] = await Promise.all([
    trailingAdr(supabase, propertyId, 90),
    lastYearAdrByDate(supabase, propertyId, startDate, endDate),
  ]);

  return {
    soldByDate,
    bookedAtByDate,
    competitorMedianByDate,
    eventsByDate,
    adr90,
    adrLastYearByDate,
  };
}

/** Average achieved rate over the trailing N days. Null when nothing sold. */
async function trailingAdr(supabase, propertyId, days) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data } = await supabase
    .from('partner_reservations')
    .select('amount, action')
    .eq('property_id', propertyId)
    .gte('check_in', since.toISOString().slice(0, 10))
    .lte('check_in', new Date().toISOString().slice(0, 10));

  const amounts = (data || [])
    .filter((r) => r.action !== 'cancel' && r.amount != null)
    .map((r) => Number(r.amount));

  if (amounts.length === 0) return null;
  return amounts.reduce((a, b) => a + b, 0) / amounts.length;
}

/** What each date in the window achieved on the same date last year. */
async function lastYearAdrByDate(supabase, propertyId, startDate, endDate) {
  const shift = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  };

  const { data } = await supabase
    .from('partner_reservations')
    .select('check_in, amount, action')
    .eq('property_id', propertyId)
    .gte('check_in', shift(startDate))
    .lte('check_in', shift(endDate));

  const byDate = {};
  for (const r of data || []) {
    if (r.action === 'cancel' || r.amount == null) continue;
    (byDate[r.check_in] ||= []).push(Number(r.amount));
  }

  // Keyed forward onto this year's dates, so callers look up the date they
  // are pricing rather than doing the arithmetic themselves.
  const out = {};
  for (const [lastYear, amounts] of Object.entries(byDate)) {
    const d = new Date(`${lastYear}T00:00:00`);
    d.setFullYear(d.getFullYear() + 1);
    out[d.toISOString().slice(0, 10)] =
      amounts.reduce((a, b) => a + b, 0) / amounts.length;
  }
  return out;
}

/**
 * Bookings taken in the last week for a night, and what is normal.
 *
 * "Normal" is the property's own average weekly pickup across the window
 * rather than an industry figure, so a quiet hotel is not told it is
 * underperforming against someone else's curve.
 */
export function pickupFor(date, bookedAtByDate, windowDates) {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const recent = (bookedAtByDate[date] || []).filter((at) => new Date(at) >= weekAgo).length;

  let total = 0;
  let nights = 0;
  for (const d of windowDates) {
    const stamps = bookedAtByDate[d];
    if (!stamps) continue;
    total += stamps.filter((at) => new Date(at) >= weekAgo).length;
    nights += 1;
  }

  // Without a baseline there is nothing to compare against, so the signal
  // stays silent rather than inventing one.
  if (nights === 0) return { recentBookings: null, expectedBookings: null };
  return { recentBookings: recent, expectedBookings: total / nights };
}
