export function formatDateISO(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function parseDateISO(value) {
  if (!value) return null;
  const parts = value.split("-").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

export function addDays(date, amount) {
  const base = date instanceof Date ? date : parseDateISO(date);
  if (!base || Number.isNaN(base.getTime())) return null;
  const next = new Date(base.getTime());
  next.setDate(next.getDate() + amount);
  return next;
}

/**
 * Today, as the rate data service reckons it.
 *
 * Google rejects a check-in before today, and "today" is ambiguous across a
 * timezone boundary: after 18:30 IST a browser sends a date the UTC server
 * still considers yesterday. Both sides therefore agree on UTC rather than on
 * whichever machine happened to answer.
 */
export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A stay date no earlier than today.
 *
 * Applied to anything sent to the rate service, since a window that starts in
 * the past fails the whole request rather than skipping the dead dates.
 */
export function clampToToday(dateISO) {
  const today = todayUTC();
  if (!dateISO) return today;
  return dateISO < today ? today : dateISO;
}
