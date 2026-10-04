/**
 * The scales behind each pricing signal, and the hotelier's own rules on top.
 *
 * A signal turns a reading -- how full, how fast, how last year compared --
 * into a percentage move. Those turns used to be constants in code; here
 * they are data the hotelier can see and change, with today's numbers as the
 * defaults so a property that never opens this page prices exactly as before.
 *
 * Rules (last minute, far out, short gaps) are different in kind: they are
 * not readings of demand but decisions the hotelier has made, so they are
 * applied after the signals are blended and capped, and are not themselves
 * capped -- only the floor and ceiling stand above them.
 *
 * Pure and shared: the engine prices with these, and the settings page uses
 * the same functions for its live preview, so the preview cannot drift from
 * what the engine does.
 */

/**
 * Band tables read top-down: the first row whose `below` the reading is under
 * wins, and the last row (`below: null`) catches everything above.
 */
export const DEFAULT_SCALES = {
  // Occupancy by days before arrival. `cols` are the last day each column
  // covers; null is "and beyond". Today's engine ignores days out, so the
  // default columns are identical -- the presets show what using them means.
  occupancy: {
    cols: [7, 30, null],
    rows: [
      { below: 20, pcts: [-10, -10, -10] },
      { below: 40, pcts: [-5, -5, -5] },
      { below: 60, pcts: [0, 0, 0] },
      { below: 75, pcts: [6, 6, 6] },
      { below: 90, pcts: [12, 12, 12] },
      { below: null, pcts: [20, 20, 20] },
    ],
  },
  // Rooms on the books now, as a % of what was on the books this many days
  // out last year.
  pace: {
    rows: [
      { below: 50, pct: -10 },
      { below: 80, pct: -5 },
      { below: 120, pct: 0 },
      { below: 150, pct: 6 },
      { below: null, pct: 12 },
    ],
  },
  // Last week's bookings for a night, as a % of the usual week.
  pickup: {
    rows: [
      { below: 30, pct: -12 },
      { below: 70, pct: -6 },
      { below: 130, pct: 0 },
      { below: 200, pct: 8 },
      { below: null, pct: 15 },
    ],
  },
  // Gap-followers: ignore a gap under `ignore`%, otherwise close `share`% of it.
  adr_90: { ignore: 8, share: 33.33 },
  adr_ly: { ignore: 10, share: 33.33 },
  // Sunday first, as Date.getDay() counts. Friday and Saturday nights lift.
  weekday: { pcts: [-3, 0, 0, 0, 0, 8, 8] },
};

export const DEFAULT_ADJUSTMENTS = {
  // { within: days, type: "pct" | "gradual" | "amount", value }
  last_minute: [],
  // { beyond: days, value: pct } -- minus is an early-bird discount
  far_out: [],
  // { nights: longest gap, value: pct }
  orphan_gaps: [],
};

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const clone = (v) => JSON.parse(JSON.stringify(v));

function scaleBands(rows, factor) {
  return rows.map((r) => ({ ...r, pct: Math.round(r.pct * factor) }));
}

/**
 * Ready-made scales, so nobody has to type a matrix to get a sensible one.
 *
 * Default is today's behaviour. Cautious and Aggressive also use the days-out
 * columns: an empty night three days away is a problem, the same night two
 * months away is normal, so the far column moves less on low occupancy.
 */
export const PRESETS = {
  occupancy: {
    default: DEFAULT_SCALES.occupancy,
    cautious: {
      cols: [7, 30, null],
      rows: [
        { below: 20, pcts: [-8, -5, -2] },
        { below: 40, pcts: [-4, -2, 0] },
        { below: 60, pcts: [0, 0, 0] },
        { below: 75, pcts: [4, 3, 3] },
        { below: 90, pcts: [8, 6, 6] },
        { below: null, pcts: [12, 10, 10] },
      ],
    },
    aggressive: {
      cols: [7, 30, null],
      rows: [
        { below: 20, pcts: [-20, -12, -5] },
        { below: 40, pcts: [-12, -6, -2] },
        { below: 60, pcts: [-4, 0, 0] },
        { below: 75, pcts: [8, 8, 6] },
        { below: 90, pcts: [16, 16, 12] },
        { below: null, pcts: [30, 25, 20] },
      ],
    },
  },
  pace: {
    default: DEFAULT_SCALES.pace,
    cautious: { rows: scaleBands(DEFAULT_SCALES.pace.rows, 0.5) },
    aggressive: { rows: scaleBands(DEFAULT_SCALES.pace.rows, 1.5) },
  },
  pickup: {
    default: DEFAULT_SCALES.pickup,
    cautious: { rows: scaleBands(DEFAULT_SCALES.pickup.rows, 0.5) },
    aggressive: { rows: scaleBands(DEFAULT_SCALES.pickup.rows, 1.5) },
  },
};

export const PRESET_LABELS = { default: "Default", cautious: "Cautious", aggressive: "Aggressive" };

/** Which preset a scale matches, or "custom" once it has been edited. */
export function presetOf(key, scale) {
  const json = JSON.stringify(scale);
  const hit = Object.entries(PRESETS[key] || {}).find(([, p]) => JSON.stringify(p) === json);
  return hit ? hit[0] : "custom";
}

export function presetScale(key, name) {
  return clone(PRESETS[key][name]);
}

/** The stored scales with defaults filling anything not set. */
export function resolveScales(stored) {
  const out = clone(DEFAULT_SCALES);
  if (stored && typeof stored === "object") {
    for (const key of Object.keys(out)) if (stored[key]) out[key] = stored[key];
  }
  return out;
}

export function resolveAdjustments(stored) {
  const out = clone(DEFAULT_ADJUSTMENTS);
  if (stored && typeof stored === "object") {
    for (const key of Object.keys(out)) if (Array.isArray(stored[key])) out[key] = stored[key];
  }
  return out;
}

/* ---------------------------------------------------------------- lookups */

/** The band a reading falls in: the first whose `below` it is under. */
export function bandFor(rows, value) {
  if (!Array.isArray(rows) || rows.length === 0 || value == null) return null;
  return rows.find((r) => r.below == null || value < Number(r.below)) || rows[rows.length - 1];
}

/** Which days-out column a night falls in. */
export function columnFor(cols, daysOut) {
  const i = cols.findIndex((c) => c == null || daysOut <= Number(c));
  return i === -1 ? cols.length - 1 : i;
}

/** Column headings: "0–7", "8–30", "31+". */
export function columnLabels(cols) {
  let from = 0;
  return cols.map((c) => {
    const label = c == null ? `${from}+` : from === Number(c) ? `${from}` : `${from}–${c}`;
    from = c == null ? from : Number(c) + 1;
    return label;
  });
}

/** Row labels: "Under 20%", …, "90% and above". */
export function bandLabels(rows, unit = "%") {
  return rows.map((r, i) =>
    r.below == null
      ? `${i > 0 ? rows[i - 1].below : 0}${unit} and above`
      : `Under ${r.below}${unit}`
  );
}

/* ------------------------------------------------------------------ rules */

const signed = (n) => `${n > 0 ? "+" : ""}${Math.round(n * 10) / 10}`;

/**
 * The hotelier's rules that apply to one night, as percentage moves.
 *
 * Within each kind the most specific row wins -- the tightest last-minute
 * window, the furthest far-out one, the shortest gap -- so "within 15 days
 * -5%" and "within 3 days -15%" read the way a hotelier means them. Kinds
 * then add up, and the reasons line shows each one.
 *
 * `rate` is the price the rules apply to; a fixed amount is turned into a
 * percentage of it.
 */
export function rulesFor({ adjustments, daysOut, gapNights, rate }) {
  const a = resolveAdjustments(adjustments);
  const out = [];

  const lm = a.last_minute
    .filter((r) => Number(r.within) >= 0 && daysOut <= Number(r.within) && Number(r.value))
    .sort((x, y) => Number(x.within) - Number(y.within))[0];
  if (lm) {
    const within = Number(lm.within);
    let pct;
    if (lm.type === "amount") {
      pct = rate ? (Number(lm.value) / rate) * 100 : 0;
    } else if (lm.type === "gradual") {
      // Builds from a small step at the edge of the window to the full value
      // on the night itself, so there is no cliff on the first day.
      pct = Number(lm.value) * ((within + 1 - daysOut) / (within + 1));
    } else {
      pct = Number(lm.value);
    }
    const what = lm.type === "amount" ? `${signed(Number(lm.value))} a night` : `${signed(pct)}%`;
    out.push({ kind: "last_minute", pct, note: `Close to arrival (within ${within} days): ${what}` });
  }

  const far = a.far_out
    .filter((r) => Number(r.beyond) >= 0 && daysOut > Number(r.beyond) && Number(r.value))
    .sort((x, y) => Number(y.beyond) - Number(x.beyond))[0];
  if (far) {
    out.push({
      kind: "far_out",
      pct: Number(far.value),
      note: `Booking far ahead (beyond ${far.beyond} days): ${signed(Number(far.value))}%`,
    });
  }

  if (gapNights != null) {
    const gap = a.orphan_gaps
      .filter((r) => Number(r.nights) >= 1 && gapNights <= Number(r.nights) && Number(r.value))
      .sort((x, y) => Number(x.nights) - Number(y.nights))[0];
    if (gap) {
      out.push({
        kind: "orphan_gap",
        pct: Number(gap.value),
        note: `Short gap of ${gapNights} night${gapNights === 1 ? "" : "s"} between bookings: ${signed(Number(gap.value))}%`,
      });
    }
  }

  return out;
}

/** The longest gap any rule asks about, so the engine looks no further. */
export function longestGapRule(adjustments) {
  const rows = resolveAdjustments(adjustments).orphan_gaps;
  return rows.reduce((m, r) => Math.max(m, Math.min(14, Number(r.nights) || 0)), 0);
}

/* ------------------------------------------------------------- validation */

const isNum = (v) => v !== "" && v != null && Number.isFinite(Number(v));

function cleanBands(rows, { min = 0, field = "pct", width = null } = {}) {
  if (!Array.isArray(rows) || rows.length < 1) return { error: "Each scale needs at least one row." };
  const out = [];
  let prev = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const last = i === rows.length - 1;
    const below = last ? null : Number(r.below);
    if (!last) {
      if (!isNum(r.below) || below < min) return { error: "Every band needs a number to stop at." };
      if (below <= prev) return { error: "Bands must go up from top to bottom." };
      prev = below;
    }
    if (width == null) {
      if (!isNum(r[field])) return { error: "Every band needs a % move, even if it is 0." };
      const pct = Number(r[field]);
      if (pct < -90 || pct > 500) return { error: "A move must be between -90% and +500%." };
      out.push({ below, [field]: pct });
    } else {
      const pcts = Array.isArray(r.pcts) ? r.pcts : [];
      if (pcts.length !== width || !pcts.every(isNum)) {
        return { error: "Every box in the occupancy table needs a % move, even if it is 0." };
      }
      if (pcts.some((p) => Number(p) < -90 || Number(p) > 500)) {
        return { error: "A move must be between -90% and +500%." };
      }
      out.push({ below, pcts: pcts.map(Number) });
    }
  }
  return { value: out };
}

function cleanFollower(s, label) {
  if (!s || !isNum(s.ignore) || !isNum(s.share)) return { error: `${label} needs both numbers.` };
  const ignore = Number(s.ignore);
  const share = Number(s.share);
  if (ignore < 0 || share < 0 || share > 100) {
    return { error: `${label}: the share must be 0–100% and the gap to ignore 0 or more.` };
  }
  return { value: { ignore, share } };
}

/** Check scales from the settings page; returns `{ value }` or `{ error }`. */
export function cleanScales(input) {
  if (input == null) return { value: null };
  const s = resolveScales(input);

  const cols = s.occupancy?.cols;
  if (!Array.isArray(cols) || cols.length < 1 || cols.length > 8) {
    return { error: "The occupancy table needs between 1 and 8 day columns." };
  }
  const cleanCols = [];
  let prev = -1;
  for (let i = 0; i < cols.length; i++) {
    if (i === cols.length - 1) {
      cleanCols.push(null);
      break;
    }
    if (!isNum(cols[i]) || Number(cols[i]) <= prev) {
      return { error: "Day columns must go up from left to right." };
    }
    prev = Number(cols[i]);
    cleanCols.push(prev);
  }
  const occ = cleanBands(s.occupancy.rows, { width: cleanCols.length });
  if (occ.error) return occ;
  const pace = cleanBands(s.pace.rows);
  if (pace.error) return pace;
  const pickup = cleanBands(s.pickup.rows);
  if (pickup.error) return pickup;
  const adr90 = cleanFollower(s.adr_90, "Last 90 days");
  if (adr90.error) return adr90;
  const adrLy = cleanFollower(s.adr_ly, "Last year, same date");
  if (adrLy.error) return adrLy;
  const wk = s.weekday?.pcts;
  if (!Array.isArray(wk) || wk.length !== 7 || !wk.every(isNum)) {
    return { error: "Each day of the week needs a % move, even if it is 0." };
  }

  return {
    value: {
      occupancy: { cols: cleanCols, rows: occ.value },
      pace: { rows: pace.value },
      pickup: { rows: pickup.value },
      adr_90: adr90.value,
      adr_ly: adrLy.value,
      weekday: { pcts: wk.map(Number) },
    },
  };
}

/** Check rules from the settings page; incomplete rows are dropped, not refused. */
export function cleanAdjustments(input) {
  if (input == null) return { value: null };
  const a = resolveAdjustments(input);
  const out = { last_minute: [], far_out: [], orphan_gaps: [] };

  for (const r of a.last_minute) {
    if (!isNum(r.within) && !isNum(r.value)) continue;
    if (!isNum(r.within) || Number(r.within) < 0 || !isNum(r.value)) {
      return { error: "Each close-to-arrival rule needs a number of days and a value." };
    }
    const type = ["pct", "gradual", "amount"].includes(r.type) ? r.type : "pct";
    if (type !== "amount" && (Number(r.value) < -90 || Number(r.value) > 500)) {
      return { error: "A rule must be between -90% and +500%." };
    }
    out.last_minute.push({ within: Math.round(Number(r.within)), type, value: Number(r.value) });
  }
  for (const r of a.far_out) {
    if (!isNum(r.beyond) && !isNum(r.value)) continue;
    if (!isNum(r.beyond) || Number(r.beyond) < 0 || !isNum(r.value)) {
      return { error: "Each far-ahead rule needs a number of days and a %." };
    }
    if (Number(r.value) < -90 || Number(r.value) > 500) {
      return { error: "A rule must be between -90% and +500%." };
    }
    out.far_out.push({ beyond: Math.round(Number(r.beyond)), value: Number(r.value) });
  }
  for (const r of a.orphan_gaps) {
    if (!isNum(r.nights) && !isNum(r.value)) continue;
    if (!isNum(r.nights) || Number(r.nights) < 1 || Number(r.nights) > 14 || !isNum(r.value)) {
      return { error: "Each short-gap rule needs a gap of 1–14 nights and a %." };
    }
    if (Number(r.value) < -90 || Number(r.value) > 500) {
      return { error: "A rule must be between -90% and +500%." };
    }
    out.orphan_gaps.push({ nights: Math.round(Number(r.nights)), value: Number(r.value) });
  }
  return { value: out };
}
