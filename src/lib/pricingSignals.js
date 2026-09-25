/**
 * The dynamic pricing algorithm.
 *
 * Every signal answers the same question -- "should this night be dearer or
 * cheaper than it is now, and by how much" -- as a percentage. They are then
 * combined by weight, capped, and clipped to the room's floor and ceiling.
 *
 * A signal only votes when it has data. Three of them read booking history,
 * which a property accumulates over time, so a new property is priced by the
 * market and its own occupancy while an established one leans on what it
 * actually achieved. Weight from a silent signal is shared among those that
 * spoke, rather than being counted as "no change" -- otherwise three silent
 * signals would damp the one that knows something.
 */

/** A signal that has nothing to say. Kept explicit so callers read clearly. */
const SILENT = null;

/**
 * Market: where our rate sits against the competitor median for that night.
 *
 * Deliberately gentle. Matching the median exactly is rarely the goal -- a
 * property is positioned above or below it on purpose -- so this pulls
 * towards the median rather than onto it, and only when the gap is wide
 * enough to matter.
 */
export function compsetSignal({ currentRate, competitorMedian }) {
  if (!currentRate || !competitorMedian || competitorMedian <= 0) return SILENT;

  const gapPct = ((competitorMedian - currentRate) / currentRate) * 100;
  // Inside 5% we are level with the market; moving would be noise.
  if (Math.abs(gapPct) < 5) return { pct: 0, note: "In line with the comp set" };

  // Close half the gap, so the market informs the rate without dictating it.
  const pct = gapPct / 2;
  return {
    pct,
    note:
      gapPct > 0
        ? `Comp set median is ${Math.abs(gapPct).toFixed(0)}% above your rate`
        : `Comp set median is ${Math.abs(gapPct).toFixed(0)}% below your rate`,
  };
}

/**
 * How full we already are for that night.
 *
 * The strongest honest signal a hotel has: rooms already sold are demand
 * that has revealed itself, unlike a forecast. Steep at the top, because the
 * last few rooms are worth far more than the first few.
 */
export function occupancySignal({ soldRooms, totalRooms }) {
  if (!totalRooms || totalRooms <= 0 || soldRooms == null) return SILENT;

  const pct = (soldRooms / totalRooms) * 100;
  if (pct >= 90) return { pct: 20, note: `${pct.toFixed(0)}% sold — very little left` };
  if (pct >= 75) return { pct: 12, note: `${pct.toFixed(0)}% sold — filling fast` };
  if (pct >= 60) return { pct: 6, note: `${pct.toFixed(0)}% sold — ahead of pace` };
  if (pct >= 40) return { pct: 0, note: `${pct.toFixed(0)}% sold — on track` };
  if (pct >= 20) return { pct: -5, note: `${pct.toFixed(0)}% sold — behind pace` };
  return { pct: -10, note: `${pct.toFixed(0)}% sold — well behind` };
}

/**
 * Weekday versus weekend.
 *
 * A small, predictable shape rather than a demand reading: it says Saturday
 * is usually dearer than Tuesday, nothing more. Weighted low by default for
 * that reason, and it should stay low where occupancy is informative.
 */
export function weekdaySignal({ stayDate }) {
  if (!stayDate) return SILENT;
  const day = new Date(`${stayDate}T00:00:00`).getDay();
  // Friday and Saturday nights.
  if (day === 5 || day === 6) return { pct: 8, note: "Weekend night" };
  if (day === 0) return { pct: -3, note: "Sunday night" };
  return { pct: 0, note: "Midweek" };
}

/**
 * Bookings taken lately for that night, against what is normal at this
 * distance out.
 *
 * Pickup is the leading indicator occupancy is not: it catches demand
 * building before the room count reflects it. Needs booking history, so it
 * stays silent until reservations have accumulated.
 */
export function pickupSignal({ recentBookings, expectedBookings }) {
  if (recentBookings == null || !expectedBookings || expectedBookings <= 0) return SILENT;

  const ratio = recentBookings / expectedBookings;
  if (ratio >= 2) return { pct: 15, note: "Booking at twice the usual pace" };
  if (ratio >= 1.3) return { pct: 8, note: "Booking faster than usual" };
  if (ratio >= 0.7) return { pct: 0, note: "Booking at the usual pace" };
  if (ratio >= 0.3) return { pct: -6, note: "Booking slower than usual" };
  return { pct: -12, note: "Very little pickup" };
}

/**
 * What we actually achieved over the last 90 days.
 *
 * An anchor rather than a target: it stops the other signals drifting the
 * rate far from what this property demonstrably sells at.
 */
export function adr90Signal({ currentRate, adr90 }) {
  if (!currentRate || !adr90 || adr90 <= 0) return SILENT;

  const gapPct = ((adr90 - currentRate) / currentRate) * 100;
  if (Math.abs(gapPct) < 8) return { pct: 0, note: "In line with recent ADR" };
  // A third of the gap: recent trading informs, it does not overrule.
  return {
    pct: gapPct / 3,
    note: `90-day ADR is ${Math.abs(gapPct).toFixed(0)}% ${gapPct > 0 ? "above" : "below"} this rate`,
  };
}

/**
 * What this same date achieved last year.
 *
 * Catches annual shape a 90-day window cannot see -- a festival, a school
 * holiday, an off-season trough -- so it is compared against recent trading
 * rather than against the current rate.
 */
export function adrLastYearSignal({ adr90, adrLastYearSameDate }) {
  if (!adr90 || adr90 <= 0 || !adrLastYearSameDate || adrLastYearSameDate <= 0) return SILENT;

  const gapPct = ((adrLastYearSameDate - adr90) / adr90) * 100;
  if (Math.abs(gapPct) < 10) return { pct: 0, note: "Typical for this date" };
  return {
    pct: gapPct / 3,
    note: `This date ran ${Math.abs(gapPct).toFixed(0)}% ${gapPct > 0 ? "above" : "below"} average last year`,
  };
}

/**
 * Events near the property on that night.
 *
 * Each event carries its own expected lift, set by whoever loaded it. The
 * strongest event on a date wins rather than summing them, since two
 * concurrent events do not double demand -- the town still has one night's
 * worth of beds.
 */
export function eventsSignal({ events }) {
  if (!Array.isArray(events) || events.length === 0) return SILENT;

  const strongest = events.reduce(
    (best, e) => (best == null || (e.expected_lift_pct ?? 0) > (best.expected_lift_pct ?? 0) ? e : best),
    null
  );
  if (!strongest || !strongest.expected_lift_pct) return SILENT;

  return {
    pct: Number(strongest.expected_lift_pct),
    note:
      events.length > 1
        ? `${strongest.name} and ${events.length - 1} more nearby`
        : `${strongest.name} nearby`,
  };
}

/** Weight keys, paired with the signal each one governs. */
export const SIGNAL_KEYS = [
  "compset",
  "occupancy",
  "weekday",
  "pickup",
  "adr_90",
  "adr_ly",
  "events",
];

/**
 * Combine the signals that spoke into one recommended rate.
 *
 * Weights are normalised across the signals that had data, so switching a
 * signal off, or one simply having nothing to say, changes the balance
 * between the rest rather than diluting them towards no change.
 *
 * Returns the rate plus why: the reasons are what make a recommendation
 * arguable, and an unarguable rate does not get accepted twice.
 */
export function recommendRate({ currentRate, signals, weights, maxChangePct = 25, bounds }) {
  if (!currentRate || currentRate <= 0) {
    return { rate: null, reasons: [], bounded_by: null };
  }

  const contributions = [];
  let weightedPct = 0;
  let totalWeight = 0;

  for (const key of SIGNAL_KEYS) {
    const signal = signals?.[key];
    const weight = Number(weights?.[key] ?? 0);
    // A silent signal and a switched-off one are both simply absent.
    if (!signal || weight <= 0) continue;

    weightedPct += signal.pct * weight;
    totalWeight += weight;
    contributions.push({ signal: key, pct: signal.pct, weight, note: signal.note });
  }

  if (totalWeight === 0) {
    return {
      rate: Math.round(currentRate),
      reasons: [{ signal: null, note: "No signals had data for this night" }],
      bounded_by: null,
    };
  }

  // Normalising by the weight that actually voted is what keeps a lone
  // informed signal at full strength instead of being averaged into silence.
  let movePct = weightedPct / totalWeight;

  // One noisy signal should not be able to produce a rate nobody would
  // sanction, however confident the arithmetic.
  const capped = Math.max(-maxChangePct, Math.min(maxChangePct, movePct));
  const wasCapped = capped !== movePct;
  movePct = capped;

  let rate = currentRate * (1 + movePct / 100);
  let boundedBy = null;

  // Bounds are applied last, so they are absolute: no signal, however
  // strong, can price below the floor or above the ceiling.
  if (bounds?.floor_rate != null && rate < Number(bounds.floor_rate)) {
    rate = Number(bounds.floor_rate);
    boundedBy = "floor";
  } else if (bounds?.ceiling_rate != null && rate > Number(bounds.ceiling_rate)) {
    rate = Number(bounds.ceiling_rate);
    boundedBy = "ceiling";
  }

  const reasons = contributions.map((c) => ({
    signal: c.signal,
    note: c.note,
    pct: Number(c.pct.toFixed(1)),
    weight: c.weight,
  }));

  if (wasCapped) {
    reasons.push({ signal: null, note: `Change capped at ${maxChangePct}%` });
  }
  if (boundedBy) {
    reasons.push({
      signal: null,
      note: boundedBy === "floor" ? "Held at your floor rate" : "Held at your ceiling rate",
    });
  }

  return { rate: Math.round(rate), reasons, bounded_by: boundedBy };
}
