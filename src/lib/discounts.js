/**
 * A booking's discount (migration 063).
 *
 * One discount per booking, as a percent or a fixed amount, given either
 * before tax or after it:
 *
 *   before_tax  comes off the room charge. Every night is lowered by the same
 *               share, and tax is worked out on the lowered price -- so a
 *               night can drop into a lower GST slab, as the law reads it.
 *   after_tax   the desk's "this much off the final bill". Saved as the money
 *               off the room before tax that brings the bill down by that
 *               much (see setReservationDiscount), because GST is charged on
 *               what the guest pays. Older bookings saved with it still read
 *               it as money off the bill, so their invoices do not change.
 *
 * A website offer that comes off some nights only (Saturdays, say) keeps the
 * money off each night in `discount_by_night` (migration 067), so each night
 * is taxed on its own price, as the law reads it. The desk's discounts, and
 * offers that come off every night alike, leave it empty.
 *
 * Pure: the folio, the invoice and every report call it, so the discount the
 * desk sees is the one the reports count. The current discount is on the
 * reservation; every change to it is also written to `reservation_discounts`,
 * which is never edited or deleted.
 */

export const DISCOUNT_REASONS = [
  { id: 'repeat_guest', label: 'Repeat guest' },
  { id: 'complaint', label: 'Complaint' },
  { id: 'long_stay', label: 'Long stay' },
  // Given by the booking engine's promotions, never picked by the desk.
  { id: 'promotion', label: 'Website promotion' },
  { id: 'manager', label: 'Manager approved' },
  { id: 'other', label: 'Other' },
];

export const DISCOUNT_TIMINGS = [
  { id: 'before_tax', label: 'Before tax' },
  { id: 'after_tax', label: 'After tax' },
];

/** The right, in User rights, to give or change a discount. */
export const DISCOUNT_RIGHT = 'discounts';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function reasonLabel(id) {
  return DISCOUNT_REASONS.find((r) => r.id === id)?.label || id || '';
}

/** The discount on a booking, or null when it has none. */
export function discountOf(reservation) {
  const kind = reservation?.discount_kind;
  const value = Number(reservation?.discount_value) || 0;
  if ((kind !== 'percent' && kind !== 'amount') || value <= 0) return null;
  return {
    kind,
    value,
    timing: reservation.discount_timing === 'after_tax' ? 'after_tax' : 'before_tax',
    reason: reservation.discount_reason || null,
    note: reservation.discount_note || null,
  };
}

/** Money off `base`: a percent of it, or a fixed amount, never more than it. */
export function discountAmount(discount, base) {
  if (!discount || !(base > 0)) return 0;
  const off = discount.kind === 'percent' ? (base * Math.min(100, discount.value)) / 100 : discount.value;
  return round2(Math.min(base, off));
}

/** Money off each night, { date: amount }, when the discount is not the same share of every night; else null. */
export function discountByNight(reservation) {
  const by = reservation?.discount_by_night;
  if (!by || typeof by !== 'object' || discountOf(reservation)?.timing !== 'before_tax') return null;
  return Object.keys(by).length ? by : null;
}

/**
 * The share of each night's rate a before-tax discount leaves: 0.9 for 10%
 * off. 1 when there is no before-tax discount. Reports multiply a night's
 * rate by it to count room revenue net of the discount; a discount kept by
 * night is priced night by night with `chargedRate` instead.
 */
export function roomKeep(reservation, room = Number(reservation?.total_amount) || 0) {
  const d = discountOf(reservation);
  if (!d || d.timing !== 'before_tax' || !(room > 0)) return 1;
  const by = discountByNight(reservation);
  const off = by ? Object.values(by).reduce((s, v) => s + (Number(v) || 0), 0) : discountAmount(d, room);
  return Math.max(0, room - off) / room;
}

/** A night's rate as charged before tax: less its own money off when kept by night, else the same share off. */
export function chargedRate(rate, date, keep = 1, nightOff = null) {
  if (nightOff) return rate - Math.min(Number(nightOff[date]) || 0, rate);
  return rate * keep;
}

/** "10%" or the amount, for a label. `money` formats the amount. */
export function describeDiscount(discount, money = (v) => String(v)) {
  if (!discount) return '';
  const what = discount.kind === 'percent' ? `${discount.value}%` : money(discount.value);
  return `${what} ${discount.timing === 'after_tax' ? 'after tax' : 'before tax'}`;
}
