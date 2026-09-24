/**
 * Derived rate plan pricing.
 *
 * A rate plan is either a master (priced directly) or derived from exactly
 * one master via an offset, multiplier or percentage. This logic lives here,
 * not in Aiosell -- Aiosell only transports the resulting rates to channels.
 */

export const DERIVE_METHODS = ["offset", "multiplier", "percent"];

export function describeDerivation(plan) {
  if (!plan?.derive_from_id) return null;
  const v = Number(plan.derive_value);
  if (!Number.isFinite(v)) return null;
  switch (plan.derive_method) {
    case "offset":
      return `${v >= 0 ? "+" : ""}${v}`;
    case "multiplier":
      return `x${v}`;
    case "percent":
      return `${v >= 0 ? "+" : ""}${v}%`;
    default:
      return null;
  }
}

function applyMethod(masterRate, method, value) {
  switch (method) {
    case "offset":
      return masterRate + value;
    case "multiplier":
      return masterRate * value;
    case "percent":
      return masterRate * (1 + value / 100);
    default:
      throw new Error(`Unknown derive method: ${method}`);
  }
}

/**
 * Resolve a single plan's rate, following the derivation chain to its master.
 *
 * `plansById` maps plan id -> plan. `baseRates` maps plan id -> directly set
 * rate, used for masters and as a fallback.
 *
 * Chains are followed rather than assuming one level, so a plan derived from
 * a plan derived from a master still resolves. A cycle throws rather than
 * looping, though the schema's constraints should prevent one.
 */
export function resolveRate(planId, plansById, baseRates, _seen) {
  const seen = _seen || new Set();
  if (seen.has(planId)) {
    throw new Error(`Circular rate plan derivation at ${planId}`);
  }
  seen.add(planId);

  const plan = plansById[planId];
  if (!plan) return null;

  if (!plan.derive_from_id) {
    const own = Number(baseRates?.[planId]);
    return Number.isFinite(own) ? own : null;
  }

  const masterRate = resolveRate(plan.derive_from_id, plansById, baseRates, seen);
  if (masterRate === null) return null;

  const value = Number(plan.derive_value);
  if (!Number.isFinite(value)) return null;

  return applyMethod(masterRate, plan.derive_method, value);
}

/** Resolve every plan, returning { [planId]: rate|null }. */
export function resolveAllRates(plans, baseRates) {
  const plansById = Object.fromEntries((plans || []).map((p) => [p.id, p]));
  const out = {};
  for (const p of plans || []) {
    try {
      out[p.id] = resolveRate(p.id, plansById, baseRates);
    } catch {
      out[p.id] = null; // cycle -- surfaced as "unresolved" in the UI
    }
  }
  return out;
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
