import { hotelZone, minutesNowInZone } from "@/lib/hotelTime";

/**
 * Day use: a room taken for some hours of one day rather than for a night.
 *
 * A day use is sold on a day-use rate plan -- a plan carrying how many hours
 * it sells (rate_plans.day_use_hours), one plan per slot. Its price comes from
 * that plan's rate for the date, like any other plan, and channels sell it
 * under the plan's code. See migrations 048 and 049.
 *
 * A day-use stay arrives and leaves on the same date, so it holds no night
 * (no reservation_nights row). It still takes a room off sale for its date,
 * from the moment it is booked until the guest checks out: the check-out
 * gives the room back so it can be sold for the night.
 *
 * A day use is booked for a start time (day_use_start, "10:00", mig 050), so
 * two can share a room on one date one after the other. Once the guest is
 * checked in, the hours run from the actual check-in instead.
 *
 * Plain functions with no database access, so the booking form, the tape
 * chart and the server all read a day use the same way.
 */

export function isDayUse(reservation) {
  return reservation?.stay_kind === "day_use";
}

/** A slot length the database accepts: a whole number of hours, 1 to 23. */
export function validDayUseHours(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 23 ? n : null;
}

/** Whether a rate plan sells day use rather than nights. */
export function isDayUsePlan(plan) {
  return validDayUseHours(plan?.day_use_hours) != null;
}

/**
 * The statuses in which a day use holds its room off sale. A checked-out day
 * use has handed the room back; cancelled and no-show never held it.
 */
export const DAY_USE_HOLDING_STATUSES = ["inquiry", "confirmed", "in_house"];

/** The statuses in which an overnight stay holds its nights. */
const NIGHT_HOLDING_STATUSES = ["inquiry", "confirmed", "in_house", "checked_out"];

/** Whether a booking in this status takes a room off sale. */
export function holdsInventory(reservation, status = reservation?.status) {
  return (isDayUse(reservation) ? DAY_USE_HOLDING_STATUSES : NIGHT_HOLDING_STATUSES).includes(
    status
  );
}

/** "6 hrs", "1 hr". */
export function dayUseLabel(hours) {
  const n = Number(hours);
  return `${n} hr${n === 1 ? "" : "s"}`;
}

/** Minutes after midnight for "HH:MM" (or "HH:MM:SS"), or null. */
export function parseClock(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value || ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

/** 600 -> "10:00", the form the database stores. */
export function toClock(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 870 -> "2:30 PM"; 1440 -> "12:00 AM", the midnight a slot can end at. */
export function formatMinutes(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** 870 -> "2:30p", 600 -> "10a": short enough for a bar on the chart. */
export function shortMinutes(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${h24 % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h24 < 12 ? "a" : "p"}`;
}

/** The earliest start offered, and the step between offered starts. */
export const DAY_USE_FIRST_START = 6 * 60;
export const DAY_USE_STEP = 30;

/**
 * The start times a slot of this many hours can be booked at: every half
 * hour from 6 AM to the last start that still ends by midnight.
 */
export function dayUseStartOptions(hours) {
  const length = (validDayUseHours(hours) || 1) * 60;
  const out = [];
  for (let t = DAY_USE_FIRST_START; t + length <= 24 * 60; t += DAY_USE_STEP) out.push(t);
  return out;
}

/** A booked start the database accepts for a slot this long, or null. */
export function validDayUseStart(value, hours) {
  const start = parseClock(value);
  const h = validDayUseHours(hours);
  if (start == null || !h) return null;
  return start + h * 60 <= 24 * 60 ? toClock(start) : null;
}

/**
 * A day use's booked slot in minutes after midnight, { start, end }, or null
 * when it was booked without a time.
 */
export function dayUseWindow(reservation) {
  if (!isDayUse(reservation)) return null;
  const start = parseClock(reservation.day_use_start);
  const hours = validDayUseHours(reservation.day_use_hours);
  if (start == null || !hours) return null;
  return { start, end: start + hours * 60 };
}

/** "10:00 AM – 1:00 PM", or "" with no booked time. */
export function dayUseWindowLabel(reservation) {
  const w = dayUseWindow(reservation);
  return w ? `${formatMinutes(w.start)} to ${formatMinutes(w.end)}` : "";
}

/** Whether two slots ({ start, end }) share any minute. */
export function windowsOverlap(a, b) {
  return Boolean(a && b) && a.start < b.end && b.start < a.end;
}

/**
 * The first start a new day use can take without clashing with `taken`
 * slots: from the next half hour (on the hotel's clock) when the date is
 * today, from 10 AM on any other date. Null when nothing that day is free.
 */
export function suggestDayUseStart(hours, { taken = [], isToday = false, nowMinutes = minutesNowInZone(hotelZone()) } = {}) {
  const options = dayUseStartOptions(hours);
  const length = (validDayUseHours(hours) || 1) * 60;
  const from = isToday ? nowMinutes : 10 * 60;
  const free = (t) => !taken.some((w) => windowsOverlap({ start: t, end: t + length }, w));
  const pick = options.find((t) => t >= from && free(t));
  // Late in the day the hour may be past every slot; an earlier free one is
  // still a better default than none (the desk may be booking for later).
  return pick ?? options.find(free) ?? null;
}

/**
 * When a day-use guest is due out: the check-in moment plus the slot once
 * they are in, so an early or late arrival moves it.
 */
export function dayUseDueOut(reservation) {
  if (!isDayUse(reservation) || !reservation.checked_in_at) return null;
  const hours = Number(reservation.day_use_hours);
  if (!hours) return null;
  return new Date(new Date(reservation.checked_in_at).getTime() + hours * 3600000);
}

/** "2:30 PM", on the hotel's clock -- the desk reads the time on the wall. */
export function clockTime(date) {
  if (!date) return "";
  return date.toLocaleTimeString("en-IN", { timeZone: hotelZone(), hour: "numeric", minute: "2-digit", hour12: true });
}

/**
 * One line the desk reads at a glance: "Day use · 3 hrs · 10:00 AM – 1:00 PM",
 * then once the guest is in, "in 10:05 AM · due out 1:05 PM" -- with
 * "overdue" once that has passed and they have not been checked out.
 */
export function dayUseSummary(reservation, now = new Date()) {
  if (!isDayUse(reservation)) return "";
  const slot = dayUseWindowLabel(reservation);
  const base = `Day use, ${dayUseLabel(reservation.day_use_hours)}${slot ? `, ${slot}` : ""}`;
  const due = dayUseDueOut(reservation);
  if (!due) return base;
  const inAt = clockTime(new Date(reservation.checked_in_at));
  const overdue = reservation.status === "in_house" && now > due;
  return `${base}, in ${inAt}, due out ${clockTime(due)}${overdue ? " (overdue)" : ""}`;
}
