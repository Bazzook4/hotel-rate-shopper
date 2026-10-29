import { randomBytes } from "crypto";
import QRCode from "qrcode";
import {
  getSupabaseAdmin,
  getAvailabilityGrid,
  checkAvailability,
  createReservation,
  getReservation,
  getReservationFolio,
  addReservationPayment,
  linkGuestForBooking,
  saveReservationGuest,
  listDailyRestrictions,
  listPropertyTaxes,
  listPropertyExtras,
  loadQuoteData,
  quoteReservation,
  nightsBetween,
  guestPhoneKey,
  getPropertyClock,
  getPropertyCurrency,
} from "@/lib/database";
import { folioTotals } from "@/lib/taxes";
import { cleanCode, codeOutcome, hasCoupons, offerDiscount } from "@/lib/promotions";
import { todayInZone } from "@/lib/hotelTime";
import { isDayUsePlan } from "@/lib/dayUse";
import { mealPlan } from "@/lib/mealPlans";
import { syncInventory, staySpan } from "@/lib/inventorySync";
import {
  GUEST_PAYMENT_TEXT,
  BANNER,
  maxPhotosFor,
  photosOf,
  withPhotos,
  cleanBookingContent,
  MAX_DAYS_AHEAD,
  MAX_NIGHTS,
  cleanBookingPrefs,
  cleanPaymentReference,
  isUpiId,
  upiPayLink,
} from "@/lib/bookingEngineShared";

/**
 * The booking engine (migration 066): the hotel's own booking page, put on
 * its website, and the desk's side of the bookings it brings in.
 *
 * Guests see only what the hotel already sells: room types with rooms free
 * on every night, at the rate plans assigned to them, priced exactly as the
 * desk's booking form prices them, taxes included. Nothing the browser sends
 * is trusted for price or availability; both are worked out again when the
 * guest presses Book.
 *
 * A booking arrives in the PMS as a confirmed Website booking, holding its
 * room like any other, and the channels are told at once. Payment is by UPI
 * to the hotel's own ID: the money never passes through this app, so the
 * desk checks its bank and marks it received, which puts it on the bill.
 */

const TABLE = "online_bookings";
const SOURCE = "website";

let tableSeen = false;
let checkedAt = 0;

/** Whether migration 066 has run; re-checked at most once a minute until it has. */
export async function bookingEngineReady() {
  if (tableSeen) return true;
  if (Date.now() - checkedAt < 60000) return false;
  checkedAt = Date.now();
  const { error } = await getSupabaseAdmin().from(TABLE).select("id").limit(1);
  tableSeen = !error;
  return tableSeen;
}

export const BOOKING_NOT_READY =
  "The booking engine needs migration 066_booking_engine.sql. Run it in the Supabase SQL editor, then try again.";

function addDaysISO(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const round2 = (n) => Math.round(Number(n) * 100) / 100;

// ------------------------------------------------------------------
// The hotel's choices
// ------------------------------------------------------------------

/** The hotel's booking engine choices and page key; the defaults before migration 066. */
export async function getBookingSettings(propertyId) {
  const { data, error } = await getSupabaseAdmin()
    .from("properties")
    .select("*")
    .eq("id", propertyId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load property: ${error.message}`);
  const currency = await getPropertyCurrency(propertyId);
  return {
    prefs: cleanBookingPrefs(data?.booking_engine),
    content: cleanBookingContent(data?.booking_engine?.content),
    key: data?.booking_key || null,
    currency,
    ready: data ? "booking_engine" in data : false,
  };
}

/**
 * Saves the choices, making the page key the first time. Turning the page on
 * needs a way to pay: a UPI ID (rupee hotels only, as UPI is) or pay at the
 * hotel.
 */
export async function saveBookingSettings(propertyId, input) {
  const prefs = cleanBookingPrefs(input);
  const current = await getBookingSettings(propertyId);
  if (!current.ready) throw new Error(BOOKING_NOT_READY);
  const upiAllowed = current.currency === "INR";

  if (prefs.upiId && !isUpiId(prefs.upiId)) {
    return { error: "That UPI ID does not look right. It is written like hotelname@okaxis." };
  }
  if (!upiAllowed) prefs.upiId = "";
  if (prefs.enabled && !prefs.upiId && !prefs.payAtHotel) {
    return {
      error: upiAllowed
        ? "Add your UPI ID, or tick Pay at the hotel, so guests have a way to pay."
        : "Tick Pay at the hotel, so guests have a way to pay. UPI works for rupee hotels only.",
    };
  }

  // The page's content is kept as it was; it is saved on its own tabs.
  const updates = { booking_engine: { ...prefs, content: current.content }, updated_at: new Date().toISOString() };
  if (!current.key) updates.booking_key = randomBytes(9).toString("base64url");
  const { error } = await getSupabaseAdmin().from("properties").update(updates).eq("id", propertyId);
  if (error) throw new Error(/booking_/.test(error.message) ? BOOKING_NOT_READY : error.message);
  return getBookingSettings(propertyId);
}

/**
 * The page key, made now if the hotel has none, so its link can be shown
 * from the first visit rather than only after something is saved. The page
 * stays closed to guests until it is turned on.
 */
export async function ensureBookingKey(propertyId) {
  const current = await getBookingSettings(propertyId);
  if (current.key || !current.ready) return current;
  const key = randomBytes(9).toString("base64url");
  const { error } = await getSupabaseAdmin()
    .from("properties")
    .update({ booking_key: key })
    .eq("id", propertyId)
    .is("booking_key", null);
  if (error) throw new Error(error.message);
  return getBookingSettings(propertyId);
}

/**
 * Saves the booking page's content: rooms, plans, promotions and long-stay
 * discounts. The hotel's payment choices are kept as they were.
 */
export async function saveBookingContent(propertyId, input) {
  const current = await getBookingSettings(propertyId);
  if (!current.ready) throw new Error(BOOKING_NOT_READY);
  const content = cleanBookingContent(input);
  const updates = { booking_engine: { ...current.prefs, content }, updated_at: new Date().toISOString() };
  if (!current.key) updates.booking_key = randomBytes(9).toString("base64url");
  const { error } = await getSupabaseAdmin().from("properties").update(updates).eq("id", propertyId);
  if (error) throw new Error(/booking_/.test(error.message) ? BOOKING_NOT_READY : error.message);
  return getBookingSettings(propertyId);
}

// ------------------------------------------------------------------
// Room photos
// ------------------------------------------------------------------

/** Photos are meant to be seen, so they sit in a public bucket guests' pages link directly. */
const PHOTO_BUCKET = "booking-photos";
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
let photoBucketSeen = false;

async function ensurePhotoBucket(supabase) {
  if (photoBucketSeen) return;
  const { data } = await supabase.storage.getBucket(PHOTO_BUCKET);
  if (!data) {
    const { error } = await supabase.storage.createBucket(PHOTO_BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message)) {
      console.error("Booking photo bucket setup failed:", error.message);
      throw new Error("The photo did not save. Please try again.");
    }
  }
  photoBucketSeen = true;
}

function photoPath(url) {
  const marker = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
  const at = String(url || "").indexOf(marker);
  return at < 0 ? null : decodeURIComponent(url.slice(at + marker.length).split("?")[0]);
}

/** Adds a photo to a room type's photos, or the banner's, and returns the page's content. */
export async function addRoomPhoto(propertyId, target, file) {
  const ext = PHOTO_TYPES[file.type];
  if (!ext) throw new Error("The photo must be a JPG, PNG or WebP picture.");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("The photo must be 3 MB or smaller.");
  const current = await getBookingSettings(propertyId);
  if (!current.ready) throw new Error(BOOKING_NOT_READY);
  const photos = photosOf(current.content, target);
  const max = maxPhotosFor(target);
  if (photos.length >= max) {
    throw new Error(target === BANNER ? `The banner can have up to ${max} photos.` : `A room can have up to ${max} photos.`);
  }

  const supabase = getSupabaseAdmin();
  await ensurePhotoBucket(supabase);
  const path = `${propertyId}/${target}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (error) {
    console.error("Booking photo upload failed:", error.message);
    throw new Error("The photo did not save. Please try again.");
  }
  const url = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
  try {
    return await saveBookingContent(propertyId, withPhotos(current.content, target, [...photos, url]));
  } catch (err) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path]).catch(() => {});
    throw err;
  }
}

/** Takes a photo off, or moves it first when `makeCover` is set. */
export async function changeRoomPhoto(propertyId, target, url, { makeCover = false } = {}) {
  const current = await getBookingSettings(propertyId);
  const photos = photosOf(current.content, target);
  if (!photos.includes(url)) return current;
  const rest = photos.filter((u) => u !== url);
  const saved = await saveBookingContent(propertyId, withPhotos(current.content, target, makeCover ? [url, ...rest] : rest));
  const path = !makeCover && photoPath(url);
  if (path) await getSupabaseAdmin().storage.from(PHOTO_BUCKET).remove([path]).catch(() => {});
  return saved;
}

/** The hotel behind a booking page, or null when the page is unknown or switched off. */
export async function findHotelByKey(key) {
  if (!key || typeof key !== "string" || key.length > 40) return null;
  if (!(await bookingEngineReady())) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("properties")
    .select("*")
    .eq("booking_key", key)
    .maybeSingle();
  if (error || !data) return null;
  const prefs = cleanBookingPrefs(data.booking_engine);
  if (!prefs.enabled) return null;
  const [clock, currency] = await Promise.all([getPropertyClock(data.id), getPropertyCurrency(data.id)]);
  return {
    property: data,
    prefs,
    content: cleanBookingContent(data.booking_engine?.content),
    currency,
    today: todayInZone(clock),
    payUpi: currency === "INR" && isUpiId(prefs.upiId),
  };
}

/**
 * What Property Setup already says about the hotel, which the booking page
 * uses wherever the Hotel tab is left blank.
 */
export function hotelDefaults(property) {
  const amenities = Array.isArray(property?.amenities)
    ? property.amenities
    : String(property?.amenities || "").split(",");
  return {
    about: String(property?.description || "").trim(),
    amenities: amenities.map((a) => String(a).trim()).filter(Boolean),
    checkIn: String(property?.check_in_time || "").slice(0, 5),
    checkOut: String(property?.check_out_time || "").slice(0, 5),
    address: [property?.address, property?.city, property?.state, property?.postal_code]
      .map((v) => String(v || "").trim())
      .filter(Boolean)
      .join(", "),
    mapUrl: /^https:\/\//.test(property?.google_business_url || "") ? property.google_business_url : "",
    phone: property?.phone || property?.contact_phone || "",
    email: property?.email || "",
    rules: "",
  };
}

/** The hotel's details as guests see them: its own words, else Property Setup's. */
function hotelDetails(property, content) {
  const base = hotelDefaults(property);
  const own = content.hotel || {};
  const pick = (k) => (Array.isArray(own[k]) ? (own[k].length ? own[k] : base[k]) : own[k] || base[k]);
  const details = Object.fromEntries(Object.keys(base).map((k) => [k, pick(k)]));
  // A map link from the address when the hotel gave none, so Directions always works.
  if (!details.mapUrl && details.address) {
    details.mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${property.name || ""} ${details.address}`)}`;
  }
  return details;
}

/** What the booking page shows before any dates are picked. */
export function hotelView(hotel) {
  const { property, prefs, currency, today, payUpi } = hotel;
  return {
    name: property.name || "",
    logoUrl: property.display_prefs?.logoUrl || null,
    currency,
    today,
    maxNights: MAX_NIGHTS,
    lastDate: addDaysISO(today, MAX_DAYS_AHEAD),
    payUpi,
    payAtHotel: prefs.payAtHotel,
    note: prefs.note || null,
    banner: hotel.content.banner,
    details: hotelDetails(property, hotel.content),
    // The promo code box is only offered where there is a code to type.
    hasCodes: hasCoupons(hotel.content),
  };
}

// ------------------------------------------------------------------
// What a guest can book
// ------------------------------------------------------------------

/** A stay a guest asked about, or a message saying what to change. */
/** Whether a request came from a phone, for mobile-only offers. Read from the browser, never trusted from the page. */
export function isMobileRequest(req) {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(req?.headers?.get?.("user-agent") || "");
}

export function readStay(hotel, input, { mobile = false } = {}) {
  const checkIn = input?.checkIn;
  const checkOut = input?.checkOut;
  const adults = Math.floor(Number(input?.adults));
  const children = Math.max(0, Math.floor(Number(input?.children) || 0));
  if (!isDate(checkIn) || !isDate(checkOut)) return { error: "Pick your check-in and check-out dates." };
  if (checkIn < hotel.today) return { error: "Check-in cannot be in the past." };
  if (checkOut <= checkIn) return { error: "Check-out must be after check-in." };
  if (checkIn > addDaysISO(hotel.today, MAX_DAYS_AHEAD)) return { error: "Those dates are too far ahead to book online." };
  const nights = nightsBetween(checkIn, checkOut);
  if (nights.length > MAX_NIGHTS) {
    return { error: `Online bookings are for up to ${MAX_NIGHTS} nights. Please call the hotel for longer stays.` };
  }
  if (!Number.isFinite(adults) || adults < 1 || adults > 20) return { error: "Choose how many adults." };
  if (children > 10) return { error: "Choose how many children." };
  const code = cleanCode(input?.code);
  return { stay: { checkIn, checkOut, adults, children, nights, code, mobile } };
}

/**
 * Whether a plan may be sold in a room for these nights: not stopped on any
 * night, and the stay long enough (or short enough) for the check-in date.
 * A row against no room applies to every room; the plan's own minimum
 * stands where no date sets one.
 */
function restrictionsAllow(plan, roomTypeId, stay, restrictions) {
  const rows = restrictions.filter(
    (r) => r.rate_plan_id === plan.id && (!r.room_type_id || r.room_type_id === roomTypeId)
  );
  const nightSet = new Set(stay.nights);
  if (rows.some((r) => r.stop_sell && nightSet.has(r.stay_date))) return { ok: false };
  const atArrival = rows.filter((r) => r.stay_date === stay.checkIn);
  const pick = (field) => {
    const own = atArrival.find((r) => r.room_type_id === roomTypeId && r[field] != null);
    const any = atArrival.find((r) => !r.room_type_id && r[field] != null);
    const value = (own || any)?.[field] ?? plan[field] ?? null;
    return Number(value) > 0 ? Number(value) : null;
  };
  const min = pick("min_stay");
  const max = pick("max_stay");
  if (min && stay.nights.length < min) return { ok: false, minStay: min };
  if (max && stay.nights.length > max) return { ok: false };
  return { ok: true };
}

/**
 * Taxes on a room charge, as the folio will work them out once booked. A
 * discount comes off before tax, so a night can drop into a lower slab, as
 * it does on the bill.
 */
function withTax(quote, stay, taxRules, services, discount = null) {
  const priced = (d) =>
    folioTotals({
      reservation: {
        total_amount: quote.total,
        adults: stay.adults,
        children: stay.children,
        guest_residency: "domestic",
        stay_kind: "overnight",
        check_in: stay.checkIn,
        ...(d ? { discount_kind: "amount", discount_value: d.amount, discount_timing: "before_tax" } : {}),
      },
      nights: quote.nights.map((n) => ({ stay_date: n.stay_date, rate: Number(n.rate) })),
      taxRules,
      services,
    }).totals;
  const totals = priced(discount);
  const full = discount ? priced(null) : totals;
  return {
    room: totals.room,
    tax: round2(totals.tax),
    total: totals.total,
    ...(discount
      ? {
          fullTotal: full.total,
          discount: {
            amount: discount.amount,
            percent: discount.percent,
            label: discount.label,
            kind: discount.kind,
            coupon: discount.coupon || null,
          },
        }
      : {}),
  };
}

/** How a coupon is named in a booking's discount note, so its uses can be counted. */
const couponTag = (code) => `(coupon ${code})`;

/** How many standing website bookings used each coupon, for the Coupons tab. */
export async function couponUseCounts(propertyId) {
  const { data, error } = await getSupabaseAdmin()
    .from("reservations")
    .select("discount_note")
    .eq("property_id", propertyId)
    .eq("source", SOURCE)
    .not("status", "in", "(cancelled,no_show)")
    .ilike("discount_note", "%(coupon %");
  if (error) return {};
  const counts = {};
  for (const r of data || []) {
    const code = /\(coupon ([A-Z0-9]+)\)/.exec(r.discount_note || "")?.[1];
    if (code) counts[code] = (counts[code] || 0) + 1;
  }
  return counts;
}

/** Whether a coupon with a limit has been used that many times on bookings still standing. */
async function couponUsedUp(hotel, code) {
  const coupon = hotel.content.coupons.find((c) => c.code === code);
  if (!coupon?.maxUses) return false;
  const { count, error } = await getSupabaseAdmin()
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("property_id", hotel.property.id)
    .eq("source", SOURCE)
    .not("status", "in", "(cancelled,no_show)")
    .ilike("discount_note", `%${couponTag(code)}%`);
  if (error) {
    console.error("Booking engine: could not count coupon uses:", error.message);
    return false;
  }
  return count >= coupon.maxUses;
}

/**
 * Every room type with a room free on each night, and what each of its rate
 * plans costs for the stay. A plan the room is not assigned to, or that has
 * no price on one of the nights, is left out rather than sold at a guess.
 */
export async function searchOffers(hotel, stay) {
  const propertyId = hotel.property.id;
  const lastNight = stay.nights[stay.nights.length - 1];
  const [grid, quoteData, restrictions, taxRules, services] = await Promise.all([
    getAvailabilityGrid(propertyId, stay.checkIn, lastNight),
    loadQuoteData(propertyId, stay.checkIn, lastNight),
    listDailyRestrictions(propertyId, stay.checkIn, lastNight).catch(() => []),
    listPropertyTaxes(propertyId),
    listPropertyExtras(propertyId, { includeInactive: true }),
  ]);

  const { content } = hotel;
  const plans = quoteData.ratePlans.filter(
    (p) => !isDayUsePlan(p) && p.is_active !== false && p.active !== false && !content.plans[p.id]?.hidden
  );
  const nightSet = new Set(stay.nights);
  const offers = [];
  // A coupon that has been used as often as the hotel allows is left out.
  const usedUp = stay.code ? await couponUsedUp(hotel, stay.code) : false;
  const offerContent = usedUp ? { ...content, coupons: content.coupons.filter((c) => c.code !== stay.code) } : content;
  let minStayHint = null;

  for (const type of quoteData.roomTypes) {
    const shown = content.rooms[type.id] || {};
    if (shown.hidden) continue;
    const row = grid.roomTypes.find((r) => r.id === type.id);
    if (!row) continue;
    const free = Math.min(...row.days.filter((d) => nightSet.has(d.date)).map((d) => d.free));
    if (!(free > 0)) continue;
    const maxAdults = Number(type.max_adults) || Number(type.base_adults) || 2;
    if (stay.adults > maxAdults) continue;

    const options = [];
    for (const plan of plans) {
      const assigned = quoteData.assignments.some(
        (a) => a.rate_plan_id === plan.id && a.room_type_id === type.id
      );
      if (!assigned) continue;
      const allowed = restrictionsAllow(plan, type.id, stay, restrictions);
      if (!allowed.ok) {
        if (allowed.minStay) minStayHint = Math.min(minStayHint || allowed.minStay, allowed.minStay);
        continue;
      }
      const quote = await quoteReservation(
        {
          property_id: propertyId,
          room_type_id: type.id,
          rate_plan_id: plan.id,
          check_in: stay.checkIn,
          check_out: stay.checkOut,
          adults: stay.adults,
          children: stay.children,
        },
        quoteData
      );
      if (!(quote.total > 0) || quote.partial || quote.source === "base_price") continue;
      const discount = offerDiscount(offerContent, {
        planId: plan.id,
        roomTypeId: type.id,
        stay,
        today: hotel.today,
        mobile: stay.mobile,
        code: stay.code,
        nights: quote.nights.map((n) => ({ stay_date: n.stay_date, rate: Number(n.rate) })),
      });
      const priced = withTax(quote, stay, taxRules, services, discount);
      const meal = mealPlan(plan.meal_plan);
      const words = content.plans[plan.id] || {};
      options.push({
        ratePlanId: plan.id,
        name: words.name || plan.plan_name || meal?.name || "Room",
        meals: words.description || meal?.hint || null,
        // One line on cancelling: the hotel's own words, or else what the
        // plan's refundable setting says, so a guest never reads two that disagree.
        cancellation: words.cancellation || (plan.refundable === false ? "Non-refundable" : null),
        refundable: plan.refundable !== false,
        ...priced,
      });
    }
    if (options.length === 0) continue;
    options.sort((a, b) => a.total - b.total);
    offers.push({
      roomTypeId: type.id,
      name: type.room_type_name,
      description: shown.description || type.description || "",
      amenities: (shown.amenities?.length ? shown.amenities : Array.isArray(type.amenities) ? type.amenities : []).slice(0, 12),
      photos: shown.photos || [],
      maxAdults,
      // "Only 2 left" is worth saying; the count past a few is not.
      fewLeft: free <= 3 ? free : null,
      options,
    });
  }

  return {
    offers,
    minStay: offers.length === 0 ? minStayHint : null,
    // What the typed code did, so the guest is told rather than left guessing.
    code: usedUp
      ? "full"
      : codeOutcome(
          content,
          stay.code,
          offers.some((o) => o.options.some((x) => x.discount?.coupon))
        ),
  };
}

// ------------------------------------------------------------------
// Booking
// ------------------------------------------------------------------

function readGuest(input) {
  const name = String(input?.name || "").trim().replace(/\s+/g, " ").slice(0, 120);
  const phone = String(input?.phone || "").trim().slice(0, 30);
  const email = String(input?.email || "").trim().toLowerCase().slice(0, 160);
  const requests = String(input?.requests || "").trim().slice(0, 500);
  if (name.length < 2) return { error: "Enter your full name." };
  if ((guestPhoneKey(phone) || "").length < 10) return { error: "Enter your mobile number." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email address does not look right." };
  return { guest: { name, phone, email: email || null, requests: requests || null } };
}

/**
 * Books a stay from the booking page. The offer the guest picked is priced
 * and checked for a free room again here, so a price that changed or a room
 * that sold while they typed is caught, and the guest is told plainly.
 */
export async function createOnlineBooking(hotel, input, { mobile = false } = {}) {
  const read = readStay(hotel, input, { mobile });
  if (read.error) return { error: read.error };
  const { stay } = read;
  const who = readGuest(input?.guest);
  if (who.error) return { error: who.error };
  const payBy = input?.payBy === "hotel" ? "hotel" : "upi";
  if (payBy === "upi" && !hotel.payUpi) return { error: "Online payment is not available. Please pick Pay at the hotel." };
  if (payBy === "hotel" && !hotel.prefs.payAtHotel) return { error: "This hotel asks for payment when you book." };

  const { offers } = await searchOffers(hotel, stay);
  const offer = offers.find((o) => o.roomTypeId === input?.roomTypeId);
  const option = offer?.options.find((o) => o.ratePlanId === input?.ratePlanId);
  if (!offer || !option) {
    return { error: "That room is no longer available for these dates. Please pick another.", gone: true };
  }
  if (input?.expectedTotal != null && Math.abs(Number(input.expectedTotal) - option.total) >= 1) {
    return { error: "The price has just changed. Please check the new price and book again.", gone: true };
  }

  const propertyId = hotel.property.id;
  // The last word on a free room, the same check the desk's form makes.
  const free = await checkAvailability(propertyId, offer.roomTypeId, stay.checkIn, stay.checkOut);
  if (!free.available) {
    return { error: "That room has just been booked. Please pick another.", gone: true };
  }

  const quote = await quoteReservation({
    property_id: propertyId,
    room_type_id: offer.roomTypeId,
    rate_plan_id: option.ratePlanId,
    check_in: stay.checkIn,
    check_out: stay.checkOut,
    adults: stay.adults,
    children: stay.children,
  });
  const rates = {};
  for (const n of quote.nights) rates[n.stay_date] = Number(n.rate);

  const fields = {
    property_id: propertyId,
    guest_name: who.guest.name,
    guest_phone: who.guest.phone,
    guest_email: who.guest.email,
    guest_residency: "domestic",
    room_type_id: offer.roomTypeId,
    rate_plan_id: option.ratePlanId,
    check_in: stay.checkIn,
    check_out: stay.checkOut,
    adults: stay.adults,
    children: stay.children,
    source: SOURCE,
    total_amount: quote.total,
    notes: [
      payBy === "upi" ? "Booked on the website, paying by UPI." : "Booked on the website, paying at the hotel.",
      who.guest.requests ? `Guest request: ${who.guest.requests}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    status: "confirmed",
    // The website price the guest saw: the discount sits on the booking like
    // one the desk gives, so the bill, the invoice and the reports show it.
    ...(option.discount
      ? {
          discount_kind: "amount",
          discount_value: option.discount.amount,
          discount_timing: "before_tax",
          discount_reason: option.discount.kind === "long_stay" ? "long_stay" : "promotion",
          discount_note: discountNote(option.discount),
        }
      : {}),
  };
  try {
    const guestId = await linkGuestForBooking(propertyId, fields, null);
    if (guestId) fields.guest_id = guestId;
  } catch (err) {
    console.error("Booking engine: could not link the guest:", err.message);
  }

  const reservation = await createReservation(fields, { rates });

  try {
    const [first_name, ...rest] = who.guest.name.split(/\s+/);
    await saveReservationGuest(
      reservation.id,
      { first_name, last_name: rest.join(" ") || null, phone: who.guest.phone, email: who.guest.email, is_primary: true },
      { guestId: reservation.guest_id || undefined }
    );
  } catch (err) {
    console.error("Booking engine: could not name the guest:", err.message);
  }

  const folio = await getReservationFolio(reservation.id);
  if (option.discount) await logWebsiteDiscount(reservation, option.discount, folio.totals.discount);
  const { data: row, error } = await getSupabaseAdmin()
    .from(TABLE)
    .insert({
      property_id: propertyId,
      reservation_id: reservation.id,
      token: randomBytes(24).toString("base64url"),
      pay_by: payBy,
      amount: folio.totals.total,
      currency: reservation.currency || hotel.currency,
      payment_status: payBy === "hotel" ? "at_hotel" : "awaiting",
    })
    .select("*")
    .single();
  if (error) throw new Error(`Failed to save the online booking: ${error.message}`);

  // The room this booking took is no longer for sale on the channels.
  await syncInventory(propertyId, [staySpan(reservation)], { actor: "Website booking" });

  return { token: row.token };
}

function discountNote(discount) {
  return `Website: ${discount.label}${discount.coupon ? ` ${couponTag(discount.coupon)}` : ""}`.slice(0, 200);
}

/** The discount log keeps every discount given, the website's too. Never costs the booking. */
async function logWebsiteDiscount(reservation, discount, amount) {
  const { error } = await getSupabaseAdmin().from("reservation_discounts").insert({
    property_id: reservation.property_id,
    reservation_id: reservation.id,
    reference: reservation.reference || null,
    guest_name: reservation.guest_name || null,
    kind: "amount",
    value: discount.amount,
    timing: "before_tax",
    amount: amount || 0,
    previous_kind: null,
    previous_value: null,
    previous_timing: null,
    previous_amount: 0,
    reason: discount.kind === "long_stay" ? "long_stay" : "promotion",
    note: discountNote(discount),
    currency: reservation.currency || null,
    changed_by: null,
  });
  if (error) console.error("Booking engine: could not log the discount:", error.message);
}

// ------------------------------------------------------------------
// The guest's own page
// ------------------------------------------------------------------

/** A booking from its private link, with the hotel's choices; null when unknown. */
export async function findOnlineBooking(token) {
  if (!token || typeof token !== "string" || token.length > 64) return null;
  if (!(await bookingEngineReady())) return null;
  const { data: row } = await getSupabaseAdmin().from(TABLE).select("*").eq("token", token).maybeSingle();
  if (!row) return null;
  const reservation = await getReservation(row.reservation_id).catch(() => null);
  if (!reservation) return null;
  const { data: property } = await getSupabaseAdmin()
    .from("properties")
    .select("*")
    .eq("id", row.property_id)
    .maybeSingle();
  if (!property) return null;
  return { row, reservation, property, prefs: cleanBookingPrefs(property.booking_engine) };
}

const STAY_TEXT = {
  inquiry: "Booked",
  confirmed: "Confirmed",
  in_house: "Checked in",
  checked_out: "Checked out",
  cancelled: "Cancelled",
  no_show: "Cancelled",
};

/**
 * What the guest sees of their booking. While money is still owed on a UPI
 * booking it carries the hotel's UPI ID, a QR code and the pay link, for
 * what is owed now: if the desk added to the bill, the guest pays the new
 * amount.
 */
export async function guestBookingView(found) {
  const { row, reservation, property, prefs } = found;
  const folio = await getReservationFolio(reservation.id);
  const owed = Math.max(0, round2(folio.totals.balance));
  const live = !["cancelled", "no_show", "checked_out"].includes(reservation.status);
  const currency = reservation.currency || row.currency;
  const canPay =
    live &&
    row.pay_by === "upi" &&
    currency === "INR" &&
    isUpiId(prefs.upiId) &&
    owed > 0 &&
    ["awaiting", "not_received", "guest_paid"].includes(row.payment_status);

  let pay = null;
  if (canPay) {
    const link = upiPayLink({
      upiId: prefs.upiId,
      payeeName: prefs.payeeName || property.name,
      amount: owed,
      reference: reservation.reference,
    });
    pay = {
      upiId: prefs.upiId,
      payeeName: prefs.payeeName || property.name,
      amount: owed,
      link,
      qrSvg: await QRCode.toString(link, { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
    };
  }

  return {
    hotel: { name: property.name || "", logoUrl: property.display_prefs?.logoUrl || null, phone: property.phone || property.contact_phone || null },
    reference: reservation.reference,
    status: reservation.status,
    statusText: STAY_TEXT[reservation.status] || "Booked",
    guestName: reservation.guest_name,
    checkIn: reservation.check_in,
    checkOut: reservation.check_out,
    nights: nightsBetween(reservation.check_in, reservation.check_out).length,
    adults: reservation.adults,
    children: reservation.children,
    roomType: reservation.room_types?.room_type_name || reservation.room_type_name || null,
    ratePlan: reservation.rate_plans?.plan_name || null,
    currency,
    total: folio.totals.total,
    paid: folio.totals.paid,
    owed,
    payBy: row.pay_by,
    paymentStatus: row.payment_status,
    paymentText: owed <= 0 && folio.totals.paid > 0 ? "Paid in full. Thank you!" : GUEST_PAYMENT_TEXT[row.payment_status],
    guestReference: row.guest_reference,
    pay,
  };
}

/**
 * The guest says they have paid. The amount they were shown is kept with it,
 * so the desk checks its bank for that figure.
 */
export async function markGuestPaid(found, reference) {
  const { row, reservation } = found;
  if (["cancelled", "no_show"].includes(reservation.status)) {
    return { error: "This booking is cancelled. Please contact the hotel." };
  }
  if (row.payment_status === "received") return { ok: true };
  const folio = await getReservationFolio(reservation.id);
  const owed = Math.max(0, round2(folio.totals.balance));
  const { error } = await getSupabaseAdmin()
    .from(TABLE)
    .update({
      payment_status: "guest_paid",
      guest_reference: cleanPaymentReference(reference) || null,
      guest_paid_at: new Date().toISOString(),
      amount: owed || row.amount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) throw new Error(`Failed to save: ${error.message}`);
  return { ok: true };
}

/**
 * Signing in on the booking page: the booking number and the phone or email
 * it was booked with. Leads to the booking's private link, only for a
 * booking made on this hotel's page.
 */
export async function findBookingForLogin(hotel, reference, contact) {
  const ref = String(reference || "").trim().toUpperCase().replace(/\s+/g, "");
  const said = String(contact || "").trim().toLowerCase();
  if (!ref || !said) return null;
  const { data: reservations } = await getSupabaseAdmin()
    .from("reservations")
    .select("id, guest_phone, guest_email")
    .eq("property_id", hotel.property.id)
    .ilike("reference", ref.startsWith("RS-") ? ref : `RS-${ref}`)
    .limit(2);
  for (const r of reservations || []) {
    const phoneOk = guestPhoneKey(said) && guestPhoneKey(said).length >= 10 && guestPhoneKey(said) === guestPhoneKey(r.guest_phone);
    const emailOk = said.includes("@") && said === String(r.guest_email || "").toLowerCase();
    if (!phoneOk && !emailOk) continue;
    const { data: row } = await getSupabaseAdmin().from(TABLE).select("token").eq("reservation_id", r.id).maybeSingle();
    if (row) return row.token;
  }
  return null;
}

// ------------------------------------------------------------------
// The desk's side
// ------------------------------------------------------------------

export async function getOnlineBooking(reservationId) {
  if (!(await bookingEngineReady())) return null;
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .select("*")
    .eq("reservation_id", reservationId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load the online booking: ${error.message}`);
  return data;
}

/**
 * The desk checked its bank. Received puts a UPI payment on the bill, with
 * the guest's reference, for the amount the guest said they paid; the desk
 * can type a different amount when the bank shows one. Not received tells
 * the guest to call. Marking it received twice does not pay twice.
 */
export async function setPaymentChecked(row, outcome, { userId = null, amount = null } = {}) {
  const now = new Date().toISOString();
  if (outcome === "received") {
    if (row.payment_status === "received") return row;
    const paid = round2(amount != null && Number(amount) > 0 ? amount : row.amount);
    if (!(paid > 0)) throw new Error("Enter the amount you received.");
    const payment = await addReservationPayment(
      row.reservation_id,
      {
        amount: paid,
        method: "upi",
        reference: row.guest_reference || null,
        notes: "Website booking, UPI payment checked in the bank",
      },
      userId
    );
    const { data, error } = await getSupabaseAdmin()
      .from(TABLE)
      .update({ payment_status: "received", checked_at: now, checked_by: userId, payment_id: payment.id, updated_at: now })
      .eq("id", row.id)
      .eq("payment_status", row.payment_status)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`Failed to save: ${error.message}`);
    return data || row;
  }
  if (outcome === "not_received") {
    const { data, error } = await getSupabaseAdmin()
      .from(TABLE)
      .update({ payment_status: "not_received", checked_at: now, checked_by: userId, updated_at: now })
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) throw new Error(`Failed to save: ${error.message}`);
    return data;
  }
  throw new Error("Unknown outcome");
}

/** Website bookings whose guest says they paid, for the Today page. */
export async function listPaymentsToCheck(propertyId) {
  if (!(await bookingEngineReady())) return [];
  const { data, error } = await getSupabaseAdmin()
    .from(TABLE)
    .select("reservation_id, amount, guest_reference, reservations!inner(reference, guest_name, status, room_types(room_type_name))")
    .eq("property_id", propertyId)
    .eq("payment_status", "guest_paid")
    .not("reservations.status", "in", "(cancelled,no_show)")
    .order("guest_paid_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(`Failed to load website payments: ${error.message}`);
  return (data || []).map((r) => ({
    reservationId: r.reservation_id,
    reference: r.reservations?.reference,
    guest: r.reservations?.guest_name,
    roomType: r.reservations?.room_types?.room_type_name || null,
  }));
}
