/**
 * Aiosell's channel slugs are not what a hotelier calls them. Shared by the
 * server and the browser, so it holds names only -- nothing that calls out.
 */
export const CHANNEL_LABELS = {
  "booking.com": "Booking.com",
  gommt: "MakeMyTrip / Goibibo",
  agoda: "Agoda",
  airbnb: "Airbnb",
  google: "Google",
  expedia: "Expedia",
};

export function channelLabel(slug) {
  return CHANNEL_LABELS[slug] || slug;
}
