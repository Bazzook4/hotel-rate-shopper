/**
 * Where a booking came from, in the desk's words. One list for the booking
 * form, the group form and every table that shows a booking's source, so the
 * stored code ("travel_agent") is never what the desk reads.
 *
 * Bookings the channel manager delivers carry the channel's own name
 * (Booking.com, MakeMyTrip), which is not in this list and is shown as it is.
 * Safe to import from client components.
 */
export const BOOKING_SOURCES = [
  { value: "direct", label: "Direct" },
  { value: "walkin", label: "Walk-in" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "website", label: "Website" },
  { value: "corporate", label: "Company" },
  { value: "travel_agent", label: "Travel agent" },
  { value: "ota", label: "OTA" },
  { value: "group", label: "Group" },
];

const LABELS = Object.fromEntries(BOOKING_SOURCES.map((s) => [s.value, s.label]));

/** A booking's source as the desk reads it. */
export function sourceLabel(source) {
  if (!source) return "-";
  return LABELS[source] || LABELS[String(source).toLowerCase()] || source;
}

/** OTAs the desk can pick when it types an OTA booking in by hand. */
export const OTA_NAMES = [
  "MakeMyTrip",
  "Goibibo",
  "Booking.com",
  "Expedia",
  "Agoda",
  "Airbnb",
  "Cleartrip",
  "EaseMyTrip",
  "Yatra",
  "TripAdvisor",
];

const OTA_LOWER = new Set(OTA_NAMES.map((n) => n.toLowerCase()));

/** True for "ota" and for any OTA's own name. */
export function isOtaSource(source) {
  const s = String(source || "").toLowerCase();
  return s === "ota" || OTA_LOWER.has(s);
}
