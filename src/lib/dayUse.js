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
 * gives the room back so it can be sold for the night. The hours run from
 * when the guest is checked in, not from a time booked in advance.
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
