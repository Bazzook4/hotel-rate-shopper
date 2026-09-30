/**
 * Derived rate plan pricing.
 *
 * A rate plan sets the defaults and each room rate under it -- one
 * rate_plan_rooms row, a plan sold in one room -- inherits them. A room rate
 * is priced one of two ways: manually, from its own per-adult rates, or
 * derived from exactly one other room rate by a rule. By default a room rate
 * follows its plan, so a plan derived from "BAR" makes its Deluxe follow
 * BAR's Deluxe; a room rate can instead be unlocked and pointed at any other
 * room rate, even a different room ("Double / 2B1D").
 *
 * Derivation is adult by adult: a derived single follows its source's single
 * and a double the double. A rule can be overridden for one adult count, so a
 * single can take a bigger discount than the double.
 *
 * This logic lives here, not in Aiosell -- Aiosell only transports the
 * resulting rates to channels.
 */

/**
 * The rules a rate can be derived by, in the order the setup page lists them.
 * `steps` says which values the rule needs: the two-step rules apply the
 * first value, then the second, to the result.
 */
export const DERIVE_RULES = [
  { id: "same", label: "Keep rates the same", steps: [] },
  { id: "offset", label: "Amount", steps: ["amount"] },
  { id: "offset_percent", label: "Amount then percentage", steps: ["amount", "percent"] },
  { id: "percent", label: "Percentage", steps: ["percent"] },
  { id: "percent_offset", label: "Percentage then amount", steps: ["percent", "amount"] },
  // Kept for plans saved before the two-step rules existed; not offered for
  // new ones, since a percentage says the same thing more plainly.
  { id: "multiplier", label: "Multiply by", steps: ["factor"], legacy: true },
];

export const DERIVE_METHODS = DERIVE_RULES.map((r) => r.id);

export const ruleById = (id) => DERIVE_RULES.find((r) => r.id === id) || null;

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));

function applyStep(rate, kind, value) {
  if (kind === "amount") return rate + value;
  if (kind === "percent") return rate * (1 + value / 100);
  if (kind === "factor") return rate * value;
  throw new Error(`Unknown derive step: ${kind}`);
}

/**
 * Apply a rule to a source rate. Returns null when the rule is incomplete,
 * rather than guessing a missing value as zero.
 */
export function applyRule(rate, method, value, value2) {
  const rule = ruleById(method);
  if (!rule || rate === null || rate === undefined || !Number.isFinite(Number(rate))) {
    return null;
  }
  const values = [num(value), num(value2)];
  let out = Number(rate);
  for (let i = 0; i < rule.steps.length; i++) {
    if (!Number.isFinite(values[i])) return null;
    out = applyStep(out, rule.steps[i], values[i]);
  }
  return out;
}

/** What is wrong with a rule, or "" when it is complete. */
export function ruleProblem(method, value, value2) {
  const rule = ruleById(method);
  if (!rule) return `Choose how to adjust the rate (${DERIVE_METHODS.join(", ")}).`;
  const values = [num(value), num(value2)];
  for (let i = 0; i < rule.steps.length; i++) {
    if (!Number.isFinite(values[i])) {
      return rule.steps.length > 1
        ? `"${rule.label}" needs both an amount and a percentage.`
        : `Set how much to adjust the rate by.`;
    }
  }
  if (method === "multiplier" && values[0] <= 0) return "A multiplier must be above zero.";
  return "";
}

/** A rule in a few characters, for the setup list: "−10% then +500". */
export function describeRule(method, value, value2) {
  const rule = ruleById(method);
  if (!rule) return null;
  if (rule.id === "same") return "same rates";
  const values = [num(value), num(value2)];
  const parts = rule.steps.map((kind, i) => {
    const v = values[i];
    if (!Number.isFinite(v)) return "?";
    const sign = v < 0 ? "−" : "+";
    const mag = Math.abs(v).toLocaleString("en-IN");
    if (kind === "percent") return `${sign}${mag}%`;
    if (kind === "factor") return `×${v}`;
    return `${sign}${mag}`;
  });
  return parts.join(" then ");
}

export function describeDerivation(plan) {
  if (!plan?.derive_from_id) return null;
  return describeRule(plan.derive_method, plan.derive_value, plan.derive_value_2);
}

/**
 * Plans that may serve as a master for `plan`: same property, not the plan
 * itself, and not already derived from it (which would create a cycle).
 */
export function eligibleMasters(plan, allPlans) {
  const descendants = new Set();
  const collect = (id) => {
    for (const p of allPlans) {
      if (p.derive_from_id === id && !descendants.has(p.id)) {
        descendants.add(p.id);
        collect(p.id);
      }
    }
  };
  if (plan?.id) collect(plan.id);

  return (allPlans || []).filter(
    (p) =>
      p.id !== plan?.id &&
      !descendants.has(p.id) &&
      p.property_id === plan?.property_id
  );
}

const key = (planId, roomId) => `${planId}|${roomId}`;

/**
 * What one room rate follows: `{ manual: true }`, or the room rate it is
 * derived from and the rule.
 *
 * A room rate with rate_mode 'manual' or 'derived' has been unlocked and uses
 * its own setup. Otherwise it follows its plan: a derived plan makes each of
 * its room rates follow the master's rate in the same room. Per-adult
 * overrides belong to the room rate whichever way it derives.
 */
export function rateSourceOf(plan, assignment) {
  const a = assignment || null;
  if (a?.rate_mode === "manual") return { manual: true, inherited: false };
  if (a?.rate_mode === "derived" && a.derive_from_plan_id && a.derive_from_room_id) {
    return {
      manual: false,
      inherited: false,
      planId: a.derive_from_plan_id,
      roomId: a.derive_from_room_id,
      method: a.derive_method,
      value: a.derive_value,
      value2: a.derive_value_2,
      overrides: a.adult_overrides || null,
    };
  }
  if (plan?.derive_from_id) {
    return {
      manual: false,
      inherited: true,
      planId: plan.derive_from_id,
      roomId: a?.room_type_id ?? null,
      method: plan.derive_method,
      value: plan.derive_value,
      value2: plan.derive_value_2,
      overrides: a?.adult_overrides || null,
    };
  }
  return { manual: true, inherited: true };
}

/**
 * Every room rate of a property, resolved adult by adult.
 *
 * `ownRateAt(planId, roomId, adults)` is a room rate's own rate for that many
 * adults, which is what a manual room rate is priced at. Callers differ on
 * the fallback -- the CM grid shows the room's base price so an unassigned
 * property still renders, a booking quote refuses to launder one -- so that
 * choice stays with them.
 *
 * Beyond the room's base adults each further adult adds the room rate's own
 * extra-person rate; that is deliberately not derived.
 *
 * `rate()` returns null for a room rate caught in a loop rather than
 * throwing, so one bad setup cannot blank the whole grid. `loopAt()` says
 * whether one is, for validation.
 */
export function roomRateResolver({ ratePlans, assignments, roomTypes, ownRateAt }) {
  const planById = Object.fromEntries((ratePlans || []).map((p) => [p.id, p]));
  const roomById = Object.fromEntries((roomTypes || []).map((r) => [r.id, r]));
  const assignmentFor = {};
  for (const a of assignments || []) assignmentFor[key(a.rate_plan_id, a.room_type_id)] = a;

  const baseAdultsOf = (roomId) => Math.max(1, Number(roomById[roomId]?.base_adults) || 0);

  const sourceOf = (planId, roomId) => {
    const a = assignmentFor[key(planId, roomId)] || { room_type_id: roomId };
    const src = rateSourceOf(planById[planId], a);
    if (!src.manual && !src.roomId) src.roomId = roomId;
    return src;
  };

  const minRateOf = (planId, roomId) => {
    const own = num(assignmentFor[key(planId, roomId)]?.min_rate);
    if (Number.isFinite(own)) return own;
    const plan = num(planById[planId]?.min_rate);
    return Number.isFinite(plan) ? plan : null;
  };

  const cache = new Map();

  function resolve(planId, roomId, occupancy, trail) {
    const k = `${key(planId, roomId)}|${occupancy}`;
    if (cache.has(k)) return cache.get(k);
    const node = key(planId, roomId);
    if (trail.has(node)) throw new Error(`Circular rate derivation at ${node}`);

    const base = baseAdultsOf(roomId);
    let rate;
    if (occupancy > base) {
      const atBase = resolve(planId, roomId, base, trail);
      const extra = num(assignmentFor[node]?.extra_adult_rate);
      rate =
        atBase === null
          ? null
          : atBase + (Number.isFinite(extra) ? (occupancy - base) * extra : 0);
    } else {
      const src = sourceOf(planId, roomId);
      if (src.manual) {
        const own = ownRateAt(planId, roomId, occupancy);
        rate = own === null || own === undefined || !Number.isFinite(Number(own)) ? null : Number(own);
      } else {
        const next = new Set(trail).add(node);
        const from = resolve(src.planId, src.roomId, occupancy, next);
        const o = src.overrides?.[occupancy] ?? src.overrides?.[String(occupancy)];
        rate = o?.method
          ? applyRule(from, o.method, o.value, o.value2)
          : applyRule(from, src.method, src.value, src.value2);
        // A floor only for derived rates: a rate typed by hand is what the
        // hotel chose, and the setup page refuses one below the minimum.
        const floor = minRateOf(planId, roomId);
        if (rate !== null && floor !== null && rate < floor) rate = floor;
      }
    }

    cache.set(k, rate);
    return rate;
  }

  return {
    rate(planId, roomId, occupancy) {
      try {
        return resolve(planId, roomId, occupancy, new Set());
      } catch {
        return null;
      }
    },
    /** Rates for 1..base adults: { 1: 3500, 2: 4000 }. */
    adultRates(planId, roomId) {
      const out = {};
      for (let n = 1; n <= baseAdultsOf(roomId); n++) out[n] = this.rate(planId, roomId, n);
      return out;
    },
    sourceOf,
    minRateOf,
    baseAdultsOf,
    /** Whether following this room rate's sources ever comes back round. */
    loopAt(planId, roomId) {
      const seen = new Set();
      let at = { planId, roomId };
      while (at) {
        const k = key(at.planId, at.roomId);
        if (seen.has(k)) return true;
        seen.add(k);
        const src = sourceOf(at.planId, at.roomId);
        at = src.manual ? null : { planId: src.planId, roomId: src.roomId };
      }
      return false;
    },
  };
}

/**
 * The first room rate caught in a derivation loop, or null.
 *
 * Checked on every save that could close one -- a plan's derivation as much
 * as a room's -- since a plan-level link can loop through a room override.
 */
export function findDerivationLoop({ ratePlans, assignments, roomTypes }) {
  const r = roomRateResolver({ ratePlans, assignments, roomTypes, ownRateAt: () => 0 });
  for (const plan of ratePlans || []) {
    for (const room of roomTypes || []) {
      if (r.loopAt(plan.id, room.id)) return { planId: plan.id, roomId: room.id };
    }
  }
  return null;
}

/**
 * A rate plan's restrictions in the shape Aiosell expects.
 *
 * Only the fields we actually manage are set; the rest are sent as null so
 * the partner does not retain a previous value we no longer intend.
 */
export function restrictionsFor(plan) {
  return {
    stopSell: Boolean(plan?.stop_sell),
    minimumStay: plan?.min_stay ?? null,
    maximumStay: plan?.max_stay ?? null,
    closeOnArrival: Boolean(plan?.close_on_arrival),
    closeOnDeparture: Boolean(plan?.close_on_departure),
    minimumStayArrival: null,
    maximumStayArrival: null,
    exactStayArrival: null,
    minimumAdvanceReservation: null,
    maximumAdvanceReservation: null,
  };
}

/**
 * Whether a rate plan is sold on a given room type.
 *
 * A plan is property-level and gets room types assigned to it, so the
 * assignments are the answer where they exist. A plan with none falls back to
 * the older rule -- its own room_type_id, or every room if it named none --
 * so a property that has not assigned rooms yet keeps working unchanged.
 *
 * `assignments` is the rate_plan_rooms rows for the property.
 */
export function planAppliesToRoom(plan, roomId, assignments) {
  const mine = (assignments || []).filter((a) => a.rate_plan_id === plan.id);
  if (mine.length > 0) {
    return mine.some((a) => a.room_type_id === roomId);
  }
  return !plan.room_type_id || plan.room_type_id === roomId;
}

/** The plans sold on one room, in the order given. */
export function plansForRoom(ratePlans, roomId, assignments) {
  return (ratePlans || []).filter((p) => planAppliesToRoom(p, roomId, assignments));
}
