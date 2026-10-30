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
 *   long    a long stay: a set number of nights or more
 * and then the same conditions for all: check-in dates, booking dates,
 * blackout dates, days of the week, minimum and maximum nights, rate plans
 * and room types (none ticked means all), and percent or amount off.
 *
 * Blackout dates and days of the week work night by night: a percent comes
 * off only the nights that qualify, so one blackout night in a three-night
 * stay leaves two nights discounted. An amount comes off the stay once, if
 * any night qualifies.
 *
 * Combining follows Booking.com's way. Offers fall in two groups:
 *   deals     basic, early bird, last minute, long stay -- never combined
 *             with each other; the guest gets the one worth most
 *   targeted  mobile and coupon codes -- each added on top of the best deal,
 *             one after the other, off the price that is left (10% then 10%
 *             is 19%), unless the hotel switched "Combine" off for it, when
 *             it competes with the deal instead and the bigger one wins
 * Whatever combines, the total never passes the hotel's "Most off in total"
 * (offerRules.maxTotalPercent), and never MAX_OFF_SHARE of the room.
 */

export const PROMOTION_TYPES = [
  { id: "basic", label: "Basic", hint: "Any guest who fits the dates and rooms" },
  { id: "early", label: "Early bird", hint: "Booked well before arrival" },
  { id: "last", label: "Last minute", hint: "Booked close to arrival" },
  { id: "mobile", label: "Mobile", hint: "Booked on a phone" },
  { id: "long", label: "Long stay", hint: "Staying a set number of nights or more" },
];

/** The types the Offers tab offers: the promotion types, and a coupon code. */
export const OFFER_TYPES = [...PROMOTION_TYPES, { id: "coupon", label: "Coupon code", hint: "A code the guest types, which you give out" }];

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MAX_PROMOTIONS = 30;
export const MAX_COUPONS = 50;
export const MAX_BLACKOUTS = 60;
export const MAX_DISCOUNT_PERCENT = 90;

/** The types that are deals; the rest (mobile, coupons) are targeted and may combine. */
export const DEAL_TYPES = new Set(["basic", "early", "last", "long"]);
export const isTargeted = (o) => o.type === "coupon" || o.type === "mobile" || Boolean(o.code);

/** The hotel's rule over all offers: the most that may come off in total, as a percent. */
export function cleanOfferRules(raw) {
  const n = Math.round(Number(raw?.maxTotalPercent));
  return { maxTotalPercent: Number.isFinite(n) && n >= 1 && n <= MAX_DISCOUNT_PERCENT ? n : null };
}
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

/**
 * Long-stay steps saved before they were offers ({ nights, percent }) are
 * read as Long stay promotions.
 */
export function longStaysAsPromotions(longStays) {
  return (Array.isArray(longStays) ? longStays : [])
    .filter((r) => r?.nights && r?.percent)
    .map((r) => ({
      id: `long-${r.nights}`,
      name: `Stay ${r.nights}+ nights`,
      type: "long",
      kind: "percent",
      value: r.percent,
      minNights: r.nights,
    }));
}

export function cleanPromotions(list) {
  return (Array.isArray(list) ? list : [])
    .map((p) => ({
      id: text(p?.id, 40) || `p${Math.random().toString(36).slice(2, 10)}`,
      name: text(p?.name, 60),
      type: PROMOTION_TYPES.some((t) => t.id === p?.type) ? p.type : "basic",
      days: whole(p?.days, 0, 365),
      weekdays: [...new Set((Array.isArray(p?.weekdays) ? p.weekdays : []).map(Number).filter((d) => d >= 0 && d <= 6))].sort(),
      // Only a mobile offer combines; deals never do. Mobile offers saved
      // before combining existed competed with the deal, so they still do.
      stack: p?.type === "mobile" ? p?.stack === true : false,
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
      // Coupons always combined unless told not to, so a missing setting combines.
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
  if (p?.type === "long" && (whole(p?.minNights, 2, 60) == null)) {
    return { field: "minNights", message: "Say how many nights or more, from 2 to 60." };
  }
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
  const ahead = daysBetween(today, stay.checkIn);

  /** The nights one promotion is for: not its blackout dates, and only its days of the week. */
  const nightsFor = (p) => {
    const blackout = new Set(p.blackout || []);
    return nights.filter(
      (n) => !blackout.has(n.stay_date) && (!p.weekdays?.length || p.weekdays.includes(weekdayOf(n.stay_date)))
    );
  };

  // The best deal, and the best mobile offer, each priced on the full room.
  let deal = null;
  let phone = null;
  for (const p of content.promotions || []) {
    if (!fits(p, ctx)) continue;
    if (p.type === "early" && ahead < p.days) continue;
    if (p.type === "last" && ahead > p.days) continue;
    if (p.type === "mobile" && !mobile) continue;
    const eligible = nightsFor(p);
    const off = moneyOff(p, nights, eligible);
    if (!(off > 0)) continue;
    const found = {
      id: p.id,
      amount: off,
      label: p.name,
      kind: p.type === "long" ? "long_stay" : "promotion",
      stack: p.stack,
      fixed: p.kind === "amount",
      dates: eligible.map((n) => n.stay_date),
    };
    if (p.type === "mobile") {
      if (!phone || off > phone.amount) phone = found;
    } else if (!deal || off > deal.amount) {
      deal = found;
    }
  }

  const typed = cleanCode(code);
  const c = typed ? (content.coupons || []).find((x) => x.code === typed && fits(x, ctx)) : null;
  const coupon = c
    ? {
        id: c.id,
        coupon: c.code,
        label: c.name || `Coupon ${c.code}`,
        stack: c.stack,
        take: (left) => (c.kind === "amount" ? Math.min(c.value, left) : (left * c.value) / 100),
      }
    : null;

  // The deal first, then each targeted offer: on top of what is left when it
  // combines, or in place of everything so far when it is worth more and does not.
  let amount = deal?.amount || 0;
  let parts = deal ? [{ ...deal, share: deal.amount }] : [];
  const addTargeted = (t, takeFromLeft) => {
    if (!t) return;
    const alone = takeFromLeft(room);
    if (t.stack) {
      const share = takeFromLeft(room - amount);
      if (share > 0) {
        amount += share;
        parts = [...parts, { ...t, share }];
      }
    } else if (alone > amount) {
      amount = alone;
      parts = [{ ...t, share: alone }];
    }
  };
  // A fixed amount comes off whole, like a coupon; a percent off what is left.
  addTargeted(phone, (left) => (phone.fixed ? Math.min(phone.amount, left) : (phone.amount * left) / room));
  addTargeted(coupon, (left) => coupon.take(left));

  // The limit is taken off the last offers first; one left with nothing is
  // dropped, so a coupon that saved nothing is not shown or counted as used.
  const capPercent = Math.min(MAX_OFF_SHARE * 100, content.offerRules?.maxTotalPercent || 100);
  const limit = (room * capPercent) / 100;
  const capped = amount > limit + 0.005;
  let room2 = Math.min(amount, limit);
  parts = parts
    .map((p) => {
      const share = Math.min(p.share, room2);
      room2 -= share;
      return { ...p, share };
    })
    .filter((p) => p.share >= 0.005);
  amount = round2(Math.min(amount, limit));
  if (!(amount > 0)) return null;
  const byNight = splitByNight(nights, parts, amount);
  // Each step rounded, the last one taking the pennies so they add up.
  const steps = parts.map((p) => ({ id: p.id, label: p.coupon ? `Coupon ${p.coupon}` : p.label, amount: round2(p.share) }));
  if (steps.length > 1) steps[steps.length - 1].amount = round2(amount - steps.slice(0, -1).reduce((s, x) => s + x.amount, 0));
  return {
    amount,
    label: parts.map((p) => (p.coupon ? (parts.length > 1 ? p.coupon : p.label) : p.label)).join(" + "),
    // Long stay only when it came off alone; any mix is filed as a promotion.
    kind: parts.length === 1 && parts[0].kind === "long_stay" ? "long_stay" : "promotion",
    coupon: parts.find((p) => p.coupon)?.coupon || null,
    percent: Math.round((amount / room) * 100),
    capped,
    capPercent,
    // Each offer that came off, in order, with what it took, for the simulator.
    steps,
    // Money off each night, when it is not the same share of every night.
    byNight,
  };
}

/**
 * What comes off each night, { date: amount }, so each night is taxed on its
 * own price: a Saturday-only offer comes off Saturday. Each offer is shared
 * over its own nights by what is left of them. Null when every night loses
 * the same share, which the bill already works out.
 */
function splitByNight(nights, parts, amount) {
  const room = nights.reduce((s, n) => s + n.rate, 0);
  const all = nights.map((n) => n.stay_date);
  const left = new Map(nights.map((n) => [n.stay_date, n.rate]));
  const off = {};
  const share = (money, dates) => {
    const pool = dates.reduce((s, d) => s + (left.get(d) || 0), 0);
    if (!(pool > 0) || !(money > 0)) return money;
    const take = Math.min(money, pool);
    for (const d of dates) {
      const part = (take * (left.get(d) || 0)) / pool;
      off[d] = (off[d] || 0) + part;
      left.set(d, left.get(d) - part);
    }
    return money - take;
  };
  for (const p of parts) share(share(p.share, p.dates || all), all);
  if (nights.every((n) => Math.abs((off[n.stay_date] || 0) - (amount * n.rate) / room) < 0.01)) return null;
  // Rounded to the paisa, the night with the most off taking what rounding
  // leaves, so a night with no offer never gets a paisa, and no night loses
  // more than its own price.
  const out = {};
  for (const n of nights) {
    const v = round2(off[n.stay_date] || 0);
    if (v > 0) out[n.stay_date] = v;
  }
  const diff = round2(amount - Object.values(out).reduce((s, v) => s + v, 0));
  const rate = new Map(nights.map((n) => [n.stay_date, n.rate]));
  const most = Object.keys(out)
    .sort((a, b) => out[b] - out[a])
    .find((d) => out[d] + diff >= 0 && out[d] + diff <= rate.get(d) + 0.001);
  if (most && diff) out[most] = round2(out[most] + diff);
  return out;
}

/**
 * Why each offer did or did not come off one room and plan, in the hotel's
 * words, for the simulator. `result` is what offerDiscount returned.
 */
export function explainOffers(content, { planId, roomTypeId, stay, today, mobile = false, code = "", nights, usedUp = null }, result) {
  const typed = cleanCode(code);
  const ahead = daysBetween(today, stay.checkIn);
  const applied = new Map((result?.steps || []).map((s) => [s.id, s.amount]));
  // A coupon or mobile offer that does not combine and won replaces every other offer.
  const won = [...(content.promotions || []), ...(content.coupons || [])].find(
    (o) => applied.has(o.id) && (o.code || o.type === "mobile") && o.stack === false
  );
  const n = stay.nights.length;
  const reasonFor = (o) => {
    if (!o.active) return "Switched off";
    if (o.type === "coupon" && o.code !== typed) return "Code not entered";
    if (o.type === "coupon" && o.code === usedUp) return "Used up";
    if (o.roomTypeIds?.length && !o.roomTypeIds.includes(roomTypeId)) return "Not for this room type";
    if (o.planIds?.length && !o.planIds.includes(planId)) return "Not for this rate plan";
    if (o.minNights && n < o.minNights) return `Needs ${o.minNights}+ nights`;
    if (o.maxNights && n > o.maxNights) return `Only up to ${o.maxNights} nights`;
    if ((o.checkInFrom && stay.checkIn < o.checkInFrom) || (o.checkInTo && stay.checkIn > o.checkInTo)) return "Check-in is outside its dates";
    if ((o.bookFrom && today < o.bookFrom) || (o.bookTo && today > o.bookTo)) return "Booked outside its booking dates";
    if (o.type === "early" && ahead < o.days) return `Needs booking ${o.days}+ days ahead; this is ${ahead}`;
    if (o.type === "last" && ahead > o.days) return `Only within ${o.days} days of arrival; this is ${ahead}`;
    if (o.type === "mobile" && !mobile) return "Only on a phone";
    if (o.type !== "coupon") {
      const blackout = new Set(o.blackout || []);
      const any = nights.some(
        (x) => !blackout.has(x.stay_date) && (!o.weekdays?.length || o.weekdays.includes(weekdayOf(x.stay_date)))
      );
      if (!any) return "No night qualifies (blackout dates or days of the week)";
    }
    if (won && o.id !== won.id) return won.code ? `Coupon ${won.code} gave more` : `${won.name} gave more`;
    if (result?.capped && o.stack !== false && (o.type === "coupon" || o.type === "mobile")) return "Discount limit reached";
    if (DEAL_TYPES.has(o.type)) return "A bigger deal won";
    if (o.type === "mobile" && o.stack !== false) return "A bigger mobile offer won";
    return "Worth less than the other offers together";
  };
  const all = [...(content.promotions || []), ...(content.coupons || []).map((c) => ({ ...c, type: "coupon" }))];
  return all.map((o) => ({
    id: o.id,
    name: o.type === "coupon" ? `Coupon ${o.code}` : o.name,
    type: o.type,
    applied: applied.has(o.id),
    amount: applied.get(o.id) || 0,
    reason: applied.has(o.id) ? null : reasonFor(o),
  }));
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

// ------------------------------------------------------------------
// What guests are told before they book
// ------------------------------------------------------------------

/**
 * The offers a guest can plan around, shown on the booking page before any
 * dates are picked: switched on, not yet over, and open to anyone (coupon
 * codes stay with the people they were given to). Only what the line needs
 * goes to the page.
 */
export function guestOffers(content, today) {
  return (content.promotions || [])
    // Not yet open for booking is left out too: a guest could not have it today.
    .filter(
      (p) =>
        p.active &&
        p.value &&
        !(p.checkInTo && p.checkInTo < today) &&
        !(p.bookTo && p.bookTo < today) &&
        !(p.bookFrom && p.bookFrom > today)
    )
    .map((p) => ({
      name: p.name,
      type: p.type,
      kind: p.kind,
      value: p.value,
      days: p.days,
      minNights: p.minNights,
      maxNights: p.maxNights,
      checkInFrom: p.checkInFrom && p.checkInFrom > today ? p.checkInFrom : null,
      checkInTo: p.checkInTo,
      bookTo: p.bookTo,
      weekdays: p.weekdays?.length && p.weekdays.length < 7 ? p.weekdays : [],
      someDatesOut: Boolean(p.blackout?.length),
      someRooms: Boolean(p.roomTypeIds?.length || p.planIds?.length),
    }))
    .slice(0, 8);
}

/** One offer as a guest reads it: "15% off when you stay 5 nights or more, for check-in until 30 Nov". */
export function offerForGuests(o, { money = (v) => String(v), day = (d) => d } = {}) {
  // An amount comes off the stay once, never each night: say so.
  const parts = [o.kind === "amount" ? `${money(o.value)} off your stay` : offerAmount(o, money)];
  if (o.type === "long") {
    parts.push(o.maxNights ? `when you stay ${o.minNights} to ${o.maxNights} nights` : `when you stay ${o.minNights} nights or more`);
  }
  if (o.type === "early") parts.push(`when you book ${o.days} days or more before you arrive`);
  if (o.type === "last") parts.push(o.days ? `when you book within ${o.days} days of arrival` : "when you book on the day you arrive");
  if (o.type === "mobile") parts.push("when you book on your phone");
  const extra = [];
  if (o.type !== "long" && o.minNights && o.maxNights) extra.push(`on stays of ${o.minNights} to ${o.maxNights} nights`);
  else if (o.type !== "long" && o.minNights) extra.push(`on stays of ${o.minNights} nights or more`);
  else if (o.type !== "long" && o.maxNights) extra.push(`on stays of up to ${o.maxNights} nights`);
  if (o.weekdays?.length) extra.push(`on ${o.weekdays.map((d) => WEEKDAYS[d]).join(", ")} nights`);
  if (o.checkInFrom && o.checkInTo) extra.push(`for check-in ${day(o.checkInFrom)} to ${day(o.checkInTo)}`);
  else if (o.checkInFrom) extra.push(`for check-in from ${day(o.checkInFrom)}`);
  else if (o.checkInTo) extra.push(`for check-in until ${day(o.checkInTo)}`);
  if (o.bookTo) extra.push(`book by ${day(o.bookTo)}`);
  if (o.someRooms) extra.push("on selected rooms");
  if (o.someDatesOut) extra.push("some dates excluded");
  return [parts.join(" "), ...extra].join(", ");
}

/** The most extra nights a guest is asked to add for a long-stay offer. */
export const NUDGE_MAX_EXTRA_NIGHTS = 3;

/**
 * The nearest long-stay offer a stay falls just short of: the fewest nights
 * that would start it, when that is at most NUDGE_MAX_EXTRA_NIGHTS more than
 * booked and its dates fit. Null when there is none. Whether the longer stay
 * can really be had, and what it costs, is the search's to work out.
 */
export function nearestLongStay(content, { checkIn, nights, today }) {
  let best = null;
  for (const p of content.promotions || []) {
    if (p.type !== "long" || !p.active || !p.value || !p.minNights) continue;
    if (p.minNights <= nights || p.minNights - nights > NUDGE_MAX_EXTRA_NIGHTS) continue;
    if (p.maxNights && p.minNights > p.maxNights) continue;
    if ((p.checkInFrom && checkIn < p.checkInFrom) || (p.checkInTo && checkIn > p.checkInTo)) continue;
    if ((p.bookFrom && today < p.bookFrom) || (p.bookTo && today > p.bookTo)) continue;
    if (!best || p.minNights < best) best = p.minNights;
  }
  return best;
}
