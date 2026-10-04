/**
 * How much a hotelier has to tell pricing, kept as small as possible.
 *
 * A new property answers two questions -- how low it will go, and how bold
 * the changes may be -- and everything else is derived. Weights are set by
 * how much of the property's own history exists, not by a form, because a
 * hotel a month old cannot know what "pickup weight 1.5" should mean and
 * should not have to.
 */

/** Daily move caps behind the three boldness choices. */
export const BOLDNESS = {
  cautious: { label: "Cautious", maxChangePct: 10 },
  balanced: { label: "Balanced", maxChangePct: 20 },
  aggressive: { label: "Aggressive", maxChangePct: 30 },
};

/** The preset a stored cap corresponds to, or null for a hand-set one. */
export function boldnessFor(maxChangePct) {
  const n = Number(maxChangePct);
  const hit = Object.entries(BOLDNESS).find(([, b]) => b.maxChangePct === n);
  return hit ? hit[0] : null;
}

export const DEFAULT_FLOOR_PCT = 70;
export const DEFAULT_CEILING_PCT = 250;

/**
 * The floor and ceiling a room is actually priced within.
 *
 * A rate the hotelier typed for that room wins; otherwise both follow from
 * the room's base rate, so a property with five room types sets one
 * percentage instead of ten numbers -- and a room re-priced in Rate Plan
 * Setup carries its bounds with it.
 */
export function effectiveBounds(room, boundRow, strategy) {
  const base = room?.base_price != null ? Number(room.base_price) : null;
  const floorPct = Number(strategy?.floor_pct ?? DEFAULT_FLOOR_PCT);
  const ceilingPct = Number(strategy?.ceiling_pct ?? DEFAULT_CEILING_PCT);

  const typedFloor = boundRow?.floor_rate != null ? Number(boundRow.floor_rate) : null;
  const typedCeiling = boundRow?.ceiling_rate != null ? Number(boundRow.ceiling_rate) : null;

  return {
    floor_rate: typedFloor ?? (base ? Math.round((base * floorPct) / 100) : null),
    ceiling_rate: typedCeiling ?? (base ? Math.round((base * ceilingPct) / 100) : null),
    floorDerived: typedFloor == null && base != null,
    ceilingDerived: typedCeiling == null && base != null,
  };
}

/**
 * How far to trust a figure drawn from `n` observations, from 0 towards 1.
 *
 * `k` is the number of observations at which it earns half its full weight.
 * Three bookings make an average, but not one worth moving a rate on.
 */
function confidence(n, k) {
  if (!n || n <= 0) return 0;
  return n / (n + k);
}

/** The weights a hand-tuned strategy starts from, and auto mode scales. */
export const BASE_WEIGHTS = {
  compset: 0.5,
  occupancy: 1.0,
  weekday: 0.5,
  pickup: 1.0,
  adr_90: 0.5,
  adr_ly: 0.5,
  events: 1.0,
};

/**
 * Weights earned by data rather than typed in.
 *
 * Occupancy, weekday and events are trusted from day one: the first is a
 * count, the others are calendar facts. The history-based signals grow into
 * their weight as nights accumulate, so a new hotel is priced on what it can
 * see today and an established one leans on what it has proved.
 */
export function autoWeights({ pickupBookings, nights90, nightsLastYear }) {
  return {
    compset: BASE_WEIGHTS.compset,
    occupancy: BASE_WEIGHTS.occupancy,
    weekday: BASE_WEIGHTS.weekday,
    pickup: BASE_WEIGHTS.pickup * confidence(pickupBookings, 10),
    adr_90: BASE_WEIGHTS.adr_90 * confidence(nights90, 30),
    adr_ly: BASE_WEIGHTS.adr_ly * confidence(nightsLastYear, 30),
    events: BASE_WEIGHTS.events,
  };
}

/** The weights a stored strategy asks for, or auto ones when it asks for none. */
export function resolveWeights(strategy, maturity) {
  if (strategy?.weights_mode === "custom") {
    return Object.fromEntries(
      Object.keys(BASE_WEIGHTS).map((key) => [key, Number(strategy[`weight_${key}`] ?? 0)])
    );
  }
  return autoWeights(maturity);
}
