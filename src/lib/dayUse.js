/**
 * Day use: a room taken for some hours of one day rather than for a night.
 *
 * The hotel offers a few slots (3, 6 and 9 hours unless it changes them), each
 * priced per room type as a fixed amount in room_types.day_use_rates. A
 * day-use stay arrives and leaves on the same date, so it holds no night: the
 * room is still sold for that night, and the channels are never told it is
 * taken. The hours run from when the guest is checked in, not from a time
 * booked in advance. See migration 048.
 *
 * Plain functions with no database access, so the booking form, the tape
 * chart and the server all read a day use the same way.
 */

export const DEFAULT_DAY_USE_HOURS = [3, 6, 9];

export function isDayUse(reservation) {
  return reservation?.stay_kind === "day_use";
}

/** A slot length the database accepts: a whole number of hours, 1 to 23. */
export function validDayUseHours(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 23 ? n : null;
}

/**
 * The hotel's slots, cleaned: whole hours, 1 to 23, each once, shortest first.
 * Accepts an array or the "3, 6, 9" the setup box holds. Nothing usable falls
 * back to the defaults, so the booking form always has a slot to offer.
 */
export function cleanDayUseHours(list) {
  const raw = Array.isArray(list) ? list : String(list ?? "").split(/[\s,]+/);
  const hours = [...new Set(raw.map(validDayUseHours).filter(Boolean))].sort((a, b) => a - b);
  return hours.length ? hours : [...DEFAULT_DAY_USE_HOURS];
}

/** "6 hrs", "1 hr". */
export function dayUseLabel(hours) {
  const n = Number(hours);
  return `${n} hr${n === 1 ? "" : "s"}`;
}

/** What a room type charges for a slot, or null when the hotel has set no price. */
export function dayUsePrice(roomType, hours) {
  const value = roomType?.day_use_rates?.[String(hours)];
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * When a checked-in day-use guest is due out: the check-in moment plus the
 * slot. Null until the guest is checked in, because the hours have not
 * started yet.
 */
export function dayUseDueOut(reservation) {
  if (!isDayUse(reservation) || !reservation.checked_in_at) return null;
  const hours = Number(reservation.day_use_hours);
  if (!hours) return null;
  return new Date(new Date(reservation.checked_in_at).getTime() + hours * 3600000);
}

/** "14:30", in the viewer's own clock -- the desk reads the time on the wall. */
export function clockTime(date) {
  if (!date) return "";
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * One line the desk reads at a glance: "Day use · 6 hrs", then once the guest
 * is in, "in 11:05 · due out 17:05" -- with "overdue" once that has passed
 * and they have not been checked out.
 */
export function dayUseSummary(reservation, now = new Date()) {
  if (!isDayUse(reservation)) return "";
  const base = `Day use · ${dayUseLabel(reservation.day_use_hours)}`;
  const due = dayUseDueOut(reservation);
  if (!due) return base;
  const inAt = clockTime(new Date(reservation.checked_in_at));
  const overdue = reservation.status === "in_house" && now > due;
  return `${base} · in ${inAt} · due out ${clockTime(due)}${overdue ? " (overdue)" : ""}`;
}
