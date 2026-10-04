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
 * pricing engine all read the same lists and apply the same rule.
 */

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
 */
export const IMPACTS = [
  { id: "low", label: "Low", liftPct: 5 },
  { id: "medium", label: "Medium", liftPct: 12 },
  { id: "high", label: "High", liftPct: 25 },
];
export const impactOf = (id) => IMPACTS.find((i) => i.id === id) || IMPACTS[1];

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

/** States and union territories of India, for the state dropdown. */
export const INDIA_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
  "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa",
  "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka",
  "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

/**
 * Cities hotels in India are most often in, by state. Suggestions, not a
 * closed list: a hotel in a town not named here types it, and it is
 * normalised the same way.
 */
export const INDIA_CITIES = {
  "Andaman and Nicobar Islands": ["Port Blair", "Havelock"],
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Tirupati", "Araku"],
  Assam: ["Guwahati", "Kaziranga"],
  Bihar: ["Patna", "Bodh Gaya"],
  Chandigarh: ["Chandigarh"],
  Delhi: ["New Delhi"],
  Goa: ["North Goa", "South Goa", "Panaji"],
  Gujarat: ["Ahmedabad", "Vadodara", "Surat", "Dwarka", "Somnath", "Kutch"],
  Haryana: ["Gurugram", "Faridabad"],
  "Himachal Pradesh": ["Shimla", "Manali", "Dharamshala", "Dalhousie", "Kasauli"],
  "Jammu and Kashmir": ["Srinagar", "Gulmarg", "Pahalgam", "Katra"],
  Karnataka: ["Bengaluru", "Mysuru", "Coorg", "Chikmagalur", "Hampi", "Mangaluru", "Gokarna"],
  Kerala: ["Kochi", "Thiruvananthapuram", "Munnar", "Alappuzha", "Kovalam", "Varkala", "Wayanad", "Thekkady", "Kozhikode"],
  Ladakh: ["Leh"],
  "Madhya Pradesh": ["Bhopal", "Indore", "Khajuraho", "Ujjain", "Pachmarhi"],
  Maharashtra: ["Mumbai", "Pune", "Lonavala", "Mahabaleshwar", "Nashik", "Aurangabad", "Shirdi", "Nagpur"],
  Meghalaya: ["Shillong"],
  Odisha: ["Bhubaneswar", "Puri", "Konark"],
  Puducherry: ["Puducherry"],
  Punjab: ["Amritsar", "Ludhiana"],
  Rajasthan: ["Jaipur", "Udaipur", "Jodhpur", "Jaisalmer", "Pushkar", "Mount Abu", "Ranthambore"],
  Sikkim: ["Gangtok", "Pelling"],
  "Tamil Nadu": ["Chennai", "Ooty", "Kodaikanal", "Madurai", "Coimbatore", "Mahabalipuram", "Rameswaram", "Kanyakumari", "Yercaud"],
  Telangana: ["Hyderabad"],
  "Uttar Pradesh": ["Agra", "Varanasi", "Lucknow", "Prayagraj", "Mathura", "Vrindavan", "Ayodhya", "Noida"],
  Uttarakhand: ["Rishikesh", "Haridwar", "Mussoorie", "Nainital", "Jim Corbett", "Dehradun"],
  "West Bengal": ["Kolkata", "Darjeeling", "Siliguri"],
};

/**
 * Old or local names that mean the same place. Without this, an event
 * entered for "Bangalore" would never reach a hotel that chose "Bengaluru".
 */
const CITY_ALIASES = {
  bangalore: "Bengaluru",
  bombay: "Mumbai",
  madras: "Chennai",
  calcutta: "Kolkata",
  gurgaon: "Gurugram",
  delhi: "New Delhi",
  udhagamandalam: "Ooty",
  ootacamund: "Ooty",
  pondicherry: "Puducherry",
  pondy: "Puducherry",
  trivandrum: "Thiruvananthapuram",
  cochin: "Kochi",
  mysore: "Mysuru",
  mangalore: "Mangaluru",
  calicut: "Kozhikode",
  alleppey: "Alappuzha",
  benares: "Varanasi",
  banaras: "Varanasi",
  allahabad: "Prayagraj",
  baroda: "Vadodara",
  poona: "Pune",
  simla: "Shimla",
  vizag: "Visakhapatnam",
  kodagu: "Coorg",
  madikeri: "Coorg",
  mamallapuram: "Mahabalipuram",
  corbett: "Jim Corbett",
};

const tidy = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

/** A state as the list spells it, whatever case was typed. "" when empty. */
export function normaliseState(value) {
  const text = tidy(value);
  return INDIA_STATES.find((s) => s.toLowerCase() === text.toLowerCase()) || text;
}

/**
 * A city under the name the lists use. Separate from states because the
 * aliases differ: the city "Delhi" is New Delhi, the state is Delhi.
 */
export function normaliseCity(value) {
  const text = tidy(value);
  if (!text) return "";
  const lower = text.toLowerCase();
  return (
    CITY_ALIASES[lower] ||
    Object.values(INDIA_CITIES).flat().find((c) => c.toLowerCase() === lower) ||
    text
  );
}

const stateKey = (value) => normaliseState(value).toLowerCase();
const cityKey = (value) => normaliseCity(value).toLowerCase();

/** The cities to suggest for a country and state. */
export function citySuggestions(countryCode, state) {
  if (countryCode !== "IN") return [];
  if (state && INDIA_CITIES[state]) return INDIA_CITIES[state];
  return Object.values(INDIA_CITIES).flat().sort();
}

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
  if (event.state && stateKey(event.state) !== stateKey(profile.state)) return false;
  if (event.city && cityKey(event.city) !== cityKey(profile.city)) return false;
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
