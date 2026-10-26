/**
 * Places, per country: the states or regions to choose from, the cities to
 * suggest, and the other names a place goes by.
 *
 * Events and hotels are matched on country, state and city by name, so two
 * spellings of one place would quietly miss each other -- an event entered
 * for "Bangalore" would never reach a hotel in "Bengaluru". Each country's
 * entry fixes that for its own places, and only its own: "Delhi" means New
 * Delhi in India and nothing anywhere else.
 *
 * A country with no entry still works. State and city are typed freely and
 * compared ignoring case and spacing, and the Events page suggests the
 * places already used by shared events there. Adding a geography is adding
 * an entry here: nothing else in the code names a country.
 */

const PLACES = {
  IN: {
    regionLabel: "State",
    states: [
      "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
      "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa",
      "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka",
      "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
      "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
      "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    ],
    // Where hotels most often are, by state. Suggestions, not a closed list.
    cities: {
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
      Nagaland: ["Kohima"],
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
    },
    // Old or local names, lower case, and the name the lists use.
    cityAliases: {
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
    },
    stateAliases: {
      orissa: "Odisha",
      pondicherry: "Puducherry",
      "nct of delhi": "Delhi",
      "new delhi": "Delhi",
    },
  },
};

const NONE = { regionLabel: "State / region", states: [], cities: {}, cityAliases: {}, stateAliases: {} };

/** A country's places, or an empty entry for a country not listed yet. */
export function placesFor(countryCode) {
  return PLACES[countryCode] || NONE;
}

/** Countries with their own place lists. */
export const COUNTRIES_WITH_PLACES = Object.keys(PLACES);

const tidy = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

/** A state or region under the name the country's list uses. "" when empty. */
export function normaliseState(countryCode, value) {
  const text = tidy(value);
  if (!text) return "";
  const p = placesFor(countryCode);
  const lower = text.toLowerCase();
  return p.stateAliases[lower] || p.states.find((s) => s.toLowerCase() === lower) || text;
}

/** A city under the name the country's list uses. "" when empty. */
export function normaliseCity(countryCode, value) {
  const text = tidy(value);
  if (!text) return "";
  const p = placesFor(countryCode);
  const lower = text.toLowerCase();
  return (
    p.cityAliases[lower] ||
    Object.values(p.cities).flat().find((c) => c.toLowerCase() === lower) ||
    text
  );
}

/** What two names must share to be the same place. */
export const stateKey = (countryCode, value) => normaliseState(countryCode, value).toLowerCase();
export const cityKey = (countryCode, value) => normaliseCity(countryCode, value).toLowerCase();

/**
 * The state a GSTIN was issued in: its first two digits are the GST state
 * code. "" for anything that is not one. 25 is the old Daman and Diu and 28
 * the old Andhra Pradesh; both still appear on older registrations.
 */
const GST_STATE_CODES = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  10: "Bihar", 11: "Sikkim", 12: "Arunachal Pradesh", 13: "Nagaland", 14: "Manipur",
  15: "Mizoram", 16: "Tripura", 17: "Meghalaya", 18: "Assam", 19: "West Bengal",
  20: "Jharkhand", 21: "Odisha", 22: "Chhattisgarh", 23: "Madhya Pradesh", 24: "Gujarat",
  25: "Dadra and Nagar Haveli and Daman and Diu", 26: "Dadra and Nagar Haveli and Daman and Diu",
  27: "Maharashtra", 28: "Andhra Pradesh", 29: "Karnataka", 30: "Goa", 31: "Lakshadweep",
  32: "Kerala", 33: "Tamil Nadu", 34: "Puducherry", 35: "Andaman and Nicobar Islands",
  36: "Telangana", 37: "Andhra Pradesh", 38: "Ladakh",
};

export function stateFromGstin(gstin) {
  const code = String(gstin || "").trim().slice(0, 2);
  return /^[0-9]{2}$/.test(code) ? GST_STATE_CODES[code] || "" : "";
}

// ISO 3166-2 codes for India, as a visitor's address reports them. Both the
// old and the new code are listed where one changed.
const IN_REGION_CODES = {
  AN: "Andaman and Nicobar Islands", AP: "Andhra Pradesh", AR: "Arunachal Pradesh", AS: "Assam",
  BR: "Bihar", CH: "Chandigarh", CG: "Chhattisgarh", CT: "Chhattisgarh",
  DH: "Dadra and Nagar Haveli and Daman and Diu", DD: "Dadra and Nagar Haveli and Daman and Diu",
  DN: "Dadra and Nagar Haveli and Daman and Diu", DL: "Delhi", GA: "Goa", GJ: "Gujarat",
  HR: "Haryana", HP: "Himachal Pradesh", JK: "Jammu and Kashmir", JH: "Jharkhand",
  KA: "Karnataka", KL: "Kerala", LA: "Ladakh", LD: "Lakshadweep", MP: "Madhya Pradesh",
  MH: "Maharashtra", MN: "Manipur", ML: "Meghalaya", MZ: "Mizoram", NL: "Nagaland",
  OD: "Odisha", OR: "Odisha", PY: "Puducherry", PB: "Punjab", RJ: "Rajasthan", SK: "Sikkim",
  TN: "Tamil Nadu", TS: "Telangana", TG: "Telangana", TR: "Tripura", UP: "Uttar Pradesh",
  UT: "Uttarakhand", UK: "Uttarakhand", WB: "West Bengal",
};

/**
 * The state a region code from the visitor's address stands for, in the
 * country's own list. "" where the country has no list to match against.
 */
export function stateFromRegionCode(countryCode, code) {
  if (countryCode !== "IN") return "";
  return IN_REGION_CODES[String(code || "").trim().toUpperCase()] || "";
}

/** States to choose from, or [] where the region is typed freely. */
export function stateOptions(countryCode) {
  return placesFor(countryCode).states;
}

/** Cities to suggest for a country and, if chosen, its state. */
export function citySuggestions(countryCode, state) {
  const { cities } = placesFor(countryCode);
  if (state && cities[state]) return cities[state];
  return [...new Set(Object.values(cities).flat())].sort();
}

/**
 * The country the browser says it is in -- "en-IN" is India -- as a first
 * guess for a new hotel's profile. "" when the browser names no region; a
 * blank the hotel fills in beats a wrong country nobody notices.
 */
export function guessCountry() {
  try {
    for (const tag of navigator.languages || [navigator.language]) {
      const region = new Intl.Locale(tag).region;
      if (region && /^[A-Z]{2}$/.test(region)) return region;
    }
  } catch {
    // No navigator on the server, or an old browser without Intl.Locale.
  }
  return "";
}
