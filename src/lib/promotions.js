/**
 * The booking engine's offers: promotions every guest who fits gets, and
 * coupon codes a guest types. No server imports, so the Booking Engine page
 * and the guest's page use the same rules the server prices with.
 *
 * A promotion has a type, which decides the one question that makes it what
 * it is:
 *   basic   no extra condition
 *   early   booked at least `days` days before arrival (early bird)
 *   last    booked at most `days` days before arrival (last minute)
 *   mobile  booked on a phone
 * and then the same conditions for all: check-in dates, booking dates,
 * blackout dates, days of the week, minimum and maximum nights, rate plans
 * and room types (none ticked means all), and percent or amount off.
 *
 * Blackout dates and days of the week work night by night: a percent comes
 * off only the nights that qualify, so one blackout night in a three-night
 * stay leaves two nights discounted. An amount comes off the stay once, if
 * any night qualifies.
 *
 * The guest gets the promotion (or long-stay step) worth the most, never two
 * of them. A coupon then comes off what is left, or, when the hotel says it
 * may not be added on top, is used only if it is worth more than the
 * promotion. Never more than MAX_OFF_SHARE of the room comes off.
 */

export const PROMOTION_TYPES = [
  { id: "basic", label: "Basic", hint: "Any guest who fits the dates and rooms" },
  { id: "early", label: "Early bird", hint: "Booked well before arrival" },
  { id: "last", label: "Last minute", hint: "Booked close to arrival" },
  { id: "mobile", label: "Mobile", hint: "Booked on a phone" },
];

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MAX_PROMOTIONS = 30;
export const MAX_COUPONS = 50;
export const MAX_BLACKOUTS = 60;
export const MAX_DISCOUNT_PERCENT = 90;
const MAX_OFF_SHARE = 0.9;

const text = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const iso = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const whole = (v, min, max) => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
};
const blank = (v) => v === null || v === undefined || String(v).trim() === "";
const idList = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => text(x, 40)).filter(Boolean))].slice(0, 50);
const round2 = (n) => Math.round(Number(n) * 100) / 100;

function cleanValue(kind, value) {
  const n = round2(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (kind === "percent") return n <= MAX_DISCOUNT_PERCENT ? n : null;
  return n <= 10000000 ? n : null;
}

/** The parts every offer shares: what comes off, and when and where it applies. */
function cleanTerms(p) {
  const kind = p?.kind === "amount" ? "amount" : "percent";
  return {
    kind,
    value: cleanValue(kind, p?.value ?? p?.percent),
    // Older promotions said "stay from / to"; they are read as check-in dates.
    checkInFrom: iso(p?.checkInFrom) || iso(p?.stayFrom),
    checkInTo: iso(p?.checkInTo) || iso(p?.stayTo),
    bookFrom: iso(p?.bookFrom),
    bookTo: iso(p?.bookTo),
    minNights: whole(p?.minNights, 1, 60),
    maxNights: whole(p?.maxNights, 1, 60),
    planIds: idList(p?.planIds?.length ? p.planIds : p?.planId ? [p.planId] : []),
    roomTypeIds: idList(p?.roomTypeIds),
    active: p?.active !== false,
  };
}

export function cleanPromotions(list) {
  return (Array.isArray(list) ? list : [])
    .map((p) => ({
      id: text(p?.id, 40) || `p${Math.random().toString(36).slice(2, 10)}`,
      name: text(p?.name, 60),
      type: PROMOTION_TYPES.some((t) => t.id === p?.type) ? p.type : "basic",
      days: whole(p?.days, 0, 365),
      weekdays: [...new Set((Array.isArray(p?.weekdays) ? p.weekdays : []).map(Number).filter((d) => d >= 0 && d <= 6))].sort(),
      blackout: [...new Set((Array.isArray(p?.blackout) ? p.blackout : []).map(iso).filter(Boolean))].sort().slice(0, MAX_BLACKOUTS),
      ...cleanTerms(p),
    }))
    .filter((p) => p.name && p.value)
    .slice(0, MAX_PROMOTIONS);
}

export function cleanCode(v) {
  return text(v, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Coupons. Promotions saved before coupons existed with a code of their own
 * are carried over as coupons that are not added on top, which is how they
 * behaved.
 */
export function cleanCoupons(list, oldPromotions = []) {
  const carried = (Array.isArray(oldPromotions) ? oldPromotions : [])
    .filter((p) => p?.code)
    .map((p) => ({ ...p, id: `c-${p.id || p.code}`, stack: false }));
  const seen = new Set();
  return [...(Array.isArray(list) ? list : []), ...carried]
    .map((c) => ({
      id: text(c?.id, 40) || `c${Math.random().toString(36).slice(2, 10)}`,
      code: cleanCode(c?.code),
      name: text(c?.name, 60),
      stack: c?.stack !== false,
      maxUses: whole(c?.maxUses, 1, 100000),
      ...cleanTerms(c),
    }))
    .filter((c) => {
      if (c.code.length < 2 || !c.value || seen.has(c.code)) return false;
      seen.add(c.code);
      return true;
    })
    .slice(0, MAX_COUPONS);
}

/** Promotions saved before coupons, without their codes: those are coupons now. */
export const promotionsWithoutCodes = (list) => (Array.isArray(list) ? list : []).filter((p) => !p?.code);

// ------------------------------------------------------------------
// Checks as the hotel types, so nothing is saved quietly as "any"
// ------------------------------------------------------------------

function termsProblem(p) {
  if (!cleanValue(p?.kind === "amount" ? "amount" : "percent", p?.value)) {
    return {
      field: "value",
      message: p?.kind === "amount" ? "Enter the amount off." : `Enter a discount between 1 and ${MAX_DISCOUNT_PERCENT}%.`,
    };
  }
  for (const f of ["minNights", "maxNights"]) {
    if (!blank(p?.[f]) && whole(p[f], 1, 60) == null) {
      return { field: f, message: "Nights are a number from 1 to 60, or blank for any." };
    }
  }
  if (whole(p?.minNights, 1, 60) && whole(p?.maxNights, 1, 60) && Number(p.maxNights) < Number(p.minNights)) {
    return { field: "maxNights", message: "Most nights is less than fewest nights." };
  }
  if (p?.checkInFrom && p?.checkInTo && p.checkInTo < p.checkInFrom) {
    return { field: "checkInTo", message: "The last check-in date is before the first." };
  }
  if (p?.bookFrom && p?.bookTo && p.bookTo < p.bookFrom) {
    return { field: "bookTo", message: "The last booking date is before the first." };
  }
  return null;
}

export function promotionProblem(p) {
  if (!text(p?.name, 60)) return { field: "name", message: "Give the offer a name guests will see." };
  if ((p?.type === "early" || p?.type === "last") && whole(p?.days, 0, 365) == null) {
    return {
      field: "days",
      message: p.type === "early" ? "Say how many days before arrival guests must book." : "Say how many days before arrival the offer starts.",
    };
  }
  if (p?.type === "early" && Number(p.days) < 1) return { field: "days", message: "Early bird needs at least 1 day." };
  return termsProblem(p);
}

export function couponProblem(c, others = []) {
  const code = cleanCode(c?.code);
  if (code.length < 2) return { field: "code", message: "A coupon code is 2 to 20 letters or numbers." };
  if (others.some((o) => o.id !== c.id && cleanCode(o.code) === code)) {
    return { field: "code", message: `There is already a coupon ${code}.` };
  }
  if (!blank(c?.maxUses) && whole(c.maxUses, 1, 100000) == null) {
    return { field: "maxUses", message: "Uses is a number, or blank for no limit." };
  }
  return termsProblem(c);
}

// ------------------------------------------------------------------
// In words, for the lists
// ------------------------------------------------------------------

export function offerAmount(o, money = (v) => String(v)) {
  return o.kind === "amount" ? `${money(o.value)} off` : `${o.value}% off`;
}

/** An offer's conditions in a line; one with no end date is flagged. */
export function offerWhen(o, day = (d) => d) {
  const parts = [];
  if (o.type === "early") parts.push(`booked ${o.days}+ days ahead`);
  if (o.type === "last") parts.push(`booked within ${o.days} days of arrival`);
  if (o.type === "mobile") parts.push("on a phone");
  if (o.checkInFrom || o.checkInTo) {
    parts.push(
      o.checkInFrom && o.checkInTo
        ? `check-in ${day(o.checkInFrom)} to ${day(o.checkInTo)}`
        : o.checkInFrom
          ? `check-in from ${day(o.checkInFrom)}`
          : `check-in until ${day(o.checkInTo)}`
    );
  }
  if (o.bookFrom || o.bookTo) {
    parts.push(
      o.bookFrom && o.bookTo
        ? `booked ${day(o.bookFrom)} to ${day(o.bookTo)}`
        : o.bookFrom
          ? `booked from ${day(o.bookFrom)}`
          : `booked until ${day(o.bookTo)}`
    );
  }
  if (o.weekdays?.length && o.weekdays.length < 7) parts.push(o.weekdays.map((d) => WEEKDAYS[d]).join(" "));
  if (o.minNights || o.maxNights) {
    parts.push(
      o.minNights && o.maxNights ? `${o.minNights} to ${o.maxNights} nights` : o.minNights ? `${o.minNights}+ nights` : `up to ${o.maxNights} nights`
    );
  }
  if (o.blackout?.length) parts.push(`${o.blackout.length} blackout date${o.blackout.length === 1 ? "" : "s"}`);
  const open = !o.checkInTo && !o.bookTo;
  return { text: parts.length ? parts.join(", ") : "Every date, no end", open };
}

// ------------------------------------------------------------------
// Pricing
// ------------------------------------------------------------------

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Whether the stay and the booking fit an offer's shared conditions. */
function fits(o, { planId, roomTypeId, stay, today }) {
  if (!o.active || !o.value) return false;
  if (o.planIds?.length && !o.planIds.includes(planId)) return false;
  if (o.roomTypeIds?.length && !o.roomTypeIds.includes(roomTypeId)) return false;
  const n = stay.nights.length;
  if (o.minNights && n < o.minNights) return false;
  if (o.maxNights && n > o.maxNights) return false;
  if (o.checkInFrom && stay.checkIn < o.checkInFrom) return false;
  if (o.checkInTo && stay.checkIn > o.checkInTo) return false;
  if (o.bookFrom && today < o.bookFrom) return false;
  if (o.bookTo && today > o.bookTo) return false;
  return true;
}

/** Money off a set of nights: a percent of the nights that qualify, or an amount once. */
function moneyOff(o, nights, eligible) {
  if (eligible.length === 0) return 0;
  if (o.kind === "amount") return Math.min(o.value, nights.reduce((s, n) => s + n.rate, 0));
  return eligible.reduce((s, n) => s + (n.rate * o.value) / 100, 0);
}

/**
 * What comes off one room and plan for a stay, before tax.
 *
 *   nights   [{ stay_date, rate }], the room's price night by night
 *   today    the hotel's date
 *   mobile   whether the guest is on a phone
 *   code     the coupon code the guest typed, if any
 *
 * Returns { amount, label, coupon } with coupon the code used, or null when
 * nothing comes off.
 */
export function offerDiscount(content, { planId, roomTypeId, stay, today, mobile = false, code = "", nights }) {
  const room = nights.reduce((s, n) => s + n.rate, 0);
  if (!(room > 0)) return null;
  const ctx = { planId, roomTypeId, stay, today };

  let best = null;
  for (const p of content.promotions || []) {
    if (!fits(p, ctx)) continue;
    const ahead = daysBetween(today, stay.checkIn);
    if (p.type === "early" && ahead < p.days) continue;
    if (p.type === "last" && ahead > p.days) continue;
    if (p.type === "mobile" && !mobile) continue;
    const blackout = new Set(p.blackout || []);
    const eligible = nights.filter(
      (n) => !blackout.has(n.stay_date) && (!p.weekdays?.length || p.weekdays.includes(weekdayOf(n.stay_date)))
    );
    const off = moneyOff(p, nights, eligible);
    if (off > 0 && (!best || off > best.amount)) best = { amount: off, label: p.name, kind: "promotion" };
  }
  for (const r of content.longStays || []) {
    if (stay.nights.length < r.nights) continue;
    const off = (room * r.percent) / 100;
    if (!best || off > best.amount) best = { amount: off, label: `Stay ${r.nights}+ nights`, kind: "long_stay" };
  }

  const typed = cleanCode(code);
  let coupon = null;
  if (typed) {
    const c = (content.coupons || []).find((x) => x.code === typed);
    if (c && fits(c, ctx)) {
      const base = c.stack && best ? room - best.amount : room;
      const off = c.kind === "amount" ? Math.min(c.value, base) : (base * c.value) / 100;
      if (off > 0) coupon = { amount: off, code: c.code, stack: c.stack, label: c.name || `Code ${c.code}` };
    }
  }

  let amount = best?.amount || 0;
  let label = best?.label || null;
  let kind = best?.kind || null;
  let used = null;
  if (coupon) {
    if (coupon.stack) {
      amount += coupon.amount;
      label = label ? `${label} + ${coupon.code}` : coupon.label;
      kind = kind || "promotion";
      used = coupon.code;
    } else if (coupon.amount > amount) {
      amount = coupon.amount;
      label = coupon.label;
      kind = "promotion";
      used = coupon.code;
    }
  }
  amount = round2(Math.min(amount, room * MAX_OFF_SHARE));
  if (!(amount > 0)) return null;
  return { amount, label, kind, coupon: used, percent: Math.round((amount / room) * 100) };
}

/**
 * What happened to the code a guest typed, for the line under the search:
 * "applied" when it priced at least one room, "unused" when it is real but
 * not for this stay, "unknown" when there is no such coupon.
 */
export function codeOutcome(content, code, applied) {
  const typed = cleanCode(code);
  if (!typed) return null;
  if (applied) return "applied";
  return (content.coupons || []).some((c) => c.active && c.code === typed) ? "unused" : "unknown";
}

/** Whether the hotel has any coupon a guest could type. */
export const hasCoupons = (content) => (content.coupons || []).some((c) => c.active);
