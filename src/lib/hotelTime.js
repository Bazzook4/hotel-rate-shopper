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
 * A hotel's day does not end at midnight but at its night audit: until then
 * the desk is still working the day before -- a walk-in at 1am is tonight's
 * stay, a payment at 1am is on that day's audit. So "today" is the business
 * day, which changes over at the hotel's day-change time
 * (properties.day_change_time, 2:30 AM unless the hotel sets another). A
 * clock is the zone and that time together: { zone, dayStart } with
 * dayStart in minutes after midnight. Anything that takes a clock also takes
 * a bare zone name, which is a day that changes at midnight -- the calendar
 * date, which the channels and the police register want.
 *
 * Shared by the server and the browser. In the browser the clock of the
 * hotel being worked on is set once, when the session loads (setHotelZone,
 * setHotelDayStart), so the many small "is this today?" questions do not
 * each need it passed down.
 */

/** Every hotel signed up before zones existed is in India. */
export const DEFAULT_ZONE = "Asia/Kolkata";

/** The business day changes at 2:30 AM unless the hotel says otherwise. */
export const DEFAULT_DAY_START = 150;

/** The latest a day may change over: 6 AM, when the morning shift starts. */
export const MAX_DAY_START = 360;

const pad = (n) => String(n).padStart(2, "0");

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

/** "02:30" or "02:30:00" (a Postgres time) -> 150. Null when it is not a usable time. */
export function parseDayStart(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value ?? ""));
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[2]) < 60 && minutes >= 0 && minutes <= MAX_DAY_START ? minutes : null;
}

/** 150 -> "02:30", as stored. */
export function dayStartValue(minutes) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** 150 -> "2:30 AM"; 0 -> "Midnight". */
export function dayStartLabel(minutes) {
  if (!minutes) return "Midnight";
  const h = Math.floor(minutes / 60);
  return `${h === 0 ? 12 : h}:${pad(minutes % 60)} AM`;
}

/** A zone name or a clock, as a clock. A bare zone changes day at midnight. */
export function clockOf(tz) {
  if (tz && typeof tz === "object") {
    const start = Number(tz.dayStart);
    return { zone: zoneOr(tz.zone), dayStart: Number.isFinite(start) ? start : 0 };
  }
  return { zone: zoneOr(tz), dayStart: 0 };
}

/** The wall clock in `zone` at an instant, as numbers. */
function wallClock(at, zone) {
  const out = {};
  for (const p of partsFormatter(clockOf(zone).zone).formatToParts(at)) {
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

/**
 * The hotel's day (YYYY-MM-DD) at a stored moment. With a clock it is the
 * business day, so 1am belongs to the day before a 2:30 AM change-over.
 */
export function dayInZone(ts, clock) {
  if (!ts) return null;
  const at = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(at.getTime())) return null;
  const { zone, dayStart } = clockOf(clock);
  const w = wallClock(new Date(at.getTime() - dayStart * 60000), zone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Today, on the hotel's clock. */
export function todayInZone(clock) {
  return dayInZone(new Date(), clock);
}

/** Minutes since the hotel's midnight, now: for "is that slot still ahead?". */
export function minutesNowInZone(zone) {
  const w = wallClock(new Date(), zone);
  return w.hour * 60 + w.minute;
}

/**
 * The instant a hotel's day begins, as a UTC timestamp to filter on: its
 * midnight, or with a clock its day-change time.
 *
 * Found by trying the offset at that wall time read as UTC and then the
 * offset at the answer, which settles it even on the day the clocks change.
 */
export function zoneDayStart(iso, clock) {
  const { zone, dayStart } = clockOf(clock);
  const guess = Date.parse(`${iso}T00:00:00Z`) + dayStart * 60000;
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

/** Half-hour steps from midnight to 6 AM, for the day-change picker. */
export function dayStartOptions() {
  const out = [];
  for (let m = 0; m <= MAX_DAY_START; m += 30) out.push({ value: dayStartValue(m), label: dayStartLabel(m) });
  return out;
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
let currentDayStart = DEFAULT_DAY_START;

/** Called when the session loads or the hotel is switched. */
export function setHotelZone(zone) {
  currentZone = zoneOr(zone);
}

/** Called with the hotel's day-change time ("02:30") alongside its zone. */
export function setHotelDayStart(value) {
  currentDayStart = parseDayStart(value) ?? DEFAULT_DAY_START;
}

/** The zone of the hotel open in this tab, for showing times. */
export function hotelZone() {
  return currentZone;
}

/** The business day at the hotel open in this tab: it changes at the night audit time. */
export function hotelToday() {
  return todayInZone({ zone: currentZone, dayStart: currentDayStart });
}
