import { getSupabaseAdmin, listRoomTypes, listRooms, nightsBetween } from '@/lib/database';
import { addDays, formatDateISO, parseDateISO } from '@/lib/date';
import { countryName } from '@/lib/countries';

/**
 * Booking performance: what the PMS's reservations add up to over a period.
 *
 * Everything here is computed on read from `reservations`, their
 * `reservation_nights` and their folio extras -- nothing is stored. A stored
 * daily summary would have to be rebuilt every time a stay is moved, repriced
 * or cancelled, and the day it wasn't, the report would quietly disagree with
 * the tape chart.
 *
 * A period is read one of two ways, as the hotelier chooses:
 *
 *   stay     the nights that fall inside the period, whenever booked. This is
 *            what the hotel actually sold on those dates -- occupancy, ADR.
 *   booked   the reservations made inside the period, whole stays, whenever
 *            they stay. This is how well the hotel sold on those days -- pace.
 *
 * Every headline figure is also worked out for a comparison period -- the
 * same dates a year earlier by default, the period of equal length just
 * before, or dates the hotelier picks -- so each can be shown against it.
 */

const PAGE = 1000;
const ID_CHUNK = 150;

/** Statuses that released the room rather than used it. */
const RELEASED = new Set(['cancelled', 'no_show']);

const METHOD_LABELS = {
  direct: 'Direct',
  walkin: 'Walk-in',
  phone: 'Phone',
  email: 'Email',
  website: 'Website',
  corporate: 'Corporate',
  travel_agent: 'Travel agent',
  ota: 'OTA (entered by hand)',
  group: 'Group',
};

/**
 * The ways the mix can be cut. "Source" is the guest's country -- the source
 * market, in hotel terms -- and "method" is how the booking reached the desk
 * (walk-in, phone, website), which is what the source field on a reservation
 * records.
 */
export const DIMENSIONS = ['channel', 'source', 'roomType', 'ratePlan', 'method'];

/** Whole days from one ISO date to another. */
function daysBetween(from, to) {
  return Math.round((parseDateISO(to) - parseDateISO(from)) / 86400000);
}

function shift(iso, days) {
  return formatDateISO(addDays(iso, days));
}

function notMigrated(error) {
  return ['PGRST205', 'PGRST200', '42P01', '42703'].includes(error?.code);
}

/** Every row a query matches, in pages -- PostgREST stops at 1000 silently. */
async function readAll(build, what) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build().range(offset, offset + PAGE - 1);
    if (error) {
      const err = new Error(`Failed to load ${what}: ${error.message}`);
      err.code = error.code;
      throw err;
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Split ids into chunks small enough to go in a URL as an `in` filter. */
function chunks(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(ids.slice(i, i + ID_CHUNK));
  return out;
}

/**
 * Where a booking reached the hotel through.
 *
 * A booking the channel manager delivered carries the channel's own name as
 * its source, and that name is the channel. Everything the desk entered
 * itself came direct, however it arrived -- phone, walk-in, website -- which
 * is the split a channel-mix report is for; the finer "how" is the booking
 * method breakdown.
 */
function channelOf(r) {
  if (r.partner_booking_id) return r.source || 'OTA';
  if (r.source === 'ota') return 'OTA (entered by hand)';
  return 'Direct';
}

function methodOf(r) {
  return METHOD_LABELS[r.source] || r.source || 'Unknown';
}

/**
 * Load everything the report needs for [fromDate, toDate], both inclusive.
 *
 * Called once for the period and once for what it is compared with. They are
 * read separately rather than as one span covering both: a year-ago
 * comparison would otherwise drag in the whole year between them.
 */
async function loadFacts(propertyId, fromDate, toDate, basis) {
  const supabase = getSupabaseAdmin();

  // Stay basis: every stay with a night inside the window, including
  // cancelled ones -- a cancellation keeps its nights, only its status
  // changes, which is what lets it be counted against the dates it gave up.
  // Booked basis: every reservation made inside the window. `created_at` is
  // when the reservation reached the PMS, and OTA bookings are adopted the
  // moment their webhook arrives, so it stands in for the booking date.
  const reservations = await readAll(() => {
    let q = supabase
      .from('reservations')
      .select('*')
      .eq('property_id', propertyId)
      // An inquiry holds a room but is not yet business; it is counted once
      // it is confirmed.
      .neq('status', 'inquiry');
    q =
      basis === 'booked'
        ? q.gte('created_at', `${fromDate}T00:00:00Z`).lt('created_at', `${shift(toDate, 1)}T00:00:00Z`)
        : q.lte('check_in', toDate).gt('check_out', fromDate);
    return q.order('id');
  }, 'reservations');

  const ids = reservations.map((r) => r.id);

  const nightRows = [];
  const extraRows = [];
  await Promise.all(
    chunks(ids).map(async (chunk) => {
      const nights = await readAll(() => {
        let q = supabase
          .from('reservation_nights')
          .select('reservation_id, stay_date, rate')
          .in('reservation_id', chunk);
        if (basis === 'stay') q = q.gte('stay_date', fromDate).lte('stay_date', toDate);
        return q.order('reservation_id').order('stay_date');
      }, 'nights');
      nightRows.push(...nights);

      // Extras are the folio beyond the room: food, transfers. A property
      // that has not run the folio migration simply has none.
      try {
        const extras = await readAll(
          () =>
            supabase
              .from('reservation_extras')
              .select('id, reservation_id, unit_price, quantity, stay_date')
              .in('reservation_id', chunk)
              .order('id'),
          'extras'
        );
        extraRows.push(...extras);
      } catch (err) {
        if (!notMigrated(err)) throw err;
      }
    })
  );

  return { reservations, nightRows, extraRows };
}

/**
 * Shape raw rows into one record per reservation, each carrying the nights
 * and the money it contributes.
 */
function buildStays(facts, names) {
  const nightsBy = new Map();
  for (const n of facts.nightRows) {
    if (!nightsBy.has(n.reservation_id)) nightsBy.set(n.reservation_id, []);
    nightsBy.get(n.reservation_id).push(n);
  }
  const extrasBy = new Map();
  for (const e of facts.extraRows) {
    if (!extrasBy.has(e.reservation_id)) extrasBy.set(e.reservation_id, []);
    extrasBy.get(e.reservation_id).push(e);
  }

  return facts.reservations.map((r) => {
    const los = Math.max(1, daysBetween(r.check_in, r.check_out));
    const comp = r.booking_type === 'complimentary';
    const total = Number(r.total_amount) || 0;
    // A night with no rate of its own -- an OTA total that was never broken
    // down -- takes an even share of the stay's total, so the stay's money
    // still lands on the dates it was for.
    const evenShare = total / los;
    const nights = (nightsBy.get(r.id) || []).map((n) => ({
      date: n.stay_date,
      value: comp ? 0 : n.rate != null ? Number(n.rate) : evenShare,
    }));

    const created = String(r.created_at || '').slice(0, 10) || r.check_in;
    return {
      id: r.id,
      status: r.status,
      released: RELEASED.has(r.status),
      cancelled: r.status === 'cancelled',
      noShow: r.status === 'no_show',
      comp,
      checkIn: r.check_in,
      created,
      los,
      // A booking entered after the guest had already arrived would come out
      // negative; for lead time it was simply booked on the day.
      lead: Math.max(0, daysBetween(created, r.check_in)),
      total: comp ? 0 : total,
      nights,
      extras: (extrasBy.get(r.id) || []).map((e) => ({
        date: e.stay_date,
        value: (Number(e.unit_price) || 0) * (Number(e.quantity) || 0),
      })),
      keys: {
        channel: channelOf(r),
        source: r.guest_country ? countryName(r.guest_country) : 'Not recorded',
        method: methodOf(r),
        roomType: names.roomTypes[r.room_type_id] || 'Unknown room type',
        ratePlan: r.rate_plan_id ? names.ratePlans[r.rate_plan_id] || 'Deleted rate plan' : 'No rate plan',
      },
    };
  });
}

/**
 * The part of each stay that belongs to [start, end].
 *
 * On the stay basis that is its nights inside the dates, and extras dated
 * inside them (an undated extra goes with the arrival). On the booked basis a
 * reservation made in the period brings its whole stay.
 */
function slice(stays, start, end, basis) {
  const inRange = (d) => d >= start && d <= end;
  const out = [];
  for (const s of stays) {
    if (basis === 'booked') {
      if (!inRange(s.created)) continue;
      out.push({
        stay: s,
        nights: s.nights,
        extras: s.extras,
        bucketDate: s.created,
      });
    } else {
      const nights = s.nights.filter((n) => inRange(n.date));
      if (nights.length === 0) continue;
      const extras = s.extras.filter((e) => inRange(e.date || s.checkIn));
      out.push({ stay: s, nights, extras, bucketDate: null });
    }
  }
  return out;
}

/** The headline figures for a set of sliced stays. */
function measure(parts, { roomNightsAvailable = null } = {}) {
  let roomNights = 0;
  let compNights = 0;
  let roomRevenue = 0;
  let otherRevenue = 0;
  let reservations = 0;
  let losSum = 0;
  let leadSum = 0;
  let cancellations = 0;
  let noShows = 0;
  let lostRevenue = 0;

  for (const p of parts) {
    const s = p.stay;
    const value = p.nights.reduce((sum, n) => sum + n.value, 0);
    if (s.released) {
      if (s.cancelled) cancellations += 1;
      if (s.noShow) noShows += 1;
      lostRevenue += value;
      continue;
    }
    reservations += 1;
    losSum += s.los;
    leadSum += s.lead;
    roomNights += p.nights.length;
    if (s.comp) compNights += p.nights.length;
    roomRevenue += value;
    otherRevenue += p.extras.reduce((sum, e) => sum + e.value, 0);
  }

  // A complimentary night is a room used but not sold; counting it would drag
  // ADR down for a stay nobody paid for.
  const paidNights = roomNights - compNights;
  const booked = reservations + cancellations;
  return {
    roomRevenue: round(roomRevenue),
    otherRevenue: round(otherRevenue),
    totalRevenue: round(roomRevenue + otherRevenue),
    roomNights,
    compNights,
    adr: paidNights > 0 ? round(roomRevenue / paidNights) : null,
    reservations,
    alos: reservations > 0 ? round(losSum / reservations, 2) : null,
    leadTime: reservations > 0 ? round(leadSum / reservations, 1) : null,
    cancellations,
    noShows,
    cancellationRate: booked > 0 ? round((cancellations / booked) * 100, 1) : null,
    lostRevenue: round(lostRevenue),
    occupancy:
      roomNightsAvailable > 0 ? round((roomNights / roomNightsAvailable) * 100, 1) : null,
    revpar: roomNightsAvailable > 0 ? round(roomRevenue / roomNightsAvailable) : null,
  };
}

function round(n, places = 2) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** The breakdown for one dimension: a row per value, largest revenue first. */
function breakdown(parts, dimension) {
  const groups = new Map();
  for (const p of parts) {
    const key = p.stay.keys[dimension];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups.entries()]
    .map(([name, rows]) => ({ name, ...measure(rows) }))
    .sort((a, b) => b.roomRevenue - a.roomRevenue || b.roomNights - a.roomNights);
}

/**
 * Room nights and room revenue per day, per channel.
 *
 * On the stay basis a day is the night slept; on the booked basis it is the
 * day the booking was made, carrying its whole stay. Daily is the finest
 * grain -- the page adds days up into weeks and months itself.
 */
function trend(parts, start, end, basis) {
  const dates = [...nightsBetween(start, end), end];
  const index = new Map(dates.map((d, i) => [d, i]));
  const series = {};
  const add = (channel, date, nights, revenue) => {
    const i = index.get(date);
    if (i === undefined) return;
    if (!series[channel]) {
      series[channel] = { nights: dates.map(() => 0), revenue: dates.map(() => 0) };
    }
    series[channel].nights[i] += nights;
    series[channel].revenue[i] = round(series[channel].revenue[i] + revenue);
  };

  for (const p of parts) {
    if (p.stay.released) continue;
    const channel = p.stay.keys.channel;
    if (basis === 'booked') {
      add(channel, p.bucketDate, p.nights.length, p.nights.reduce((s, n) => s + n.value, 0));
    } else {
      for (const n of p.nights) add(channel, n.date, 1, n.value);
    }
  }
  return { dates, series };
}

/**
 * Nights by the day of the week and by the month they were slept on.
 *
 * Seasonality is about when guests stay, so on either basis it is keyed by
 * the night, not the booking. Occupancy only means something on the stay
 * basis, where the nights and the rooms available cover the same dates.
 */
function seasonality(parts, start, end, basis, capacity) {
  const dates = [...nightsBetween(start, end), end];
  const stayBasis = basis === 'stay';

  const weekdays = Array.from({ length: 7 }, (_, i) => ({
    key: i,
    days: 0,
    roomNights: 0,
    paidNights: 0,
    roomRevenue: 0,
  }));
  const months = new Map();
  const month = (key) => {
    if (!months.has(key)) {
      months.set(key, { key, days: 0, roomNights: 0, paidNights: 0, roomRevenue: 0, arrivals: 0 });
    }
    return months.get(key);
  };

  if (stayBasis) {
    for (const d of dates) {
      weekdays[weekdayOf(d)].days += 1;
      month(d.slice(0, 7)).days += 1;
    }
  }

  for (const p of parts) {
    const s = p.stay;
    if (s.released) continue;
    for (const n of p.nights) {
      for (const bucket of [weekdays[weekdayOf(n.date)], month(n.date.slice(0, 7))]) {
        bucket.roomNights += 1;
        if (!s.comp) bucket.paidNights += 1;
        bucket.roomRevenue += n.value;
      }
    }
    const arrivalMonth = s.checkIn.slice(0, 7);
    if (!stayBasis || (s.checkIn >= start && s.checkIn <= end)) month(arrivalMonth).arrivals += 1;
  }

  const finish = (b) => {
    const available = stayBasis && capacity > 0 ? b.days * capacity : 0;
    return {
      key: b.key,
      roomNights: b.roomNights,
      roomRevenue: round(b.roomRevenue),
      adr: b.paidNights > 0 ? round(b.roomRevenue / b.paidNights) : null,
      occupancy: available > 0 ? round((b.roomNights / available) * 100, 1) : null,
      revpar: available > 0 ? round(b.roomRevenue / available) : null,
      ...(b.arrivals !== undefined ? { arrivals: b.arrivals } : {}),
    };
  };

  // Monday first: a hotel's week is weekdays then the weekend.
  const order = [1, 2, 3, 4, 5, 6, 0];
  return {
    weekdays: order.map((i) => finish(weekdays[i])),
    months: [...months.values()].sort((a, b) => a.key.localeCompare(b.key)).map(finish),
  };
}

function weekdayOf(iso) {
  return parseDateISO(iso).getDay();
}

/**
 * Rooms the property can sell on a night: its active physical rooms, or the
 * room types' own counts where no rooms have been numbered -- the same
 * fallback the availability check uses. Out-of-order blocks are not taken off;
 * occupancy here is against the whole house.
 */
async function capacityOf(propertyId) {
  const [types, rooms] = await Promise.all([
    listRoomTypes(propertyId),
    listRooms(propertyId, { includeInactive: false }).catch(() => []),
  ]);
  const physical = {};
  for (const r of rooms) physical[r.room_type_id] = (physical[r.room_type_id] || 0) + 1;
  const capacity = types.reduce(
    (sum, t) => sum + (physical[t.id] || Number(t.number_of_rooms) || 0),
    0
  );
  return { types, capacity };
}

async function ratePlanNames(propertyId) {
  const { data, error } = await getSupabaseAdmin()
    .from('rate_plans')
    .select('id, plan_name')
    .eq('property_id', propertyId);
  if (error) throw new Error(`Failed to load rate plans: ${error.message}`);
  return Object.fromEntries((data || []).map((p) => [p.id, p.plan_name]));
}

/**
 * The same date a year earlier. 29 February has no twin, so it becomes the
 * 28th rather than rolling into March and shifting the whole period a day.
 */
function yearEarlier(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export const COMPARISONS = ['yoy', 'previous', 'custom'];

/** The dates a period is compared with. */
export function comparisonRange(start, end, compare, custom = {}) {
  if (compare === 'custom' && custom.start && custom.end) {
    return { start: custom.start, end: custom.end };
  }
  if (compare === 'previous') {
    const length = daysBetween(start, end) + 1;
    return { start: shift(start, -length), end: shift(start, -1) };
  }
  return { start: yearEarlier(start), end: yearEarlier(end) };
}

/**
 * The whole booking performance report for [start, end], both inclusive,
 * with the headline figures for the comparison period alongside.
 */
export async function getBookingPerformance(
  propertyId,
  { start, end, basis = 'stay', compare = 'yoy', compareStart = null, compareEnd = null }
) {
  const against = comparisonRange(start, end, compare, { start: compareStart, end: compareEnd });

  const [{ types, capacity }, planNames, facts, pastFacts] = await Promise.all([
    capacityOf(propertyId),
    ratePlanNames(propertyId),
    loadFacts(propertyId, start, end, basis),
    loadFacts(propertyId, against.start, against.end, basis),
  ]);

  const names = {
    roomTypes: Object.fromEntries(types.map((t) => [t.id, t.room_type_name])),
    ratePlans: planNames,
  };

  const current = slice(buildStays(facts, names), start, end, basis);
  const previous = slice(buildStays(pastFacts, names), against.start, against.end, basis);
  // Each period against its own length: a custom comparison need not be as
  // long as the period, and occupancy has to be judged on its own nights.
  const available = (from, to) =>
    basis === 'stay' && capacity > 0 ? (daysBetween(from, to) + 1) * capacity : null;

  // The currency most of the money is in. A property sells in one; a stray
  // row in another is not worth splitting every figure over.
  const currencies = {};
  for (const r of facts.reservations) {
    currencies[r.currency || 'INR'] = (currencies[r.currency || 'INR'] || 0) + 1;
  }
  const currency =
    Object.entries(currencies).sort((a, b) => b[1] - a[1])[0]?.[0] || 'INR';

  return {
    start,
    end,
    basis,
    currency,
    capacity,
    compare: COMPARISONS.includes(compare) ? compare : 'yoy',
    previous: against,
    kpis: {
      current: measure(current, { roomNightsAvailable: available(start, end) }),
      previous: measure(previous, { roomNightsAvailable: available(against.start, against.end) }),
    },
    breakdowns: Object.fromEntries(DIMENSIONS.map((d) => [d, breakdown(current, d)])),
    trend: trend(current, start, end, basis),
    seasonality: seasonality(current, start, end, basis, capacity),
  };
}
