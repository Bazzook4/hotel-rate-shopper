/**
 * Contracted rates for companies and travel agents.
 *
 * A contract is a set of lines, each a fixed price for one room type (and
 * optionally one meal plan) over a date range, optionally only on some
 * weekdays or in some months. Pure functions, so the quote, the setup page's
 * preview and any test price a night the same way.
 *
 * Where several lines cover a night, the most specific wins:
 *   1. a line for the meal plan booked beats one for any plan
 *   2. the line that covers the fewest nights beats a broader one -- its
 *      date range, cut down by its weekdays and months
 *   3. the newer line beats the older
 * so "all year 3,500" with "Fri–Sat 4,000" and "December 4,500" on top
 * reads the way a hotelier would write the contract on paper.
 */

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const list = (v) => (Array.isArray(v) && v.length > 0 ? v.map(Number) : null);

/** Whether a line applies to a night (an ISO date). */
export function lineCovers(line, date) {
  if (!date || date < line.valid_from || date > line.valid_to) return false;
  const d = new Date(`${date}T00:00:00Z`);
  const weekdays = list(line.weekdays);
  if (weekdays && !weekdays.includes(d.getUTCDay())) return false;
  const months = list(line.months);
  if (months && !months.includes(d.getUTCMonth() + 1)) return false;
  return true;
}

const coverage = new WeakMap();

/** How many nights a line applies to across its whole range. */
function nightsCovered(line) {
  if (coverage.has(line)) return coverage.get(line);
  let n = 0;
  const end = new Date(`${line.valid_to}T00:00:00Z`);
  for (let d = new Date(`${line.valid_from}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (lineCovers(line, d.toISOString().slice(0, 10))) n += 1;
  }
  coverage.set(line, n);
  return n;
}

/** Negative when `a` should win over `b`. */
function compareSpecificity(a, b) {
  return (
    (b.rate_plan_id ? 1 : 0) - (a.rate_plan_id ? 1 : 0) ||
    nightsCovered(a) - nightsCovered(b) ||
    String(b.created_at || "").localeCompare(String(a.created_at || ""))
  );
}

/** The line that prices this room, plan and night, or null. */
export function pickLine(lines, { roomTypeId, ratePlanId, date }) {
  const candidates = (lines || []).filter(
    (l) =>
      l.room_type_id === roomTypeId &&
      (!l.rate_plan_id || l.rate_plan_id === ratePlanId) &&
      lineCovers(l, date)
  );
  if (candidates.length === 0) return null;
  return candidates.sort(compareSpecificity)[0];
}

const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * What a line charges for a night at this occupancy, or null when it has no
 * price for it.
 *
 * Adults up to the room's base are priced from `adult_rates`; a count with no
 * price of its own takes the base-adults price (or the highest set below it).
 * Each adult above base adds the extra-adult rate -- with none set, no extra
 * is charged, as a rate plan's room rate does. Children add the child rate.
 */
export function lineRate(line, { adults = 2, children = 0, baseAdults = 2 }) {
  const rates = line.adult_rates || {};
  const base = Math.max(1, Number(baseAdults) || 1);
  const at = (n) => num(rates[n] ?? rates[String(n)]);

  const priceUpTo = (n) => {
    const own = at(n);
    if (own != null) return own;
    for (let k = n - 1; k >= 1; k -= 1) if (at(k) != null) return at(k);
    for (let k = n + 1; k <= base; k += 1) if (at(k) != null) return at(k);
    return null;
  };

  const a = Math.max(1, Number(adults) || 1);
  const atBase = priceUpTo(Math.min(a, base));
  if (atBase == null) return null;

  const extraAdults = Math.max(0, a - base) * (num(line.extra_adult_rate) || 0);
  const kids = (Number(children) || 0) * (num(line.extra_child_rate) || 0);
  return Number((atBase + extraAdults + kids).toFixed(2));
}

/**
 * Each night of a stay at the contract rate, or null where no line covers
 * it -- the caller decides what an uncovered night costs.
 */
export function contractNights(lines, { roomTypeId, ratePlanId, nights, adults, children, baseAdults }) {
  return nights.map((stay_date) => {
    const line = pickLine(lines, { roomTypeId, ratePlanId, date: stay_date });
    const rate = line ? lineRate(line, { adults, children, baseAdults }) : null;
    return { stay_date, rate, line_id: rate == null ? null : line.id };
  });
}

/** "Fri, Sat · Dec" -- when a line applies, beyond its dates. */
export function describeWhen(line) {
  const parts = [];
  const w = list(line.weekdays);
  const m = list(line.months);
  if (w) parts.push(w.sort((x, y) => x - y).map((d) => WEEKDAYS[d]).join(", "));
  if (m) parts.push(m.sort((x, y) => x - y).map((n) => MONTHS[n - 1]).join(", "));
  return parts.join(", ") || "Every day";
}
