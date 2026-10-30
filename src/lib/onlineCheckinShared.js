/**
 * Online check-in: what the guest's page and the desk both need to agree on.
 * No server imports, so the browser can load it too.
 */

export const DEFAULT_CHECKIN_PREFS = {
  enabled: true,
  // "all" asks every adult on the booking for ID; "booker" only the first.
  idFrom: "all",
  idPhoto: true,
  address: true,
  // Passport and visa details from foreign guests, for Form C.
  formC: true,
};

export function cleanCheckinPrefs(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const bool = (v, d) => (typeof v === "boolean" ? v : d);
  return {
    enabled: bool(p.enabled, DEFAULT_CHECKIN_PREFS.enabled),
    idFrom: p.idFrom === "booker" ? "booker" : "all",
    idPhoto: bool(p.idPhoto, DEFAULT_CHECKIN_PREFS.idPhoto),
    address: bool(p.address, DEFAULT_CHECKIN_PREFS.address),
    formC: bool(p.formC, DEFAULT_CHECKIN_PREFS.formC),
  };
}

/** The same choices the Guests page offers. */
export const CHECKIN_ID_TYPES = [
  { id: "aadhaar", label: "Aadhaar" },
  { id: "passport", label: "Passport" },
  { id: "driving_licence", label: "Driving licence" },
  { id: "voter_id", label: "Voter ID" },
  { id: "other", label: "Other" },
];

export const MAX_CHECKIN_FILES_PER_GUEST = 4;

/** Where a booking's link stands, from its row. */
export function checkinStatus(row) {
  if (!row) return "none";
  if (row.accepted_at) return "accepted";
  if (row.submitted_at) return "submitted";
  if (row.opened_at) return "opened";
  return "sent";
}

/** What the desk is shown for each, in front-desk words. */
export const CHECKIN_STATUS_LABELS = {
  none: "Not sent",
  sent: "Link sent",
  opened: "Guest opened it",
  submitted: "Guest sent details. Check and accept",
  accepted: "Accepted",
};

/** The same, short enough for a line under a guest's name in a list. */
export const CHECKIN_SHORT_LABELS = {
  sent: "Online check-in sent",
  opened: "Online check-in opened",
  submitted: "Guest sent details",
  accepted: "Online details accepted",
};

/** How many guests are asked for their details on a booking. */
export function checkinGuestCount(prefs, adults) {
  return prefs.idFrom === "booker" ? 1 : Math.max(1, Math.min(Number(adults) || 1, 12));
}

/** Whether a guest gives passport and visa details rather than a local ID. */
export function isForeignGuest(person, propertyCountry, prefs) {
  return Boolean(prefs.formC && person?.nationality && propertyCountry && person.nationality !== propertyCountry);
}

/** The link the guest opens. */
export function checkinUrl(origin, token) {
  return `${origin}/checkin/${token}`;
}

/**
 * Everything still missing before the details can go to the hotel, each as
 * `{ index, field, message }` with `index` null for the booking as a whole.
 * The guest's page marks them all at once; the server refuses on the first.
 */
export function checkinGaps(guests, { prefs, country, consent }) {
  const gaps = [];
  for (const [i, g] of guests.entries()) {
    const add = (field, message) => gaps.push({ index: i, field, message });
    const needsId = i === 0 || prefs.idFrom === "all";
    if (!g.full_name?.trim()) add("full_name", "Add the full name.");
    if (i === 0 && !g.phone?.trim()) add("phone", "Add a phone number.");
    if (i === 0 && prefs.address && !g.address?.trim()) add("address", "Add your address.");
    if (!needsId) continue;
    if (isForeignGuest(g, country, prefs)) {
      if (!g.id_number?.trim()) add("id_number", "Add the passport number.");
      if (!g.date_of_birth) add("date_of_birth", "Add the date of birth.");
    } else {
      if (!g.id_type) add("id_type", "Choose the type of ID.");
      if (!g.id_number?.trim()) add("id_number", "Add the ID number.");
    }
    if (prefs.idPhoto && !(g.files || []).length) add("files", "Add a photo of the ID.");
  }
  if (!consent) gaps.push({ index: null, field: "consent", message: "Tick the box to agree that the hotel may keep your ID for your stay." });
  return gaps;
}
