/**
 * Occupancy colours on the date headers of the Calendar and Rates & Inventory.
 *
 * Each hotel decides whether it wants them at all, on which grids, where the
 * levels start and what colour each level is -- nothing here is pushed on a
 * property. Stored in properties.display_prefs.demand (migration 044); a
 * property that has never saved gets these defaults, which are switched off.
 *
 * The level is the hotel's whole house on that night: rooms sold so far over
 * rooms that can be sold. It is what is on the books, not a forecast -- the
 * Dynamic Pricing year strip is the forecast view.
 */

export const DEMAND_LEVELS = [
  { id: "low", label: "Low" },
  { id: "normal", label: "Normal" },
  { id: "good", label: "Good" },
  { id: "high", label: "High" },
];

/** One green from light to dark, so busier reads as darker without a key. */
export const DEFAULT_DEMAND = {
  enabled: false,
  calendar: true,
  cm: true,
  // Where Normal, Good and High start, in percent sold.
  thresholds: [40, 65, 85],
  colours: { low: "#f0fdf4", normal: "#bbf7d0", good: "#4ade80", high: "#15803d" },
};

const HEX = /^#[0-9a-f]{6}$/i;

/** The settings as sent, made safe to store: unknown keys dropped, numbers clamped. */
export function cleanDemand(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = {
    enabled: src.enabled === true,
    calendar: src.calendar !== false,
    cm: src.cm !== false,
    thresholds: [...DEFAULT_DEMAND.thresholds],
    colours: { ...DEFAULT_DEMAND.colours },
  };
  if (Array.isArray(src.thresholds) && src.thresholds.length === 3) {
    const t = src.thresholds.map((n) => Math.round(Number(n)));
    if (t.every((n) => Number.isFinite(n) && n >= 1 && n <= 100) && t[0] < t[1] && t[1] < t[2]) {
      out.thresholds = t;
    }
  }
  for (const { id } of DEMAND_LEVELS) {
    const c = src.colours?.[id];
    if (typeof c === "string" && HEX.test(c)) out.colours[id] = c.toLowerCase();
  }
  return out;
}

/** Why a set of thresholds cannot be saved, or null. */
export function thresholdProblem(thresholds) {
  const [a, b, c] = thresholds.map(Number);
  if (![a, b, c].every((n) => Number.isFinite(n) && n >= 1 && n <= 100)) {
    return "Each level must start between 1% and 100%.";
  }
  if (!(a < b && b < c)) return "Each level must start higher than the one before it.";
  return null;
}

export function levelFor(pct, thresholds) {
  if (pct >= thresholds[2]) return "high";
  if (pct >= thresholds[1]) return "good";
  if (pct >= thresholds[0]) return "normal";
  return "low";
}

/** "40–65%" style range for each level, for the key and the settings card. */
export function levelRanges(thresholds) {
  const [a, b, c] = thresholds;
  return { low: `under ${a}%`, normal: `${a}-${b}%`, good: `${b}-${c}%`, high: `${c}%+` };
}

/** Dark or light text, whichever reads on the hotel's chosen colour. */
export function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#111827" : "#ffffff";
}

/**
 * How one date header looks: its tint, the ink on it and what it says on
 * hover. Null when the date has no rooms to sell, so it keeps its usual look.
 */
export function demandFor(prefs, sold, capacity) {
  if (!capacity || capacity <= 0) return null;
  const pct = Math.round((sold / capacity) * 100);
  const level = levelFor(pct, prefs.thresholds);
  const bg = prefs.colours[level];
  const label = DEMAND_LEVELS.find((l) => l.id === level).label;
  return {
    pct,
    level,
    background: bg,
    color: inkOn(bg),
    title: `${sold} of ${capacity} sold, ${pct}%, ${label}`,
  };
}
