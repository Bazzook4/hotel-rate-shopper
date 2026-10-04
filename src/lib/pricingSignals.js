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

import { DEFAULT_SCALES, WEEKDAY_NAMES, bandFor, columnFor, columnLabels } from "./pricingScales";

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
 * How full we already are for that night, read against how far away it is.
 *
 * The strongest honest signal a hotel has: rooms already sold are demand
 * that has revealed itself, unlike a forecast. Steep at the top, because the
 * last few rooms are worth far more than the first few. The scale is the
 * hotelier's occupancy-by-days-out table, since 30% sold means something
 * different three days out than three months out.
 */
export function occupancySignal({ occupancyPct, daysOut = 0, scale = DEFAULT_SCALES.occupancy }) {
  if (occupancyPct == null || Number.isNaN(occupancyPct)) return SILENT;

  const pct = occupancyPct;
  const col = columnFor(scale.cols, daysOut);
  const row = bandFor(scale.rows, pct);
  const move = Number(row?.pcts?.[col] ?? 0);
  const out = columnLabels(scale.cols)[col];
  return { pct: move, note: `${pct.toFixed(0)}% sold, ${out} days out — ${describe(move)}` };
}

/** Plain words for a move, so a reason reads as a sentence. */
function describe(move) {
  if (move >= 15) return "very little left";
  if (move > 0) return "filling well";
  if (move === 0) return "on track";
  if (move > -8) return "behind";
  return "well behind";
}

/**
 * Rooms on the books now against this many days out last year.
 *
 * Occupancy says how full; pace says whether that is good for this distance
 * out. Silent until last year's bookings exist for the date, because a new
 * hotel has nothing to be ahead or behind of.
 */
export function paceSignal({ onBooksNow, onBooksLastYear, finalLastYear, scale = DEFAULT_SCALES.pace }) {
  if (onBooksNow == null || !finalLastYear || finalLastYear < 2) return SILENT;
  // Both empty this far out is normal; empty last year but selling now is ahead.
  let ratio;
  if (!onBooksLastYear) ratio = onBooksNow > 0 ? 200 : 100;
  else ratio = (onBooksNow / onBooksLastYear) * 100;

  const band = bandFor(scale.rows, ratio);
  return {
    pct: Number(band?.pct ?? 0),
    note: `${onBooksNow} room-night${onBooksNow === 1 ? "" : "s"} booked vs ${onBooksLastYear || 0} at this point last year`,
  };
}

/**
 * Weekday versus weekend.
 *
 * A small, predictable shape rather than a demand reading: it says Saturday
 * is usually dearer than Tuesday, nothing more. Weighted low by default for
 * that reason, and it should stay low where occupancy is informative.
 */
export function weekdaySignal({ stayDate, scale = DEFAULT_SCALES.weekday }) {
  if (!stayDate) return SILENT;
  const day = new Date(`${stayDate}T00:00:00`).getDay();
  return { pct: Number(scale.pcts?.[day] ?? 0), note: `${WEEKDAY_NAMES[day]} night` };
}

/**
 * Bookings taken lately for that night, against what is normal at this
 * distance out.
 *
 * Pickup is the leading indicator occupancy is not: it catches demand
 * building before the room count reflects it. Needs booking history, so it
 * stays silent until reservations have accumulated.
 */
export function pickupSignal({ recentBookings, expectedBookings, scale = DEFAULT_SCALES.pickup }) {
  if (recentBookings == null || !expectedBookings || expectedBookings <= 0) return SILENT;

  const ratio = (recentBookings / expectedBookings) * 100;
  const band = bandFor(scale.rows, ratio);
  return {
    pct: Number(band?.pct ?? 0),
    note: `Booked this week at ${ratio.toFixed(0)}% of the usual pace`,
  };
}

/**
 * What we actually achieved over the last 90 days.
 *
 * An anchor rather than a target: it stops the other signals drifting the
 * rate far from what this property demonstrably sells at.
 */
export function adr90Signal({ currentRate, adr90, scale = DEFAULT_SCALES.adr_90 }) {
  if (!currentRate || !adr90 || adr90 <= 0) return SILENT;

  const gapPct = ((adr90 - currentRate) / currentRate) * 100;
  if (Math.abs(gapPct) < Number(scale.ignore)) return { pct: 0, note: "In line with recent ADR" };
  // A share of the gap (a third by default): recent trading informs, it
  // does not overrule.
  return {
    pct: (gapPct * Number(scale.share)) / 100,
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
export function adrLastYearSignal({ adr90, adrLastYearSameDate, scale = DEFAULT_SCALES.adr_ly }) {
  if (!adr90 || adr90 <= 0 || !adrLastYearSameDate || adrLastYearSameDate <= 0) return SILENT;

  const gapPct = ((adrLastYearSameDate - adr90) / adr90) * 100;
  if (Math.abs(gapPct) < Number(scale.ignore)) return { pct: 0, note: "Typical for this date" };
  return {
    pct: (gapPct * Number(scale.share)) / 100,
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
  "pace",
  "adr_90",
  "adr_ly",
  "events",
];

/**
 * The most of any one decision a signal may carry, however it is weighted.
 *
 * Competitor rates come from scraping, which fails in ways the hotel's own
 * bookings do not -- a blocked request, a missing hotel, a stale night. They
 * inform the rate; they are not allowed to set it.
 */
export const SHARE_CAPS = { compset: 0.2 };

/**
 * Combine the signals that spoke into one recommended rate, then apply the
 * hotelier's own rules.
 *
 * Weights are normalised across the signals that had data, so switching a
 * signal off, or one simply having nothing to say, changes the balance
 * between the rest rather than diluting them towards no change.
 *
 * Rules come after the boldness cap: the cap guards against the arithmetic
 * over-reacting, while a rule is a decision the hotelier made on purpose.
 * Floor and ceiling come last and stand above both.
 *
 * Returns the rate plus why: the reasons are what make a recommendation
 * arguable, and an unarguable rate does not get accepted twice.
 */
export function recommendRate({ currentRate, signals, weights, maxChangePct = 25, bounds, rules = [] }) {
  if (!currentRate || currentRate <= 0) {
    return { rate: null, reasons: [], bounded_by: null, rule_pct: 0 };
  }

  const contributions = [];

  for (const key of SIGNAL_KEYS) {
    const signal = signals?.[key];
    const weight = Number(weights?.[key] ?? 0);
    // A silent signal and a switched-off one are both simply absent.
    if (!signal || weight <= 0) continue;
    contributions.push({ signal: key, pct: signal.pct, weight, note: signal.note });
  }

  // Shrink a capped signal's weight to its share of what the others carry.
  // A capped signal that spoke alone keeps its weight: there is nothing for
  // it to be a share of, and silence would help no one.
  for (const c of contributions) {
    const cap = SHARE_CAPS[c.signal];
    if (cap == null) continue;
    const others = contributions.reduce((sum, o) => (o === c ? sum : sum + o.weight), 0);
    if (others > 0 && c.weight / (c.weight + others) > cap) {
      c.weight = (cap * others) / (1 - cap);
    }
  }

  let weightedPct = 0;
  let totalWeight = 0;
  for (const c of contributions) {
    weightedPct += c.pct * c.weight;
    totalWeight += c.weight;
  }

  const reasons = contributions.map((c) => ({
    signal: c.signal,
    note: c.note,
    pct: Number(c.pct.toFixed(1)),
    weight: Number(c.weight.toFixed(2)),
  }));

  // Normalising by the weight that actually voted is what keeps a lone
  // informed signal at full strength instead of being averaged into silence.
  let movePct = totalWeight > 0 ? weightedPct / totalWeight : 0;
  if (totalWeight === 0) reasons.push({ signal: null, note: "No signals had data for this night" });

  // One noisy signal should not be able to produce a rate nobody would
  // sanction, however confident the arithmetic.
  const capped = Math.max(-maxChangePct, Math.min(maxChangePct, movePct));
  const wasCapped = capped !== movePct;
  movePct = capped;
  if (wasCapped) {
    reasons.push({ signal: null, note: `Change capped at ${maxChangePct}%` });
  }

  let rate = currentRate * (1 + movePct / 100);

  // Rules add together; a total below -90% would give the room away, so it
  // stops there (the floor normally stops it long before).
  const rulePct = Math.max(-90, rules.reduce((sum, r) => sum + Number(r.pct || 0), 0));
  const beforeRules = rate;
  if (rules.length) {
    rate *= 1 + rulePct / 100;
    for (const r of rules) {
      reasons.push({ signal: "rule", kind: r.kind, note: r.note, pct: Number(Number(r.pct).toFixed(1)) });
    }
  }

  let boundedBy = null;

  // Bounds are applied last, so they are absolute: no signal or rule,
  // however strong, can price below the floor or above the ceiling.
  if (bounds?.floor_rate != null && rate < Number(bounds.floor_rate)) {
    rate = Number(bounds.floor_rate);
    boundedBy = "floor";
  } else if (bounds?.ceiling_rate != null && rate > Number(bounds.ceiling_rate)) {
    rate = Number(bounds.ceiling_rate);
    boundedBy = "ceiling";
  }

  if (boundedBy) {
    reasons.push({
      signal: null,
      note: boundedBy === "floor" ? "Held at your floor rate" : "Held at your ceiling rate",
    });
  }

  // The part of the final rate the rules account for, after any bound has
  // undone some of it. The next run takes exactly this back out, so a rule
  // the floor absorbed is not later "removed" from a rate it never moved.
  let appliedRulePct = 0;
  if (rules.length && beforeRules > 0) {
    const effective = (Math.round(rate) / beforeRules - 1) * 100;
    appliedRulePct =
      rulePct < 0 ? Math.min(0, Math.max(rulePct, effective)) : Math.max(0, Math.min(rulePct, effective));
  }

  return {
    rate: Math.round(rate),
    reasons,
    bounded_by: boundedBy,
    rule_pct: Number(appliedRulePct.toFixed(2)),
  };
}
