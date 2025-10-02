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
