/**
 * A hotel's own clock.
 *
 * Every hotel has a time zone of its own (properties.timezone, an IANA name
 * such as "Asia/Kolkata" or "America/New_York"), picked by the hotel at
 * sign-up and in Property Setup. "Today", the night audit's day, a payment's
 * day and the time on a check-in are all read on that clock -- never on the
 * server's, which runs on UTC, and never on the browser's, which is wherever
 * the person happens to be sitting.
 *
 * Zones rather than fixed offsets, because offsets move: a hotel in London
 * is UTC+0 in January and UTC+1 in July, and a day cut at the wrong hour
 * puts an evening's payments on the next day's audit.
 *
 * Shared by the server and the browser. In the browser the zone of the hotel
 * being worked on is set once, when the session loads (setHotelZone), so the
 * many small "is this today?" questions do not each need it passed down.
 */

/** Every hotel signed up before zones existed is in India. */
export const DEFAULT_ZONE = "Asia/Kolkata";

const formatters = new Map();

function partsFormatter(zone) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

/** True for a zone name this machine's Intl data knows. */
export function isZone(zone) {
  if (typeof zone !== "string" || !zone) return false;
  try {
    partsFormatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** The zone itself when it is a real one, otherwise the default. */
export function zoneOr(zone) {
  return isZone(zone) ? zone : DEFAULT_ZONE;
}

/** The wall clock in `zone` at an instant, as numbers. */
function wallClock(at, zone) {
  const out = {};
  for (const p of partsFormatter(zoneOr(zone)).formatToParts(at)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

/** Minutes `zone` is ahead of UTC at an instant: India is 330, New York -300 or -240. */
export function offsetMinutes(zone, at = new Date()) {
  const w = wallClock(at, zone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

const pad = (n) => String(n).padStart(2, "0");

/** The hotel's date (YYYY-MM-DD) at a stored moment. */
export function dayInZone(ts, zone) {
  if (!ts) return null;
  const at = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(at.getTime())) return null;
  const w = wallClock(at, zone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Today, on the hotel's clock. */
export function todayInZone(zone) {
  return dayInZone(new Date(), zone);
}

/** Minutes since the hotel's midnight, now: for "is that slot still ahead?". */
export function minutesNowInZone(zone) {
  const w = wallClock(new Date(), zone);
  return w.hour * 60 + w.minute;
}

/**
 * The instant a hotel's day begins, as a UTC timestamp to filter on.
 *
 * Found by trying the offset at UTC midnight and then the offset at the
 * answer, which settles it even on the day the clocks change.
 */
export function zoneDayStart(iso, zone) {
  const guess = Date.parse(`${iso}T00:00:00Z`);
  let t = guess - offsetMinutes(zone, new Date(guess)) * 60000;
  const again = guess - offsetMinutes(zone, new Date(t)) * 60000;
  if (again !== t) t = again;
  return new Date(t).toISOString();
}

/** "(GMT+05:30)" for a zone, now. */
export function gmtLabel(zone) {
  const m = offsetMinutes(zone);
  const sign = m < 0 ? "-" : "+";
  const a = Math.abs(m);
  return `GMT${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Every zone, ordered by offset then name, for the picker. */
export function zoneOptions() {
  let names = [];
  try {
    names = Intl.supportedValuesOf("timeZone");
  } catch {
    names = [DEFAULT_ZONE];
  }
  if (!names.includes(DEFAULT_ZONE)) names = [DEFAULT_ZONE, ...names];
  return names
    .map((zone) => ({ value: zone, offset: offsetMinutes(zone), label: `${zone.replace(/_/g, " ")} (${gmtLabel(zone)})` }))
    .sort((a, b) => a.offset - b.offset || a.value.localeCompare(b.value));
}

/** The browser's own zone, as a first suggestion at sign-up. */
export function browserZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isZone(zone) ? zone : "";
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------
// The hotel being worked on, in the browser
// ------------------------------------------------------------------

let currentZone = DEFAULT_ZONE;

/** Called when the session loads or the hotel is switched. */
export function setHotelZone(zone) {
  currentZone = zoneOr(zone);
}

/** The zone of the hotel open in this tab. */
export function hotelZone() {
  return currentZone;
}

/** Today at the hotel open in this tab. */
export function hotelToday() {
  return todayInZone(currentZone);
}
