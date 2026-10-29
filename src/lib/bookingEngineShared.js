/**
 * Booking engine (migration 066): what the guest's booking page, the desk and
 * the hotel's settings all need to agree on. No server imports, so the
 * browser can load it too.
 */

/**
 * Who may work on the booking page: whoever holds the Booking Engine page,
 * or Rates & Inventory, since it is selling work.
 */
export const BOOKING_ENGINE_PAGES = ["bookingengine", "cm"];

export const DEFAULT_BOOKING_PREFS = {
  enabled: false,
  // The hotel's own UPI ID, as it is written in its UPI app: name@bank.
  upiId: "",
  // The name the guest's UPI app shows before they pay, so they can see the
  // money is going to the hotel.
  payeeName: "",
  // Lets a guest book now and pay when they arrive.
  payAtHotel: false,
  // A line the hotel wants every guest to read before booking.
  note: "",
};

/** UPI IDs are name@handle; the handle is letters only (okaxis, ybl, paytm). */
export function isUpiId(value) {
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(String(value || "").trim());
}

export function cleanBookingPrefs(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const text = (v, max) => String(v || "").trim().replace(/\s+/g, " ").slice(0, max);
  return {
    enabled: p.enabled === true,
    upiId: text(p.upiId, 120).replace(/\s/g, ""),
    payeeName: text(p.payeeName, 80),
    payAtHotel: p.payAtHotel === true,
    note: text(p.note, 300),
  };
}

/** Where a booking's payment stands, in the words the desk sees. */
export const PAYMENT_STATUS_LABEL = {
  awaiting: "Not paid yet",
  guest_paid: "Guest says paid",
  received: "Payment received",
  not_received: "Payment not found",
  at_hotel: "Pays at the hotel",
};

/** The same, in the words the guest sees. */
export const GUEST_PAYMENT_TEXT = {
  awaiting: "Waiting for your payment",
  guest_paid: "The hotel is checking your payment",
  received: "Payment received. Thank you!",
  not_received: "The hotel could not find your payment. Please call the hotel.",
  at_hotel: "You pay at the hotel when you arrive",
};

/**
 * The link a UPI app opens to pay: the hotel's ID and name, the amount and a
 * note carrying the booking number, so the hotel can match the money in its
 * bank statement. The amount is fixed by the link; the guest cannot change it.
 */
export function upiPayLink({ upiId, payeeName, amount, reference }) {
  const params = [
    ["pa", upiId],
    ["pn", payeeName || "Hotel"],
    ["am", Number(amount).toFixed(2)],
    ["cu", "INR"],
    ["tn", `Booking ${reference}`],
  ];
  return `upi://pay?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

/** A UPI reference (UTR) is 12 digits; anything else typed is kept as typed, cut short. */
export function cleanPaymentReference(value) {
  return String(value || "").replace(/\s+/g, "").slice(0, 40);
}

/** The most a guest can book in one go, so a typo does not hold a room for a year. */
export const MAX_NIGHTS = 30;
export const MAX_DAYS_AHEAD = 500;

// ------------------------------------------------------------------
// What the booking page shows, set on the Booking Engine page
// ------------------------------------------------------------------

export const MAX_ROOM_PHOTOS = 8;
export const MAX_BANNER_PHOTOS = 5;
/** The photo target for the banner across the top of the page, in place of a room type id. */
export const BANNER = "banner";

const photoList = (v, max) =>
  (Array.isArray(v) ? v : []).filter((u) => typeof u === "string" && /^https:\/\//.test(u)).slice(0, max);

/** The photos of a room type, or of the banner. */
export function photosOf(content, target) {
  return target === BANNER ? content.banner || [] : content.rooms?.[target]?.photos || [];
}

/** The content with a room type's photos, or the banner's, replaced. */
export function withPhotos(content, target, photos) {
  if (target === BANNER) return { ...content, banner: photos };
  const room = content.rooms?.[target] || { hidden: false, description: "", amenities: [], photos: [] };
  return { ...content, rooms: { ...content.rooms, [target]: { ...room, photos } } };
}

export const maxPhotosFor = (target) => (target === BANNER ? MAX_BANNER_PHOTOS : MAX_ROOM_PHOTOS);
export const MAX_PROMOTIONS = 30;
export const MAX_LONG_STAY_RULES = 10;
export const MAX_DISCOUNT_PERCENT = 90;

const text = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const isoOrNull = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const wholeOrNull = (v, min, max) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const percentOrNull = (v) => {
  const n = Math.round(Number(v) * 100) / 100;
  return Number.isFinite(n) && n > 0 && n <= MAX_DISCOUNT_PERCENT ? n : null;
};

/**
 * The booking page's content, kept with the hotel's choices:
 *   banner      photos across the top of the page, the hotel itself
 *   rooms       per room type: hidden, description, amenities, photo links
 *   plans       per rate plan: hidden, the name guests see, what is
 *               included, the cancellation terms
 *   promotions  percent off for stays and booking dates, a minimum stay, an
 *               optional promo code, one plan or all
 *   longStays   percent off from a number of nights
 * Blank room and plan text falls back to what Rooms and Rate Plan Setup hold.
 */
export function cleanBookingContent(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const rooms = {};
  for (const [id, r] of Object.entries(c.rooms || {})) {
    if (!r || typeof r !== "object") continue;
    rooms[id] = {
      hidden: r.hidden === true,
      description: text(r.description, 600),
      amenities: (Array.isArray(r.amenities) ? r.amenities : String(r.amenities || "").split(","))
        .map((a) => text(a, 40))
        .filter(Boolean)
        .slice(0, 20),
      photos: photoList(r.photos, MAX_ROOM_PHOTOS),
    };
  }
  const plans = {};
  for (const [id, p] of Object.entries(c.plans || {})) {
    if (!p || typeof p !== "object") continue;
    plans[id] = {
      hidden: p.hidden === true,
      name: text(p.name, 60),
      description: text(p.description, 300),
      cancellation: text(p.cancellation, 300),
    };
  }
  const promotions = (Array.isArray(c.promotions) ? c.promotions : [])
    .map((p) => ({
      id: text(p?.id, 40) || `p${Math.random().toString(36).slice(2, 10)}`,
      name: text(p?.name, 60),
      percent: percentOrNull(p?.percent),
      stayFrom: isoOrNull(p?.stayFrom),
      stayTo: isoOrNull(p?.stayTo),
      bookFrom: isoOrNull(p?.bookFrom),
      bookTo: isoOrNull(p?.bookTo),
      minNights: wholeOrNull(p?.minNights, 1, 60),
      code: text(p?.code, 20).toUpperCase().replace(/\s/g, ""),
      planId: text(p?.planId, 40) || null,
      active: p?.active !== false,
    }))
    .filter((p) => p.name && p.percent)
    .slice(0, MAX_PROMOTIONS);
  const longStays = (Array.isArray(c.longStays) ? c.longStays : [])
    .map((r) => ({ nights: wholeOrNull(r?.nights, 2, 60), percent: percentOrNull(r?.percent) }))
    .filter((r) => r.nights && r.percent)
    .sort((a, b) => a.nights - b.nights)
    .slice(0, MAX_LONG_STAY_RULES);
  return { banner: photoList(c.banner, MAX_BANNER_PHOTOS), rooms, plans, promotions, longStays };
}

const blank = (v) => v === null || v === undefined || String(v).trim() === "";

/**
 * What is wrong with a promotion as typed: { field, message }, or null.
 * Anything the server would quietly drop is refused here instead, so a
 * "7 nights or more" offer typed as "7n" is not saved as one for any stay.
 */
export function promotionProblem(p) {
  if (!text(p?.name, 60)) return { field: "name", message: "Give the promotion a name." };
  if (!percentOrNull(p?.percent)) {
    return { field: "percent", message: `Enter a discount between 1 and ${MAX_DISCOUNT_PERCENT}%.` };
  }
  if (!blank(p?.minNights) && (!/^\d+$/.test(String(p.minNights).trim()) || !wholeOrNull(p.minNights, 1, 60))) {
    return { field: "minNights", message: "Min stay is a number of nights from 1 to 60, or blank for any stay." };
  }
  if (p?.stayFrom && p?.stayTo && p.stayTo < p.stayFrom) return { field: "stayTo", message: "Last night is before first night." };
  if (p?.bookFrom && p?.bookTo && p.bookTo < p.bookFrom) return { field: "bookTo", message: "Book to is before book from." };
  if (!blank(p?.code) && !/^[A-Za-z0-9]{2,20}$/.test(String(p.code).trim())) {
    return { field: "code", message: "A promo code is 2 to 20 letters or numbers, no spaces." };
  }
  return null;
}

/** What is wrong with the long-stay steps: { index, field, message }, or null. */
export function longStayProblem(rows) {
  const seen = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const nights = String(r?.nights ?? "").trim();
    if (!/^\d+$/.test(nights) || !wholeOrNull(nights, 2, 60)) {
      return { index: i, field: "nights", message: "Nights or more is a number from 2 to 60." };
    }
    if (!percentOrNull(r?.percent)) {
      return { index: i, field: "percent", message: `Enter a discount between 1 and ${MAX_DISCOUNT_PERCENT}%.` };
    }
    if (seen.has(Number(nights))) return { index: i, field: "nights", message: `There are two steps for ${nights} nights.` };
    seen.add(Number(nights));
  }
  return null;
}

/** A promotion's dates in words, so one with none says it never ends. */
export function promotionWhen(p, day = (d) => d) {
  const stay =
    p?.stayFrom && p?.stayTo
      ? `Stays ${day(p.stayFrom)} to ${day(p.stayTo)}`
      : p?.stayFrom
        ? `Stays from ${day(p.stayFrom)}, no end`
        : p?.stayTo
          ? `Stays until ${day(p.stayTo)}`
          : null;
  const book =
    p?.bookFrom || p?.bookTo
      ? `booked ${p.bookFrom ? `from ${day(p.bookFrom)}` : ""}${p.bookFrom && p.bookTo ? " " : ""}${p.bookTo ? `until ${day(p.bookTo)}` : ""}`
      : null;
  if (!stay && !book) return { text: "Every date, no end", open: true };
  return { text: [stay, book].filter(Boolean).join(", "), open: !p?.stayTo && !p?.bookTo };
}

/**
 * The best discount for a stay on one plan: the biggest of the promotions
 * that fit and the long-stay rule reached. Discounts never add up, so a
 * guest is never sold below what the hotel meant. A promotion with a code
 * only counts when the guest typed that code.
 *
 *   stay   { nights: [dates], checkIn }
 *   today  the hotel's date, for the booking window
 */
export function bestDiscount(content, { planId, stay, today, code }) {
  const typed = String(code || "").trim().toUpperCase();
  const nights = stay.nights;
  const first = nights[0];
  const last = nights[nights.length - 1];
  let best = null;
  for (const p of content.promotions || []) {
    if (!p.active || !p.percent) continue;
    if (p.code && p.code !== typed) continue;
    if (p.planId && p.planId !== planId) continue;
    if (p.minNights && nights.length < p.minNights) continue;
    if (p.stayFrom && first < p.stayFrom) continue;
    if (p.stayTo && last > p.stayTo) continue;
    if (p.bookFrom && today < p.bookFrom) continue;
    if (p.bookTo && today > p.bookTo) continue;
    if (!best || p.percent > best.percent) {
      best = { percent: p.percent, label: p.name, kind: "promotion", ...(p.code ? { code: p.code } : {}) };
    }
  }
  for (const r of content.longStays || []) {
    if (nights.length >= r.nights && (!best || r.percent > best.percent)) {
      best = { percent: r.percent, label: `Stay ${r.nights}+ nights`, kind: "long_stay" };
    }
  }
  return best;
}

/**
 * What happened to the code a guest typed, for the line under the search:
 * "applied" when it priced at least one room, "unused" when it is real but
 * not for this stay, "unknown" when no promotion has it.
 */
export function codeOutcome(content, code, applied) {
  if (!String(code || "").trim()) return null;
  if (applied) return "applied";
  return isKnownCode(content, code) ? "unused" : "unknown";
}

/** Whether a typed code belongs to any promotion that is switched on. */
export function isKnownCode(content, code) {
  const typed = String(code || "").trim().toUpperCase();
  return Boolean(typed) && (content.promotions || []).some((p) => p.active && p.code === typed);
}
