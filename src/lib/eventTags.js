/**
 * The tags that decide which hotels see an event.
 *
 * An event names a country, and optionally a state, a city and the kinds of
 * property it matters to. A hotel carries the same tags in its profile, and
 * sees an event when every tag the event sets agrees with its own. A tag the
 * event leaves empty means "any": an Indian public holiday names only the
 * country, a Pushkar camel fair names the city, and the wedding season names
 * the property types it fills.
 *
 * Pure data and pure functions, so the setup page, the events page and the
 * pricing engine all read the same lists and apply the same rule. Places --
 * states, cities, and the other names they go by -- are per country, in
 * places.js.
 */

import { cityKey, stateKey } from "@/lib/places";

/** Kinds of property. A hotel may be several -- a resort that hosts weddings. */
export const PROPERTY_TYPES = [
  { id: "leisure", label: "Leisure" },
  { id: "wedding", label: "Wedding / Banquet" },
  { id: "city", label: "City / Business" },
  { id: "resort", label: "Resort" },
  { id: "heritage", label: "Heritage" },
  { id: "pilgrimage", label: "Pilgrimage" },
  { id: "beach", label: "Beach" },
  { id: "hill", label: "Hill station" },
  { id: "homestay", label: "Homestay" },
];
const TYPE_IDS = new Set(PROPERTY_TYPES.map((t) => t.id));

export const propertyTypeLabel = (id) => PROPERTY_TYPES.find((t) => t.id === id)?.label || id;

/** Only known types, once each, in list order. */
export function cleanPropertyTypes(types) {
  const wanted = new Set(Array.isArray(types) ? types : []);
  return PROPERTY_TYPES.map((t) => t.id).filter((id) => wanted.has(id) && TYPE_IDS.has(id));
}

export const EVENT_CATEGORIES = [
  { id: "festival", label: "Festival" },
  { id: "holiday", label: "Public holiday" },
  { id: "long_weekend", label: "Long weekend" },
  { id: "school_holiday", label: "School holidays" },
  { id: "wedding_season", label: "Wedding season" },
  { id: "conference", label: "Conference / Trade fair" },
  { id: "concert", label: "Concert / Show" },
  { id: "sports", label: "Sports" },
  { id: "other", label: "Other" },
];
export const categoryLabel = (id) => EVENT_CATEGORIES.find((c) => c.id === id)?.label || "Other";

/**
 * How much an event moves demand, and the lift the pricing engine reads from
 * it. A word rather than a number at entry, because a hotelier can say
 * "big" with confidence but not "17%", and three steps are enough for a
 * signal that is one vote among several.
 *
 * "Info only" is shown everywhere but moves no price: a bank holiday on a
 * Wednesday fills a resort and empties a business hotel, so a shared
 * holiday says that it is a holiday and leaves the direction to each hotel.
 */
export const IMPACTS = [
  { id: "none", label: "Info only", liftPct: 0 },
  { id: "low", label: "Low", liftPct: 5 },
  { id: "medium", label: "Medium", liftPct: 12 },
  { id: "high", label: "High", liftPct: 25 },
];
export const impactOf = (id) => IMPACTS.find((i) => i.id === id) || IMPACTS.find((i) => i.id === "medium");

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** What a profile still needs before events can be matched to it. */
export function profileGaps(profile) {
  const gaps = [];
  if (!profile?.country_code) gaps.push("country");
  if (!profile?.city) gaps.push("city");
  if (!profile?.property_types?.length) gaps.push("property type");
  return gaps;
}

/**
 * Whether a public event reaches a property with this profile.
 *
 * A property with no country set matches no public event: guessing would
 * show an Indian festival to a hotel in Bali. Its own private events still
 * show, which the caller handles.
 */
export function eventMatchesProfile(event, profile) {
  if (!profile?.country_code || event.country_code !== profile.country_code) return false;
  const country = profile.country_code;
  if (event.state && stateKey(country, event.state) !== stateKey(country, profile.state)) return false;
  if (event.city && cityKey(country, event.city) !== cityKey(country, profile.city)) return false;
  const types = event.property_types || [];
  if (types.length && !types.some((t) => (profile.property_types || []).includes(t))) return false;
  return true;
}

/** Where a public event applies, in words: "Pushkar, Rajasthan" or "All of India". */
export function describeScope(event, countryName = (c) => c) {
  const where = event.city
    ? [event.city, event.state].filter(Boolean).join(", ")
    : event.state || `All of ${countryName(event.country_code)}`;
  const types = event.property_types || [];
  return types.length ? `${where} · ${types.map(propertyTypeLabel).join(", ")}` : where;
}
