import { cleanCoupons, cleanPromotions, promotionsWithoutCodes, MAX_DISCOUNT_PERCENT } from "@/lib/promotions";

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

/** Amenities most hotels have, ticked on the Hotel tab; anything else is typed. */
export const HOTEL_AMENITIES = [
  "Free Wi-Fi",
  "Free parking",
  "Air conditioning",
  "24-hour front desk",
  "Restaurant",
  "Room service",
  "Lift",
  "Power backup",
  "Laundry",
  "Hot water",
  "Swimming pool",
  "Gym",
  "Spa",
  "Bar",
  "Airport pickup",
  "Garden",
  "Kids play area",
  "Banquet hall",
  "Pet friendly",
  "Wheelchair access",
];

const timeOrEmpty = (v) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v || ""));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
};

/** "14:00" as "2:00 pm". */
export function timeLabel(hhmm) {
  const t = timeOrEmpty(hhmm);
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** The hotel's own details for its booking page: blank uses what Property Setup holds. */
function cleanHotel(raw) {
  const h = raw && typeof raw === "object" ? raw : {};
  const long = (v, max) => String(v ?? "").trim().slice(0, max);
  const link = (v) => {
    const u = String(v || "").trim();
    return /^https:\/\/\S+$/.test(u) ? u.slice(0, 500) : "";
  };
  return {
    about: long(h.about, 1500),
    amenities: (Array.isArray(h.amenities) ? h.amenities : String(h.amenities || "").split(","))
      .map((a) => text(a, 40))
      .filter(Boolean)
      .filter((a, i, all) => all.indexOf(a) === i)
      .slice(0, 40),
    checkIn: timeOrEmpty(h.checkIn),
    checkOut: timeOrEmpty(h.checkOut),
    address: text(h.address, 300),
    mapUrl: link(h.mapUrl),
    phone: text(h.phone, 30),
    email: text(h.email, 120),
    rules: long(h.rules, 1500),
  };
}

export const maxPhotosFor = (target) => (target === BANNER ? MAX_BANNER_PHOTOS : MAX_ROOM_PHOTOS);
export const MAX_LONG_STAY_RULES = 10;
export { MAX_DISCOUNT_PERCENT };

const text = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);
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
 *   hotel       about the hotel, its amenities, check-in and out times,
 *               address and map, phone, email and house rules
 *   banner      photos across the top of the page, the hotel itself
 *   rooms       per room type: hidden, description, amenities, photo links
 *   plans       per rate plan: hidden, the name guests see, what is
 *               included, the cancellation terms
 *   promotions  offers every guest who fits gets (lib/promotions.js)
 *   coupons     codes a guest types, added on top or instead
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
  const promotions = cleanPromotions(promotionsWithoutCodes(c.promotions));
  const coupons = cleanCoupons(c.coupons, c.promotions);
  const longStays = (Array.isArray(c.longStays) ? c.longStays : [])
    .map((r) => ({ nights: wholeOrNull(r?.nights, 2, 60), percent: percentOrNull(r?.percent) }))
    .filter((r) => r.nights && r.percent)
    .sort((a, b) => a.nights - b.nights)
    .slice(0, MAX_LONG_STAY_RULES);
  return {
    hotel: cleanHotel(c.hotel),
    banner: photoList(c.banner, MAX_BANNER_PHOTOS),
    rooms,
    plans,
    promotions,
    coupons,
    longStays,
  };
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
